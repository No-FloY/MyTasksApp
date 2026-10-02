import { format, isValid, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

declare const localDateBrand: unique symbol

/** A validated local calendar date, independent of an ISO timestamp's UTC day. */
export type LocalDate = string & { readonly [localDateBrand]: true }

export function isLocalDate(value: string): value is LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const date = parseISO(value)
  return isValid(date) && format(date, 'yyyy-MM-dd') === value
}

export function getLocalDate(date: Date = new Date()): LocalDate {
  if (!isValid(date)) throw new Error('Некорректная дата.')

  const value = format(date, 'yyyy-MM-dd')
  if (!isLocalDate(value)) throw new Error('Некорректная календарная дата.')
  return value
}

export function formatLocalDate(date: LocalDate): string {
  if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
  return format(parseISO(date), 'EEEE, d MMMM', { locale: ru })
}

export function delayUntilNextLocalDay(now: Date = new Date()): number {
  if (!isValid(now)) throw new Error('Некорректная дата.')

  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return nextDay.getTime() - now.getTime()
}
