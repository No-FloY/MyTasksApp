import type { DurationHabit } from '../../models/habit'
import type { LocalDate } from '../../lib/local-date'
import type { HabitEntry } from '../../models/habit-entry'
import { getDurationRating, readDurationMinutes, validateRatingRanges } from '../duration-service'
import type { DurationDay, DurationWeek } from '../duration-statistics-service'
import { getHabitPeriodDates, type StatisticsPeriod } from './period-utils'

export interface DurationStatistics extends DurationWeek {
  eligibleDays: number
  ineligibleDays: number
  /** Missing results only while the habit existed; missingDays includes chart gaps. */
  noDataCount: number
  /** Recorded total divided by eligible calendar days; gaps are not claimed as recorded zeroes. */
  averagePerDayMinutes: number | null
  minimumMinutes: number | null
  maximumMinutes: number | null
}

export function calculateDurationStatistics(
  habit: DurationHabit, entries: HabitEntry[], period: StatisticsPeriod, firstRecordedDate?: LocalDate,
): DurationStatistics {
  validateRatingRanges(habit.ratingRanges)
  const byDate = new Map(entries.filter((entry) => entry.habitId === habit.id).map((entry) => [entry.date, entry]))
  const eligibleDays = getHabitPeriodDates(habit, entries, period, firstRecordedDate).length
  const days = period.dates.map((date): DurationDay => {
    const minutes = readDurationMinutes(byDate.get(date))
    return { date, minutes, rating: minutes === null ? null : getDurationRating(minutes, habit.ratingRanges) }
  })
  const values = days.flatMap((day) => day.minutes === null ? [] : [day.minutes])
  const recordedDays = values.length
  const totalMinutes = values.reduce((sum, minutes) => sum + minutes, 0)
  return {
    habit, days, eligibleDays, ineligibleDays: days.length - eligibleDays, totalMinutes, recordedDays,
    averageMinutes: recordedDays === 0 ? null : totalMinutes / recordedDays,
    averagePerDayMinutes: recordedDays === 0 ? null : totalMinutes / eligibleDays,
    minimumMinutes: recordedDays === 0 ? null : Math.min(...values),
    maximumMinutes: recordedDays === 0 ? null : Math.max(...values),
    missingDays: days.length - recordedDays,
    noDataCount: eligibleDays - recordedDays,
    ratingCounts: habit.ratingRanges.map((rating) => ({ rating, days: days.filter((day) => day.rating?.id === rating.id).length })),
  }
}
