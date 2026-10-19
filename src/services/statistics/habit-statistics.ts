import type { LocalDate } from '../../lib/local-date'
import type { BooleanHabit } from '../../models/habit'
import type { BooleanHabitStatus, HabitEntry } from '../../models/habit-entry'
import { calculateBooleanStreak } from '../streak-service'
import { getHabitPeriodDates, type StatisticsPeriod } from './period-utils'

export interface BooleanStatistics {
  habit: BooleanHabit
  days: { date: LocalDate; status: BooleanHabitStatus }[]
  eligibleDays: number
  successCount: number
  failureCount: number
  noDataCount: number
  markedCount: number
  successRate: number | null
  currentStreak: number
  bestStreak: number
}

/** Streaks are restricted to this period; the current streak ends on its last day. */
export function calculateBooleanStatistics(
  habit: BooleanHabit, entries: HabitEntry[], period: StatisticsPeriod, firstRecordedDate?: LocalDate,
): BooleanStatistics {
  const dates = getHabitPeriodDates(habit, entries, period, firstRecordedDate)
  const eligibleDates = new Set(dates)
  const selectedEntries = entries.filter((entry) => entry.habitId === habit.id && eligibleDates.has(entry.date))
  const byDate = new Map(selectedEntries.map((entry) => [entry.date, entry]))
  const days = dates.map((date) => {
    const entry = byDate.get(date)
    if (entry && entry.type !== 'boolean') throw new Error('Тип записи не соответствует привычке.')
    return { date, status: entry?.status ?? 'no-data' as const }
  })
  const streak = calculateBooleanStreak(habit.id, selectedEntries, period.endDate)
  const markedCount = streak.successes + streak.failures
  return {
    habit, days, eligibleDays: days.length,
    successCount: streak.successes,
    failureCount: streak.failures,
    noDataCount: days.length - markedCount,
    markedCount,
    successRate: streak.successRate,
    currentStreak: streak.currentStreak,
    bestStreak: streak.bestStreak,
  }
}
