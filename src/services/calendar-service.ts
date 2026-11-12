import { db, type TaskTrackerDatabase } from '../db/database'
import { getCalendarMonth } from '../lib/calendar'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import { readDurationMinutes } from './duration-service'
import { getAmountHabitResultProgress, HabitService } from './habit-service'
import { getHabitEntryDate, isHabitExpectedOnDate } from './habit-schedule'
import { resolveHabitResult } from './habit-result'
import { isObservationalHabit } from '../models/habit-policy'

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

export function computeDaySummary(habits: Habit[], entries: HabitEntry[], date: LocalDate, today: LocalDate = date): DaySummary {
  if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
  const byHabit = new Map(entries.map((entry) => [`${entry.habitId}:${entry.date}`, entry]))
  // A new definition must not add missing results to days before it existed.
  // Real backdated entries still belong to those days and remain visible.
  const supported = habits.filter((habit) => habit.archivedAt === null && habit.type !== 'rating'
    && isHabitExpectedOnDate(habit, date)
    && (getLocalDate(new Date(habit.createdAt)) <= date || byHabit.has(`${habit.id}:${getHabitEntryDate(habit, date)}`)))
  let recorded = 0
  let successes = 0
  let failures = 0
  for (const habit of supported) {
    const entry = byHabit.get(`${habit.id}:${getHabitEntryDate(habit, date)}`)
    if (entry && entry.type !== habit.type) throw new Error('Тип сохранённой записи не соответствует привычке.')
    const result = resolveHabitResult(habit, entry, date, today)
    if (result.type === 'boolean') {
      if (result.status === 'no-data') continue
      if (!isObservationalHabit(habit)) {
        if (result.status === 'success') successes += 1
        else failures += 1
      }
    } else if (habit.type === 'amount') {
      if (!getAmountHabitResultProgress(habit, entry, date, today).hasEntry) continue
    } else if (habit.type === 'duration') {
      if (!entry) continue
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
      const today = getLocalDate()
      const summaries = Object.fromEntries(grid.days.map(({ date: day }) => [day, computeDaySummary(habits, entries, day, today)]))
      return { habits, entries, summaries }
    })
  }
}

const calendarService = new CalendarService(db)
export const getCalendarMonthData = (date: LocalDate) => calendarService.getMonth(date)
