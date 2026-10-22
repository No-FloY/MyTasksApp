import { isLocalDate, type LocalDate } from '../lib/local-date'
import { BACKUP_FORMAT_VERSION, type BackupSnapshot } from '../models/backup'
import type { DurationRatingRange } from '../models/duration-rating'
import type { Goal, GoalMilestone } from '../models/goal'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import type { Task } from '../models/task'
import { validateRatingRanges } from './duration-service'
import { MAX_GOAL_DESCRIPTION_LENGTH, MAX_GOAL_TITLE_LENGTH, MAX_MILESTONE_TITLE_LENGTH } from './goal-service'
import { MAX_HABIT_NOTE_LENGTH } from './habit-note-service'
import { MAX_TASK_DESCRIPTION_LENGTH, MAX_TASK_TITLE_LENGTH } from './task-service'

function invalid(path: string, reason: string): never {
  throw new Error(`Некорректная резервная копия: ${path} — ${reason}.`)
}

function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid(path, 'ожидается объект')
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) invalid(`${path}.${key}`, 'неподдерживаемое поле')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, path: string, required = false, maxLength = Infinity): string {
  if (typeof value !== 'string') return invalid(path, 'ожидается текст')
  if (required && !value.trim()) return invalid(path, 'значение не должно быть пустым')
  if (value.trim().length > maxLength) return invalid(path, `не более ${maxLength} символов`)
  return value
}

function numeric(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return invalid(path, 'число вне допустимого диапазона')
  }
  return value
}

function unsignedInteger(value: unknown, path: string, max = Number.MAX_SAFE_INTEGER): number {
  const result = numeric(value, path, 0, max)
  if (!Number.isSafeInteger(result)) return invalid(path, 'ожидается безопасное целое число')
  return result
}

function positiveAmount(value: unknown, path: string): number {
  const result = numeric(value, path, 0, Number.MAX_SAFE_INTEGER)
  if (result === 0) return invalid(path, 'значение должно быть больше нуля')
  return result
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return invalid(path, 'ожидается логическое значение')
  return value
}

function oneOf<T extends string>(value: unknown, path: string, values: readonly T[]): T {
  const result = values.find((candidate) => candidate === value)
  if (result === undefined) return invalid(path, 'неподдерживаемое значение')
  return result
}

function calendarDate(value: unknown, path: string): LocalDate {
  if (typeof value !== 'string' || !isLocalDate(value)) return invalid(path, 'некорректная календарная дата')
  return value
}

function timestamp(value: unknown, path: string): string {
  // Requiring a timezone avoids interpreting timestamps differently across devices.
  // Validate the calendar component separately: Date.parse accepts February 30.
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !isLocalDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) {
    return invalid(path, 'ожидается корректная дата ISO с часовым поясом')
  }
  return value
}

function times(row: Record<string, unknown>, path: string) {
  return {
    createdAt: timestamp(row.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(row.updatedAt, `${path}.updatedAt`),
  }
}

function rows<T>(value: unknown, path: string, parse: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) return invalid(path, 'ожидается массив')
  return Array.from(value, (item, index) => parse(item, `${path}[${index}]`))
}

function ratingRange(value: unknown, path: string): DurationRatingRange {
  const row = object(value, path, ['id', 'label', 'emoji', 'minMinutes', 'maxMinutes'])
  return {
    id: text(row.id, `${path}.id`, true),
    label: text(row.label, `${path}.label`, true),
    emoji: text(row.emoji, `${path}.emoji`, true),
    minMinutes: unsignedInteger(row.minMinutes, `${path}.minMinutes`),
    maxMinutes: row.maxMinutes === null ? null : unsignedInteger(row.maxMinutes, `${path}.maxMinutes`),
  }
}

function habit(value: unknown, path: string): Habit {
  const baseKeys = ['id', 'name', 'description', 'order', 'createdAt', 'updatedAt', 'archivedAt', 'type']
  const row = object(value, path, [...baseKeys, 'unit', 'target', 'ratingRanges'])
  const type = oneOf(row.type, `${path}.type`, ['boolean', 'amount', 'duration', 'rating'])
  object(value, path, [...baseKeys, ...(type === 'amount' ? ['unit', 'target'] : type === 'duration' ? ['unit', 'ratingRanges'] : [])])
  const base = {
    id: text(row.id, `${path}.id`, true),
    name: text(row.name, `${path}.name`, true),
    description: text(row.description, `${path}.description`),
    order: unsignedInteger(row.order, `${path}.order`),
    ...times(row, path),
    archivedAt: row.archivedAt === null ? null : timestamp(row.archivedAt, `${path}.archivedAt`),
  }
  if (type === 'amount') {
    const target = unsignedInteger(row.target, `${path}.target`)
    if (target === 0) invalid(`${path}.target`, 'значение должно быть больше нуля')
    return { ...base, type, unit: text(row.unit, `${path}.unit`, true), target }
  }
  if (type === 'duration') {
    const ratingRanges = rows(row.ratingRanges, `${path}.ratingRanges`, ratingRange)
    try {
      validateRatingRanges(ratingRanges)
    } catch {
      invalid(`${path}.ratingRanges`, 'диапазоны должны покрывать время с нуля без пропусков и пересечений, с открытым последним диапазоном')
    }
    return { ...base, type, unit: oneOf(row.unit, `${path}.unit`, ['minutes']), ratingRanges }
  }
  return { ...base, type }
}

function habitEntry(value: unknown, path: string): HabitEntry {
  const baseKeys = ['habitId', 'date', 'createdAt', 'updatedAt', 'note', 'type']
  const row = object(value, path, [...baseKeys, 'status', 'value', 'minutes'])
  const type = oneOf(row.type, `${path}.type`, ['boolean', 'amount', 'duration', 'rating'])
  object(value, path, [...baseKeys, type === 'boolean' ? 'status' : type === 'duration' ? 'minutes' : 'value'])
  const base = {
    habitId: text(row.habitId, `${path}.habitId`, true),
    date: calendarDate(row.date, `${path}.date`),
    ...times(row, path),
    ...(Object.hasOwn(row, 'note') ? { note: text(row.note, `${path}.note`, false, MAX_HABIT_NOTE_LENGTH) } : {}),
  }
  if (type === 'boolean') {
    return { ...base, type, status: oneOf(row.status, `${path}.status`, ['success', 'failure', 'no-data']) }
  }
  if (type === 'duration') return { ...base, type, minutes: unsignedInteger(row.minutes, `${path}.minutes`, 1440) }
  return { ...base, type, value: type === 'amount' ? unsignedInteger(row.value, `${path}.value`) : numeric(row.value, `${path}.value`) }
}

function task(value: unknown, path: string): Task {
  const row = object(value, path, ['id', 'title', 'description', 'date', 'time', 'priority', 'status', 'createdAt', 'updatedAt', 'completedAt', 'goalId'])
  const time = row.time === null ? null : text(row.time, `${path}.time`)
  if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) invalid(`${path}.time`, 'некорректное время')
  const status = oneOf(row.status, `${path}.status`, ['active', 'completed', 'failed', 'cancelled'])
  const completedAt = row.completedAt === null ? null : timestamp(row.completedAt, `${path}.completedAt`)
  if (status !== 'completed' && completedAt !== null) invalid(`${path}.completedAt`, 'дата завершения допустима только у выполненной задачи')
  return {
    id: text(row.id, `${path}.id`, true),
    title: text(row.title, `${path}.title`, true, MAX_TASK_TITLE_LENGTH),
    description: text(row.description, `${path}.description`, false, MAX_TASK_DESCRIPTION_LENGTH),
    date: calendarDate(row.date, `${path}.date`),
    time,
    priority: oneOf(row.priority, `${path}.priority`, ['low', 'medium', 'high']),
    status, completedAt, ...times(row, path),
    ...(Object.hasOwn(row, 'goalId') ? { goalId: row.goalId === null ? null : text(row.goalId, `${path}.goalId`, true) } : {}),
  }
}

function goal(value: unknown, path: string): Goal {
  const row = object(value, path, ['id', 'title', 'description', 'deadline', 'status', 'progressMode', 'manualProgress', 'archived', 'createdAt', 'updatedAt'])
  return {
    id: text(row.id, `${path}.id`, true),
    title: text(row.title, `${path}.title`, true, MAX_GOAL_TITLE_LENGTH),
    description: text(row.description, `${path}.description`, false, MAX_GOAL_DESCRIPTION_LENGTH),
    deadline: row.deadline === null ? null : calendarDate(row.deadline, `${path}.deadline`),
    status: oneOf(row.status, `${path}.status`, ['active', 'completed', 'failed', 'cancelled']),
    progressMode: oneOf(row.progressMode, `${path}.progressMode`, ['auto', 'manual']),
    manualProgress: numeric(row.manualProgress, `${path}.manualProgress`, 0, 100),
    archived: boolean(row.archived, `${path}.archived`),
    ...times(row, path),
  }
}

function milestone(value: unknown, path: string): GoalMilestone {
  const baseKeys = ['id', 'goalId', 'title', 'order', 'createdAt', 'updatedAt', 'type']
  const row = object(value, path, [...baseKeys, 'completed', 'current', 'target'])
  const type = oneOf(row.type, `${path}.type`, ['boolean', 'amount'])
  object(value, path, [...baseKeys, ...(type === 'boolean' ? ['completed'] : ['current', 'target'])])
  const base = {
    id: text(row.id, `${path}.id`, true),
    goalId: text(row.goalId, `${path}.goalId`, true),
    title: text(row.title, `${path}.title`, true, MAX_MILESTONE_TITLE_LENGTH),
    order: unsignedInteger(row.order, `${path}.order`),
    ...times(row, path),
  }
  return type === 'boolean'
    ? { ...base, type, completed: boolean(row.completed, `${path}.completed`) }
    : { ...base, type, current: numeric(row.current, `${path}.current`, 0, Number.MAX_SAFE_INTEGER), target: positiveAmount(row.target, `${path}.target`) }
}

function unique<T>(items: T[], key: (item: T) => string, path: string): void {
  const seen = new Set<string>()
  for (const item of items) {
    const id = key(item)
    if (seen.has(id)) invalid(path, 'повторяющийся идентификатор записи')
    seen.add(id)
  }
}

/** Validate and detach all fields before starting a transaction; never normalize history. */
export function validateBackupSnapshot(value: unknown): BackupSnapshot {
  const root = object(value, 'backup', ['app', 'formatVersion', 'exportedAt', 'data'])
  if (root.app !== 'zadachnik') invalid('app', 'файл принадлежит другому приложению')
  if (typeof root.formatVersion !== 'number' || !Number.isSafeInteger(root.formatVersion)) {
    invalid('formatVersion', 'не указана корректная версия формата')
  }
  if (root.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error('Эта резервная копия создана более новой версией приложения и пока не поддерживается.')
  }
  if (root.formatVersion !== BACKUP_FORMAT_VERSION) invalid('formatVersion', 'эта версия формата не поддерживается')
  const exportedAt = timestamp(root.exportedAt, 'exportedAt')
  const source = object(root.data, 'data', ['habits', 'habitEntries', 'tasks', 'goals', 'goalMilestones'])
  const data = {
    habits: rows(source.habits, 'data.habits', habit),
    habitEntries: rows(source.habitEntries, 'data.habitEntries', habitEntry),
    tasks: rows(source.tasks, 'data.tasks', task),
    goals: rows(source.goals, 'data.goals', goal),
    goalMilestones: rows(source.goalMilestones, 'data.goalMilestones', milestone),
  }
  unique(data.habits, (item) => item.id, 'data.habits')
  unique(data.habitEntries, (item) => JSON.stringify([item.habitId, item.date]), 'data.habitEntries')
  unique(data.tasks, (item) => item.id, 'data.tasks')
  unique(data.goals, (item) => item.id, 'data.goals')
  unique(data.goalMilestones, (item) => item.id, 'data.goalMilestones')
  const habits = new Map(data.habits.map((item) => [item.id, item]))
  const goals = new Set(data.goals.map((item) => item.id))
  for (const [index, entry] of data.habitEntries.entries()) {
    const parent = habits.get(entry.habitId)
    if (!parent) invalid(`data.habitEntries[${index}].habitId`, 'привычка не найдена в копии')
    if (parent.type !== entry.type) invalid(`data.habitEntries[${index}].type`, 'тип записи не соответствует привычке')
  }
  for (const [index, item] of data.tasks.entries()) {
    if (item.goalId !== undefined && item.goalId !== null && !goals.has(item.goalId)) {
      invalid(`data.tasks[${index}].goalId`, 'цель не найдена в копии')
    }
  }
  for (const [index, item] of data.goalMilestones.entries()) {
    if (!goals.has(item.goalId)) invalid(`data.goalMilestones[${index}].goalId`, 'цель не найдена в копии')
  }
  return { app: 'zadachnik', formatVersion: BACKUP_FORMAT_VERSION, exportedAt, data }
}
