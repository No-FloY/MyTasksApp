import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { AmountHabit, BooleanHabit, Habit } from '../models/habit'
import type { BooleanHabitStatus, HabitEntry } from '../models/habit-entry'
import { getBooleanHabitMode, getMissingDataPolicy } from '../models/habit-policy'
import { getWeekEnd, getWeekStart, isHabitExpectedOnDate, isWeeklyHabit } from './habit-schedule'

export type HabitResultSource = 'explicit' | 'inferred' | 'no-data'
export type ResolvedHabitResult =
  | { type: 'boolean'; status: BooleanHabitStatus; source: HabitResultSource }
  | { type: 'amount'; value: number | null; source: HabitResultSource }
  | { type: 'duration'; minutes: number | null; source: HabitResultSource }
  | { type: 'rating'; value: number | null; source: HabitResultSource }

/** Derived values have no entry ID/timestamps and can never be confused with stored history. */
export function resolveHabitResult(habit: BooleanHabit, entry: HabitEntry | undefined, date: LocalDate, today: LocalDate): Extract<ResolvedHabitResult, { type: 'boolean' }>
export function resolveHabitResult(habit: AmountHabit, entry: HabitEntry | undefined, date: LocalDate, today: LocalDate): Extract<ResolvedHabitResult, { type: 'amount' }>
export function resolveHabitResult(habit: Habit, entry: HabitEntry | undefined, date: LocalDate, today: LocalDate): ResolvedHabitResult
export function resolveHabitResult(habit: Habit, entry: HabitEntry | undefined, date: LocalDate, today: LocalDate): ResolvedHabitResult {
  if (!isLocalDate(date) || !isLocalDate(today)) throw new Error('Некорректная календарная дата.')
  if (entry) {
    if (entry.habitId !== habit.id || entry.type !== habit.type) throw new Error('Тип записи не соответствует привычке.')
    if (entry.type === 'boolean') {
      if (!['success', 'failure', 'no-data'].includes(entry.status)) throw new Error('Сохранённый результат привычки некорректен.')
      return { type: 'boolean', status: entry.status, source: 'explicit' }
    }
    if (entry.type === 'duration') return { type: 'duration', minutes: entry.minutes, source: 'explicit' }
    return { type: entry.type, value: entry.value, source: 'explicit' }
  }
  const weekly = isWeeklyHabit(habit)
  const start = weekly ? getWeekStart(date) : date
  const end = weekly ? getWeekEnd(date) : date
  const created = getLocalDate(new Date(habit.createdAt))
  const archived = habit.archivedAt === null ? null : getLocalDate(new Date(habit.archivedAt))
  const eligible = end < today && start >= created && (archived === null || end < archived)
    && (weekly || isHabitExpectedOnDate(habit, date))
  const policy = getMissingDataPolicy(habit)
  if (eligible && policy !== 'manual') {
    if (habit.type === 'boolean') return {
      type: 'boolean', source: 'inferred',
      status: policy === 'assume_not_occurred' && getBooleanHabitMode(habit) === 'avoidance' ? 'success' : 'failure',
    }
    if (habit.type === 'amount') return { type: 'amount', value: 0, source: 'inferred' }
  }
  // Duration and rating need measurements; a missing event must not invent time or a rating.
  if (habit.type === 'boolean') return { type: 'boolean', status: 'no-data', source: 'no-data' }
  if (habit.type === 'duration') return { type: 'duration', minutes: null, source: 'no-data' }
  return { type: habit.type, value: null, source: 'no-data' }
}
