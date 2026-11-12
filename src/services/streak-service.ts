import { addDays, eachDayOfInterval, parseISO } from 'date-fns'
import { db, type TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { BooleanHabit } from '../models/habit'
import type { BooleanHabitStatus, HabitEntry } from '../models/habit-entry'
import { getMissingDataPolicy, isObservationalHabit } from '../models/habit-policy'
import { resolveHabitResult } from './habit-result'
import { getHabitSchedule } from './habit-schedule'

export interface BooleanStreak {
  currentStreak: number
  bestStreak: number
  successes: number
  failures: number
  /** Percentage among explicit success/failure results; null means no rated days. */
  successRate: number | null
}

export interface BooleanHabitStatistics extends BooleanStreak {
  habit: BooleanHabit
}

/** Current streak ends exactly on endDate. Missing days and no-data break a streak. */
export function calculateBooleanStreak(habitId: string, entries: HabitEntry[], endDate: LocalDate): BooleanStreak {
  if (!isLocalDate(endDate)) throw new Error('Некорректная календарная дата.')
  const history = entries.filter((entry) => entry.habitId === habitId && entry.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  return calculateBooleanResultStreak(history.map((entry) => {
    if (entry.type !== 'boolean') throw new Error('Тип записи не соответствует привычке.')
    return { date: entry.date, status: entry.status }
  }), endDate)
}

/** Accepts computed results rather than fake HabitEntry rows with invented timestamps. */
export function calculateBooleanResultStreak(results: { date: LocalDate; status: BooleanHabitStatus }[], endDate: LocalDate): BooleanStreak {
  if (!isLocalDate(endDate)) throw new Error('Некорректная календарная дата.')
  const history = results.filter((result) => result.date <= endDate).sort((a, b) => a.date.localeCompare(b.date))
  let successes = 0
  let failures = 0
  let streak = 0
  let bestStreak = 0
  let previousSuccess: LocalDate | null = null
  for (const entry of history) {
    if (!isLocalDate(entry.date)) throw new Error('Некорректная дата в истории привычки.')
    if (entry.status === 'success') {
      const followsPrevious = previousSuccess !== null
        && getLocalDate(addDays(parseISO(previousSuccess), 1)) === entry.date
      streak = followsPrevious ? streak + 1 : 1
      successes += 1
      bestStreak = Math.max(bestStreak, streak)
      previousSuccess = entry.date
    } else {
      if (entry.status === 'failure') failures += 1
      else if (entry.status !== 'no-data') throw new Error('Сохранённый результат привычки некорректен.')
      streak = 0
      previousSuccess = null
    }
  }
  const ratedDays = successes + failures
  return {
    currentStreak: previousSuccess === endDate ? streak : 0,
    bestStreak,
    successes,
    failures,
    successRate: ratedDays === 0 ? null : successes / ratedDays * 100,
  }
}

export class StreakService {
  private readonly database: TaskTrackerDatabase

  constructor(database: TaskTrackerDatabase) {
    this.database = database
  }

  async getBooleanStatistics(endDate: LocalDate): Promise<BooleanHabitStatistics[]> {
    if (!isLocalDate(endDate)) throw new Error('Некорректная календарная дата.')
    return this.database.transaction('r', this.database.habits, this.database.habitEntries, async () => {
      const habits = (await this.database.habits.where('type').equals('boolean').toArray())
        .filter((habit): habit is BooleanHabit => habit.type === 'boolean' && habit.archivedAt === null)
        .filter((habit) => getHabitSchedule(habit).type === 'daily' && !isObservationalHabit(habit))
        .sort((a, b) => a.order - b.order)
      const entries = await this.database.habitEntries.where('date').belowOrEqual(endDate).toArray()
      const byHabit = new Map<string, HabitEntry[]>()
      for (const entry of entries) {
        const rows = byHabit.get(entry.habitId) ?? []
        rows.push(entry)
        byHabit.set(entry.habitId, rows)
      }
      const today = getLocalDate()
      return habits.map((habit) => {
        const rows = byHabit.get(habit.id) ?? []
        if (getMissingDataPolicy(habit) === 'manual') return { habit, ...calculateBooleanStreak(habit.id, rows, endDate) }
        const first = rows.reduce((start, row) => row.date < start ? row.date : start, getLocalDate(new Date(habit.createdAt)))
        const byDate = new Map(rows.map((entry) => [entry.date, entry]))
        const days = first > endDate ? [] : eachDayOfInterval({ start: parseISO(first), end: parseISO(endDate) }).map((day) => {
          const date = getLocalDate(day)
          return { date, ...resolveHabitResult(habit, byDate.get(date), date, today) }
        })
        return { habit, ...calculateBooleanResultStreak(days, endDate) }
      })
    })
  }
}

const streakService = new StreakService(db)
export const getBooleanHabitStatistics = (endDate: LocalDate) => streakService.getBooleanStatistics(endDate)
