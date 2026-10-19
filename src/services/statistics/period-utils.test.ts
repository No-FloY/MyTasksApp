import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocalDate, isLocalDate, type LocalDate } from '../../lib/local-date'
import type { BooleanHabit } from '../../models/habit'
import type { BooleanHabitEntry } from '../../models/habit-entry'
import { getDateRange, getHabitPeriodDates, getStatisticsPeriod, getTimestampLocalDate, getWeekPeriods } from './period-utils'

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

const today = date('2026-10-16')
const habit: BooleanHabit = {
  id: 'english', name: 'Английский', description: '', type: 'boolean', order: 0,
  createdAt: '2026-10-13T12:00:00.000Z', updatedAt: '2026-10-13T12:00:00.000Z', archivedAt: null,
}
function entry(day: string): BooleanHabitEntry {
  return { habitId: habit.id, date: date(day), type: 'boolean', status: 'success', createdAt: habit.createdAt, updatedAt: habit.updatedAt }
}

afterEach(() => vi.unstubAllEnvs())

describe('statistics local calendar periods', () => {
  it('returns seven inclusive dates spanning December and January', () => {
    const result = getStatisticsPeriod('7d', date('2027-01-03'))
    expect(result).toMatchObject({ startDate: '2026-12-28', endDate: '2027-01-03', today: '2027-01-03' })
    expect(result.dates).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
  })

  it('uses the current calendar month only through today', () => {
    expect(getStatisticsPeriod('month', today)).toMatchObject({ startDate: '2026-10-01', endDate: today })
    expect(getStatisticsPeriod('month', today).dates).toHaveLength(16)
    expect(getStatisticsPeriod('month', date('2026-11-01')).dates).toEqual(['2026-11-01'])
  })

  it('returns a complete previous month including leap day and year boundaries', () => {
    const leap = getStatisticsPeriod('previous-month', date('2028-03-31'))
    expect(leap).toMatchObject({ startDate: '2028-02-01', endDate: '2028-02-29' })
    expect(leap.dates).toHaveLength(29)
    expect(getStatisticsPeriod('previous-month', date('2027-01-05'))).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-31' })
  })

  it.each([
    ['3m', '2026-07-17'], ['6m', '2026-04-17'], ['year', '2025-10-17'],
  ] as const)('defines %s as a rolling inclusive calendar-month interval', (preset, expected) => {
    expect(getStatisticsPeriod(preset, today)).toMatchObject({ startDate: expected, endDate: today })
  })

  it('clamps rolling month arithmetic at shorter months and includes leap years', () => {
    expect(getStatisticsPeriod('3m', date('2026-05-31')).startDate).toBe('2026-03-01')
    const leapYear = getStatisticsPeriod('year', date('2028-02-29'))
    expect(leapYear.startDate).toBe('2027-03-01')
    expect(leapYear.dates).toHaveLength(366)
  })

  it.each(['2026-03-10', '2026-11-03'])('preserves calendar dates across Los Angeles DST ending %s', (endDate) => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    const result = getStatisticsPeriod('7d', date(endDate))
    expect(result.dates).toHaveLength(7)
    expect(new Set(result.dates).size).toBe(7)
    expect(result.dates[6]).toBe(endDate)
    expect(result.startDate).toBe(endDate === '2026-03-10' ? '2026-03-04' : '2026-10-28')
  })

  it('uses the device calendar day for timestamps instead of their UTC date', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(getTimestampLocalDate('2026-10-16T01:30:00.000Z')).toBe('2026-10-15')
    expect(getStatisticsPeriod('month', getLocalDate(new Date('2026-11-01T01:30:00.000Z'))))
      .toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-31' })
    vi.stubEnv('TZ', 'Europe/Moscow')
    expect(getTimestampLocalDate('2026-10-15T22:30:00.000Z')).toBe('2026-10-16')
  })

  it('accepts a single custom day and includes both boundaries', () => {
    expect(getStatisticsPeriod('custom', today, { startDate: today, endDate: today }).dates).toEqual([today])
    expect(getDateRange(date('2028-02-28'), date('2028-03-01'))).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  })

  it.each([
    [{ startDate: '2026-02-30', endDate: today }, 'корректные даты'],
    [{ startDate: '2026-10-16', endDate: '2026-10-15' }, 'позже окончания'],
    [{ startDate: today, endDate: '2026-10-17' }, 'позже сегодняшнего'],
    [{ startDate: '1900-01-01', endDate: today }, '10 лет'],
  ])('rejects invalid, reversed, future, or excessive custom intervals', (custom, message) => {
    expect(() => getStatisticsPeriod('custom', today, custom)).toThrow(message)
  })

  it('rejects missing custom values and invalid branded dates', () => {
    expect(() => getStatisticsPeriod('custom', today)).toThrow('корректные даты')
    expect(() => getStatisticsPeriod('7d', '2026-02-30' as LocalDate)).toThrow('календарная дата')
    expect(() => getTimestampLocalDate('invalid')).toThrow()
  })

  it('clips Monday weeks at the selection boundaries without double counting', () => {
    const period = getStatisticsPeriod('custom', today, { startDate: '2026-09-30', endDate: '2026-10-13' })
    const weeks = getWeekPeriods(period)
    expect(weeks.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ['2026-09-30', '2026-10-04'], ['2026-10-05', '2026-10-11'], ['2026-10-12', '2026-10-13'],
    ])
    expect(weeks.flatMap((week) => week.dates)).toEqual(period.dates)
  })
})

describe('habit lifecycle inside a statistics period', () => {
  const period = getStatisticsPeriod('7d', today)

  it('counts only days starting on the local creation date for a newly added habit', () => {
    expect(getHabitPeriodDates(habit, [], period)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'])
    expect(getHabitPeriodDates({ ...habit, createdAt: '2026-10-18T10:00:00.000Z' }, [], period)).toEqual([])
  })

  it('includes the archival day without inventing empty days after it', () => {
    expect(getHabitPeriodDates({ ...habit, archivedAt: '2026-10-14T10:00:00.000Z' }, [], period))
      .toEqual(['2026-10-13', '2026-10-14'])
  })

  it('preserves backdated history and actual entries outside the archived lifecycle', () => {
    const archived = { ...habit, archivedAt: '2026-10-14T10:00:00.000Z' }
    const entries = [entry('2026-10-11'), entry('2026-10-16')]
    expect(getHabitPeriodDates(archived, entries, period)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-16'])
    expect(entries).toEqual([entry('2026-10-11'), entry('2026-10-16')])
  })

  it('uses local creation and archival dates near UTC midnight', () => {
    vi.stubEnv('TZ', 'Europe/Moscow')
    const localized = { ...habit, createdAt: '2026-10-12T22:30:00.000Z', archivedAt: '2026-10-13T22:30:00.000Z' }
    expect(getHabitPeriodDates(localized, [], period)).toEqual(['2026-10-13', '2026-10-14'])
  })
})
