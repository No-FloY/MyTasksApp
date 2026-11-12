import type { LocalDate } from '../../lib/local-date'
import type { Habit } from '../../models/habit'
import type { BooleanHabitStatus, HabitEntry } from '../../models/habit-entry'
import { getWeekEnd, getWeekStart } from '../habit-schedule'
import { getHabitPeriodDates, type StatisticsPeriod } from './period-utils'
import { resolveHabitResult, type HabitResultSource } from '../habit-result'

export interface WeeklyHabitOccurrence {
  startDate: LocalDate
  endDate: LocalDate
  entry: HabitEntry | undefined
  /** A closed, unrecorded week is derived as failure; nothing is written to storage. */
  status: BooleanHabitStatus
  inferredFailure: boolean
  source: HabitResultSource
}

/** One occurrence for each calendar week intersecting the habit's tracked period. */
export function getWeeklyHabitOccurrences(
  habit: Habit, entries: HabitEntry[], period: StatisticsPeriod, firstRecordedDate?: LocalDate,
): WeeklyHabitOccurrence[] {
  const rows = entries.filter((entry) => entry.habitId === habit.id && entry.date <= period.endDate)
  const byWeek = new Map(rows.map((entry) => [getWeekStart(entry.date), entry]))
  const dates = getHabitPeriodDates(habit, rows, period, firstRecordedDate)
  const weeks = [...new Set(dates.map(getWeekStart))]
  return weeks.map((startDate) => {
    const endDate = getWeekEnd(startDate)
    const entry = byWeek.get(startDate)
    if (entry && entry.type !== habit.type) throw new Error('Тип записи не соответствует привычке.')
    const wholeSelectedWeek = startDate >= period.startDate && endDate <= period.endDate
    const result = resolveHabitResult(wholeSelectedWeek ? habit : { ...habit, missingDataPolicy: 'manual' }, entry, startDate, period.today)
    const status = result.type === 'boolean' ? result.status : result.source === 'inferred' ? 'failure' : 'no-data'
    const inferredFailure = result.source === 'inferred' && status === 'failure'
    return { startDate, endDate, entry, status, inferredFailure, source: result.source }
  })
}

export function calculateWeeklyHabitStatistics(
  habit: Habit, entries: HabitEntry[], period: StatisticsPeriod, firstRecordedDate?: LocalDate,
) {
  const weeks = getWeeklyHabitOccurrences(habit, entries, period, firstRecordedDate)
  const successCount = weeks.filter((week) => week.status === 'success').length
  const failureCount = weeks.filter((week) => week.status === 'failure').length
  const markedCount = successCount + failureCount
  return { habit, weeks, eligibleWeeks: weeks.length, successCount, failureCount,
    noDataCount: weeks.length - markedCount, markedCount,
    successRate: markedCount === 0 ? null : successCount / markedCount * 100 }
}
