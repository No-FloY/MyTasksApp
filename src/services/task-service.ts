import { endOfDay, parseISO } from 'date-fns'
import { db, type TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { Task, TaskInput, TaskOutcome, TaskPriority, TaskStatus } from '../models/task'

export const MAX_TASK_TITLE_LENGTH = 200
export const MAX_TASK_DESCRIPTION_LENGTH = 5000

export type TaskValidationErrors = Partial<Record<keyof TaskInput, string>>

export function getTaskValidationErrors(input: TaskInput): TaskValidationErrors {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { title: 'Введите данные задачи.' }
  }
  const errors: TaskValidationErrors = {}
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    errors.title = 'Введите название задачи.'
  } else if (input.title.trim().length > MAX_TASK_TITLE_LENGTH) {
    errors.title = `Название не должно превышать ${MAX_TASK_TITLE_LENGTH} символов.`
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    errors.description = 'Описание должно быть текстом.'
  } else if ((input.description?.trim().length ?? 0) > MAX_TASK_DESCRIPTION_LENGTH) {
    errors.description = `Описание не должно превышать ${MAX_TASK_DESCRIPTION_LENGTH} символов.`
  }
  if (typeof input.date !== 'string' || !isLocalDate(input.date)) {
    errors.date = 'Введите корректную календарную дату.'
  }
  if (input.time !== undefined && input.time !== null && input.time !== ''
    && (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))) {
    errors.time = 'Введите время в формате ЧЧ:ММ от 00:00 до 23:59.'
  }
  if (input.priority !== 'low' && input.priority !== 'medium' && input.priority !== 'high') {
    errors.priority = 'Выберите приоритет задачи.'
  }
  return errors
}

function validateDate(date: string): asserts date is LocalDate {
  if (typeof date !== 'string' || !isLocalDate(date)) throw new Error('Некорректная календарная дата.')
}

function validateId(id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0) throw new Error('Некорректный идентификатор задачи.')
}

function normalizeTaskInput(input: TaskInput): Pick<Task, 'title' | 'description' | 'date' | 'time' | 'priority'> {
  const errors = getTaskValidationErrors(input)
  const firstError = Object.values(errors)[0]
  if (firstError) throw new Error(firstError)
  validateDate(input.date)
  return {
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    date: input.date,
    time: input.time || null,
    priority: input.priority,
  }
}

const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
const statusOrder: Record<TaskStatus, number> = { active: 0, completed: 1, failed: 2, cancelled: 3 }
const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0

/** Active tasks: date, timed before untimed, time, priority, creation, then ID. */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((first, second) => {
    if (first.status !== second.status) return statusOrder[first.status] - statusOrder[second.status]
    if (first.status === 'completed') {
      return compareText(second.completedAt ?? '', first.completedAt ?? '') || compareText(first.id, second.id)
    }
    if (first.status !== 'active') {
      return compareText(second.updatedAt, first.updatedAt) || compareText(first.id, second.id)
    }
    return compareText(first.date, second.date)
      || compareText(first.time ?? '24:00', second.time ?? '24:00')
      || priorityOrder[first.priority] - priorityOrder[second.priority]
      || compareText(first.createdAt, second.createdAt)
      || compareText(first.id, second.id)
  })
}

/** An explicit time means HH:mm:00.000; a date without time includes the entire local day. */
export function getTaskDeadline(task: Pick<Task, 'date' | 'time'>): Date {
  validateDate(task.date)
  if (task.time === null) return endOfDay(parseISO(task.date))
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)) throw new Error('Некорректное время задачи.')
  return parseISO(`${task.date}T${task.time}:00.000`)
}

export function getTaskOutcome(task: Task, now: Date = new Date()): TaskOutcome {
  if (!Number.isFinite(now.getTime())) throw new Error('Некорректная дата.')
  const deadline = getTaskDeadline(task).getTime()
  if (task.status === 'failed' || task.status === 'cancelled') return task.status
  if (task.status === 'completed') {
    const completedAt = task.completedAt ? Date.parse(task.completedAt) : NaN
    if (!Number.isFinite(completedAt)) return 'completed_unknown'
    return completedAt <= deadline ? 'completed_on_time' : 'completed_late'
  }
  return now.getTime() > deadline ? 'overdue' : 'planned'
}

export const taskStatusLabels: Record<TaskStatus, string> = {
  active: 'Активная', completed: 'Выполнена', failed: 'Не выполнена', cancelled: 'Отменена',
}

function normalizeNow(now: Date | LocalDate): Date {
  if (typeof now === 'string') {
    validateDate(now)
    return parseISO(now)
  }
  if (!Number.isFinite(now.getTime())) throw new Error('Некорректная дата.')
  return now
}

export function isTaskOverdue(task: Task, now: Date | LocalDate = new Date()): boolean {
  return getTaskOutcome(task, normalizeNow(now)) === 'overdue'
}

export interface TaskGroups {
  overdue: Task[]
  today: Task[]
  upcoming: Task[]
  completed: Task[]
  failed: Task[]
  cancelled: Task[]
}

export function groupTasks(tasks: readonly Task[], at: Date | LocalDate = new Date()): TaskGroups {
  const now = normalizeNow(at)
  const today = getLocalDate(now)
  const groups: TaskGroups = { overdue: [], today: [], upcoming: [], completed: [], failed: [], cancelled: [] }
  for (const task of sortTasks(tasks)) {
    validateDate(task.date)
    if (task.status !== 'active') groups[task.status].push(task)
    else if (isTaskOverdue(task, now)) groups.overdue.push(task)
    else if (task.date === today) groups.today.push(task)
    else groups.upcoming.push(task)
  }
  return groups
}

export class TaskService {
  private readonly database: TaskTrackerDatabase

  constructor(database: TaskTrackerDatabase) {
    this.database = database
  }

  async createTask(input: TaskInput): Promise<Task> {
    const fields = normalizeTaskInput(input)
    const now = new Date().toISOString()
    const task: Task = {
      ...fields, id: crypto.randomUUID(), status: 'active',
      createdAt: now, updatedAt: now, completedAt: null,
    }
    await this.database.tasks.add(task)
    return task
  }

  async updateTask(id: string, input: TaskInput): Promise<Task> {
    const fields = normalizeTaskInput(input)
    return this.mutateTask(id, (task) => ({ ...task, ...fields, updatedAt: new Date().toISOString() }))
  }

  async deleteTask(id: string): Promise<void> {
    validateId(id)
    await this.database.tasks.delete(id)
  }

  async getTask(id: string): Promise<Task | undefined> {
    validateId(id)
    return this.database.tasks.get(id)
  }

  async getTasksForDate(date: string): Promise<Task[]> {
    validateDate(date)
    return sortTasks(await this.database.tasks.where('date').equals(date).toArray())
  }

  async getTasksForDateRange(startDate: string, endDate: string): Promise<Task[]> {
    validateDate(startDate)
    validateDate(endDate)
    if (startDate > endDate) throw new Error('Начало периода не может быть позже конца.')
    return sortTasks(await this.database.tasks.where('date').between(startDate, endDate, true, true).toArray())
  }

  async getAllTasks(): Promise<Task[]> {
    return sortTasks(await this.database.tasks.toArray())
  }

  async completeTask(id: string): Promise<Task> {
    return this.setStatus(id, 'completed')
  }

  async reopenTask(id: string): Promise<Task> {
    return this.setStatus(id, 'active')
  }

  async failTask(id: string): Promise<Task> {
    return this.setStatus(id, 'failed')
  }

  async cancelTask(id: string): Promise<Task> {
    return this.setStatus(id, 'cancelled')
  }

  private async setStatus(id: string, status: TaskStatus): Promise<Task> {
    return this.mutateTask(id, (task) => {
      if (task.status === status) return task
      if (task.status === 'failed' || task.status === 'cancelled') {
        throw new Error('Задача уже закрыта. Её конечное состояние нельзя изменить.')
      }
      if ((status === 'failed' || status === 'cancelled') && task.status !== 'active') {
        throw new Error('Задача уже выполнена. Сначала верните её в активные.')
      }
      const now = new Date().toISOString()
      return { ...task, status, updatedAt: now, completedAt: status === 'completed' ? now : null }
    })
  }

  private async mutateTask(id: string, update: (task: Task) => Task): Promise<Task> {
    validateId(id)
    // Read the latest row and write in one transaction: editing cannot overwrite a
    // concurrent completion, and deleting a row cannot cause it to be resurrected.
    return this.database.transaction('rw', this.database.tasks, async () => {
      const previous = await this.database.tasks.get(id)
      if (!previous) throw new Error('Задача не найдена. Возможно, она была удалена.')
      const next = update(previous)
      if (next !== previous) await this.database.tasks.put(next)
      return next
    })
  }
}

export const taskService = new TaskService(db)
export const createTask = (input: TaskInput) => taskService.createTask(input)
export const updateTask = (id: string, input: TaskInput) => taskService.updateTask(id, input)
export const deleteTask = (id: string) => taskService.deleteTask(id)
export const getTask = (id: string) => taskService.getTask(id)
export const getTasksForDate = (date: string) => taskService.getTasksForDate(date)
export const getTasksForDateRange = (startDate: string, endDate: string) => taskService.getTasksForDateRange(startDate, endDate)
export const getAllTasks = () => taskService.getAllTasks()
export const completeTask = (id: string) => taskService.completeTask(id)
export const reopenTask = (id: string) => taskService.reopenTask(id)
export const failTask = (id: string) => taskService.failTask(id)
export const cancelTask = (id: string) => taskService.cancelTask(id)
