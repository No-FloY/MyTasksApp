import { addDays, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import { getLocalDate, isLocalDate, type LocalDate } from '../../lib/local-date'
import type { Habit } from '../../models/habit'
import type { HabitEntry } from '../../models/habit-entry'

export type StatisticsPreset = '7d' | 'month' | 'previous-month' | '3m' | '6m' | 'year' | 'custom'

export interface StatisticsPeriod {
  preset: StatisticsPreset
  startDate: LocalDate
  endDate: LocalDate
  today: LocalDate
  dates: LocalDate[]
  label: string
}

/** Bound the number of daily points before allocating arrays or rendering charts. */
export const MAX_STATISTICS_DAYS = 3660

export function isStatisticsPreset(value: string): value is StatisticsPreset {
  return ['7d', 'month', 'previous-month', '3m', '6m', 'year', 'custom'].includes(value)
}

export function getTimestampLocalDate(timestamp: string): LocalDate {
  return getLocalDate(parseISO(timestamp))
}

/** Inclusive local calendar dates. Calendar arithmetic also works across DST changes. */
export function getDateRange(startDate: LocalDate, endDate: LocalDate): LocalDate[] {
  if (!isLocalDate(startDate) || !isLocalDate(endDate)) throw new Error('Некорректная календарная дата.')
  if (startDate > endDate) throw new Error('Начало периода не может быть позже окончания.')
  const count = differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1
  if (count > MAX_STATISTICS_DAYS) throw new Error('Выберите период не длиннее 10 лет (3660 дней).')
  return Array.from({ length: count }, (_, index) => getLocalDate(addDays(parseISO(startDate), index)))
}

export function isDateInPeriod(date: string, period: Pick<StatisticsPeriod, 'startDate' | 'endDate'>): boolean {
  return date >= period.startDate && date <= period.endDate
}

function periodLabel(startDate: LocalDate, endDate: LocalDate): string {
  return `${format(parseISO(startDate), 'd MMM yyyy', { locale: ru })} — ${format(parseISO(endDate), 'd MMM yyyy', { locale: ru })}`
}

export function getStatisticsPeriod(
  preset: StatisticsPreset,
  today: LocalDate,
  custom?: { startDate: string; endDate: string },
): StatisticsPeriod {
  if (!isLocalDate(today)) throw new Error('Некорректная календарная дата.')
  if (!isStatisticsPreset(preset)) throw new Error('Неизвестный период статистики.')
  const todayDate = parseISO(today)
  let startDate: LocalDate
  let endDate = today
  switch (preset) {
    case '7d': startDate = getLocalDate(addDays(todayDate, -6)); break
    case 'month': startDate = getLocalDate(startOfMonth(todayDate)); break
    case 'previous-month': {
      const previousMonth = subMonths(todayDate, 1)
      startDate = getLocalDate(startOfMonth(previousMonth))
      endDate = getLocalDate(endOfMonth(previousMonth))
      break
    }
    case '3m':
    case '6m':
    case 'year':
      startDate = getLocalDate(addDays(subMonths(todayDate, preset === '3m' ? 3 : preset === '6m' ? 6 : 12), 1))
      break
    case 'custom':
      if (!custom || !isLocalDate(custom.startDate) || !isLocalDate(custom.endDate)) {
        throw new Error('Укажите корректные даты начала и окончания периода.')
      }
      startDate = custom.startDate
      endDate = custom.endDate
      break
  }
  if (endDate > today) throw new Error('Окончание периода не может быть позже сегодняшнего дня.')
  const dates = getDateRange(startDate, endDate)
  return { preset, startDate, endDate, today, dates, label: periodLabel(startDate, endDate) }
}

/** Monday-based weeks, clipped to the selected interval rather than padded with extra days. */
export function getWeekPeriods(period: StatisticsPeriod): StatisticsPeriod[] {
  const weeks: StatisticsPeriod[] = []
  let startDate = period.startDate
  while (startDate <= period.endDate) {
    const sunday = getLocalDate(addDays(startOfWeek(parseISO(startDate), { weekStartsOn: 1 }), 6))
    const endDate = sunday < period.endDate ? sunday : period.endDate
    weeks.push(getStatisticsPeriod('custom', period.today, { startDate, endDate }))
    startDate = getLocalDate(addDays(parseISO(endDate), 1))
  }
  return weeks
}

/**
 * Days before creation and after archival are not missing results. An earlier saved
 * entry establishes an earlier start (the calendar permits backdating). Actual
 * records after archival remain visible without adding empty post-archive days.
 */
export function getHabitPeriodDates(
  habit: Habit, entries: HabitEntry[], period: StatisticsPeriod, firstRecordedDate?: LocalDate,
): LocalDate[] {
  let firstDay = getTimestampLocalDate(habit.createdAt)
  if (firstRecordedDate !== undefined) {
    if (!isLocalDate(firstRecordedDate)) throw new Error('Некорректная дата в истории привычки.')
    if (firstRecordedDate < firstDay) firstDay = firstRecordedDate
  }
  const lastDay = habit.archivedAt === null ? period.today : getTimestampLocalDate(habit.archivedAt)
  const recordedDates = new Set<LocalDate>()
  for (const entry of entries) {
    if (entry.habitId !== habit.id || entry.date > period.today) continue
    if (!isLocalDate(entry.date)) throw new Error('Некорректная дата в истории привычки.')
    if (entry.date < firstDay) firstDay = entry.date
    recordedDates.add(entry.date)
  }
  return period.dates.filter((date) => (date >= firstDay && date <= lastDay) || recordedDates.has(date))
}
