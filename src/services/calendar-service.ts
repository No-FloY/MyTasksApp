import { db, type TaskTrackerDatabase } from '../db/database'
import { getCalendarMonth } from '../lib/calendar'
import { isLocalDate, type LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import { readDurationMinutes } from './duration-service'
import { getAmountHabitProgress, HabitService } from './habit-service'

export interface DaySummary {
  status: 'no-data' | 'partial' | 'complete'
  recorded: number
  total: number
  /** Success/failure apply only to boolean results, independently of how fully the day is recorded. */
  successes: number
  failures: number
}

export interface CalendarMonthData {
  habits: Habit[]
  entries: HabitEntry[]
  summaries: Record<string, DaySummary>
}

export function computeDaySummary(habits: Habit[], entries: HabitEntry[], date: LocalDate): DaySummary {
  if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
  const supported = habits.filter((habit) => habit.archivedAt === null && habit.type !== 'rating')
  const byHabit = new Map(entries.filter((entry) => entry.date === date).map((entry) => [entry.habitId, entry]))
  let recorded = 0
  let successes = 0
  let failures = 0
  for (const habit of supported) {
    const entry = byHabit.get(habit.id)
    if (!entry) continue
    if (habit.type !== entry.type) throw new Error('Тип сохранённой записи не соответствует привычке.')
    if (entry.type === 'boolean') {
      if (entry.status === 'no-data') continue
      if (entry.status !== 'success' && entry.status !== 'failure') throw new Error('Некорректный результат привычки.')
      if (entry.status === 'success') successes += 1
      else failures += 1
    } else if (habit.type === 'amount') {
      getAmountHabitProgress(habit, entry)
    } else if (habit.type === 'duration') {
      readDurationMinutes(entry)
    }
    recorded += 1
  }
  return {
    status: recorded === 0 ? 'no-data' : recorded === supported.length ? 'complete' : 'partial',
    recorded, total: supported.length, successes, failures,
  }
}

export class CalendarService {
  private readonly database: TaskTrackerDatabase
  private readonly habitService: HabitService

  constructor(database: TaskTrackerDatabase) {
    this.database = database
    this.habitService = new HabitService(database)
  }

  async getMonth(date: LocalDate): Promise<CalendarMonthData> {
    const grid = getCalendarMonth(date)
    // A single indexed range read and one habits read also let liveQuery observe the whole visible month.
    return this.database.transaction('r', this.database.habits, this.database.habitEntries, async () => {
      const habits = await this.database.habits.orderBy('order').toArray()
      const entries = await this.habitService.getEntriesForDateRange(grid.startDate, grid.endDate)
      const summaries = Object.fromEntries(grid.days.map(({ date: day }) => [day, computeDaySummary(habits, entries, day)]))
      return { habits, entries, summaries }
    })
  }
}

const calendarService = new CalendarService(db)
export const getCalendarMonthData = (date: LocalDate) => calendarService.getMonth(date)
