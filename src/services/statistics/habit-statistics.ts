import type { LocalDate } from '../../lib/local-date'
import type { BooleanHabit } from '../../models/habit'
import type { BooleanHabitStatus, HabitEntry } from '../../models/habit-entry'
import { calculateBooleanResultStreak } from '../streak-service'
import { resolveHabitResult, type HabitResultSource } from '../habit-result'
import { isHabitExpectedOnDate } from '../habit-schedule'
import { getHabitPeriodDates, type StatisticsPeriod } from './period-utils'

export interface BooleanStatistics {
  habit: BooleanHabit
  days: { date: LocalDate; status: BooleanHabitStatus; source: HabitResultSource }[]
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
  const recordedDates = new Set(entries.filter((entry) => entry.habitId === habit.id).map((entry) => entry.date))
  const dates = getHabitPeriodDates(habit, entries, period, firstRecordedDate)
    .filter((date) => isHabitExpectedOnDate(habit, date) || recordedDates.has(date))
  const eligibleDates = new Set(dates)
  const selectedEntries = entries.filter((entry) => entry.habitId === habit.id && eligibleDates.has(entry.date))
  const byDate = new Map(selectedEntries.map((entry) => [entry.date, entry]))
  const days = dates.map((date) => {
    const entry = byDate.get(date)
    if (entry && entry.type !== 'boolean') throw new Error('Тип записи не соответствует привычке.')
    const result = resolveHabitResult(habit, entry, date, period.today)
    return { date, status: result.status, source: result.source }
  })
  const streak = calculateBooleanResultStreak(days, period.endDate)
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
