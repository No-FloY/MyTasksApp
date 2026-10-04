import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { getLocalDate, isLocalDate, type LocalDate } from './local-date'

export interface CalendarDay {
  date: LocalDate
  inMonth: boolean
}

export interface CalendarMonth {
  month: LocalDate
  startDate: LocalDate
  endDate: LocalDate
  days: CalendarDay[]
}

export function getCalendarMonth(date: LocalDate): CalendarMonth {
  if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
  const firstDay = startOfMonth(parseISO(date))
  const lastDay = endOfMonth(firstDay)
  const month = getLocalDate(firstDay)
  const start = startOfWeek(firstDay, { weekStartsOn: 1 })
  const end = endOfWeek(lastDay, { weekStartsOn: 1 })
  return {
    month,
    startDate: getLocalDate(start),
    endDate: getLocalDate(end),
    days: eachDayOfInterval({ start, end }).map((day) => ({
      date: getLocalDate(day),
      inMonth: day.getMonth() === firstDay.getMonth() && day.getFullYear() === firstDay.getFullYear(),
    })),
  }
}

export function shiftCalendarMonth(date: LocalDate, offset: number): LocalDate {
  if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
  if (!Number.isSafeInteger(offset)) throw new Error('Некорректное смещение месяца.')
  return getLocalDate(addMonths(startOfMonth(parseISO(date)), offset))
}
