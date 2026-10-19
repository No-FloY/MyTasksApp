import type { LocalDate } from '../../lib/local-date'
import type { AmountHabit } from '../../models/habit'
import type { HabitEntry } from '../../models/habit-entry'
import { getAmountHabitProgress } from '../habit-service'
import { getHabitPeriodDates, type StatisticsPeriod } from './period-utils'

export interface AmountStatistics {
  habit: AmountHabit
  days: { date: LocalDate; value: number | null }[]
  eligibleDays: number
  ineligibleDays: number
  average: number | null
  minimum: number | null
  maximum: number | null
  total: number | null
  daysWithData: number
  noDataCount: number
  successfulDays: number
  failedDays: number
  successRate: number | null
}

/** Amount rates and averages use recorded days, including explicit zero values. */
export function calculateAmountStatistics(
  habit: AmountHabit, entries: HabitEntry[], period: StatisticsPeriod, firstRecordedDate?: LocalDate,
): AmountStatistics {
  const byDate = new Map(entries.filter((entry) => entry.habitId === habit.id).map((entry) => [entry.date, entry]))
  const eligibleDays = getHabitPeriodDates(habit, entries, period, firstRecordedDate).length
  const days = period.dates.map((date) => {
    const result = getAmountHabitProgress(habit, byDate.get(date))
    return { date, value: result.hasEntry ? result.value : null }
  })
  // Validate configuration even when the habit did not exist in this period.
  getAmountHabitProgress(habit, undefined)
  const values = days.flatMap((day) => day.value === null ? [] : [day.value])
  const daysWithData = values.length
  const total = daysWithData === 0 ? null : values.reduce((sum, value) => sum + value, 0)
  const successfulDays = values.filter((value) => value >= habit.target).length
  return {
    habit, days, eligibleDays, ineligibleDays: days.length - eligibleDays,
    average: total === null ? null : total / daysWithData,
    minimum: daysWithData === 0 ? null : Math.min(...values),
    maximum: daysWithData === 0 ? null : Math.max(...values),
    total, daysWithData,
    noDataCount: eligibleDays - daysWithData,
    successfulDays,
    failedDays: daysWithData - successfulDays,
    successRate: daysWithData === 0 ? null : successfulDays / daysWithData * 100,
  }
}
