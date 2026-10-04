import { addDays, parseISO } from 'date-fns'
import { db, type TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { DurationHabit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import type { DurationRatingRange } from '../models/duration-rating'
import { getDurationRating, readDurationMinutes, validateRatingRanges } from './duration-service'

export interface DurationDay {
  date: LocalDate
  minutes: number | null
  rating: DurationRatingRange | null
}

export interface DurationWeek {
  habit: DurationHabit
  days: DurationDay[]
  totalMinutes: number
  averageMinutes: number | null
  recordedDays: number
  missingDays: number
  ratingCounts: { rating: DurationRatingRange; days: number }[]
}

export function getLastSevenDates(endDate: LocalDate): LocalDate[] {
  if (!isLocalDate(endDate)) throw new Error('Некорректная календарная дата.')
  return Array.from({ length: 7 }, (_, index) => getLocalDate(addDays(parseISO(endDate), index - 6)))
}

export function calculateDurationWeek(habit: DurationHabit, entries: HabitEntry[], endDate: LocalDate): DurationWeek {
  validateRatingRanges(habit.ratingRanges)
  const byDate = new Map(entries.filter((entry) => entry.habitId === habit.id).map((entry) => [entry.date, entry]))
  const days = getLastSevenDates(endDate).map((date): DurationDay => {
    const minutes = readDurationMinutes(byDate.get(date))
    return { date, minutes, rating: minutes === null ? null : getDurationRating(minutes, habit.ratingRanges) }
  })
  const recordedDays = days.filter((day) => day.minutes !== null).length
  const totalMinutes = days.reduce((total, day) => total + (day.minutes ?? 0), 0)
  return {
    habit, days, totalMinutes, recordedDays,
    averageMinutes: recordedDays === 0 ? null : totalMinutes / recordedDays,
    missingDays: 7 - recordedDays,
    ratingCounts: habit.ratingRanges.map((rating) => ({ rating, days: days.filter((day) => day.rating?.id === rating.id).length })),
  }
}

export class DurationStatisticsService {
  private readonly database: TaskTrackerDatabase

  constructor(database: TaskTrackerDatabase) {
    this.database = database
  }

  async getWeeklyStatistics(endDate: LocalDate): Promise<DurationWeek[]> {
    const startDate = getLastSevenDates(endDate)[0]
    if (!startDate) throw new Error('Не удалось определить период.')
    return this.database.transaction('r', this.database.habits, this.database.habitEntries, async () => {
      const habits = await this.database.habits.where('type').equals('duration').toArray()
      const entries = await this.database.habitEntries.where('date').between(startDate, endDate, true, true).toArray()
      return habits.filter((habit): habit is DurationHabit => habit.type === 'duration' && habit.archivedAt === null)
        .sort((a, b) => a.order - b.order)
        .map((habit) => calculateDurationWeek(habit, entries, endDate))
    })
  }
}

const statisticsService = new DurationStatisticsService(db)
export const getDurationWeeklyStatistics = (endDate: LocalDate) => statisticsService.getWeeklyStatistics(endDate)
