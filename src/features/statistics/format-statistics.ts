import { format, parseISO } from 'date-fns'
import { formatDuration } from '@/services/duration-service'

export const formatNumber = (value: number | null) => value === null ? 'Нет данных' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)
export const formatRate = (value: number | null) => value === null ? 'Нет данных' : `${formatNumber(value)}%`
export const formatMinutes = (value: number | null) => value === null ? 'Нет данных' : `${Number.isInteger(value) ? '' : '≈ '}${formatDuration(value)}`
export const spansCalendarYears = (startDate: string | undefined, endDate: string | undefined) =>
  startDate !== undefined && endDate !== undefined && startDate.slice(0, 4) !== endDate.slice(0, 4)
export const formatStatisticsDate = (date: string, includeYear = false) => format(parseISO(date), includeYear ? 'dd.MM.yyyy' : 'dd.MM')
