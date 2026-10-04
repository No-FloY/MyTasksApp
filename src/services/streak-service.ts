import { addDays, parseISO } from 'date-fns'
import { db, type TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { BooleanHabit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'

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
  let successes = 0
  let failures = 0
  let streak = 0
  let bestStreak = 0
  let previousSuccess: LocalDate | null = null
  for (const entry of history) {
    if (!isLocalDate(entry.date)) throw new Error('Некорректная дата в истории привычки.')
    if (entry.type !== 'boolean') throw new Error('Тип записи не соответствует привычке.')
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
        .sort((a, b) => a.order - b.order)
      return Promise.all(habits.map(async (habit) => {
        const entries = await this.database.habitEntries.where('[habitId+date]')
          .between([habit.id, '0000-01-01'], [habit.id, endDate], true, true).toArray()
        return { habit, ...calculateBooleanStreak(habit.id, entries, endDate) }
      }))
    })
  }
}

const streakService = new StreakService(db)
export const getBooleanHabitStatistics = (endDate: LocalDate) => streakService.getBooleanStatistics(endDate)
