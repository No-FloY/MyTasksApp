import { parseISO } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCalendarMonth, shiftCalendarMonth } from './calendar'
import { getLocalDate, isLocalDate, type LocalDate } from './local-date'

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

afterEach(() => vi.unstubAllEnvs())

describe('monthly calendar grid', () => {
  it('includes all October dates and adjacent days through full Monday–Sunday weeks', () => {
    const grid = getCalendarMonth(date('2026-10-04'))
    expect(grid.month).toBe('2026-10-01')
    expect(grid.startDate).toBe('2026-09-28')
    expect(grid.endDate).toBe('2026-11-01')
    expect(grid.days).toHaveLength(35)
    expect(grid.days.filter((day) => day.inMonth)).toHaveLength(31)
    expect(grid.days[0]).toEqual({ date: '2026-09-28', inMonth: false })
    expect(grid.days.at(-1)).toEqual({ date: '2026-11-01', inMonth: false })
    for (let week = 0; week < grid.days.length; week += 7) {
      expect(parseISO(grid.days[week]!.date).getDay()).toBe(1)
      expect(parseISO(grid.days[week + 6]!.date).getDay()).toBe(0)
    }
    expect(new Set(grid.days.map((day) => day.date)).size).toBe(grid.days.length)
  })

  it.each([['2026-02-05', 28], ['2028-02-29', 29], ['2000-02-20', 29], ['2100-02-20', 28]])(
    'includes the correct February length for %s', (input, days) => {
      const inMonth = getCalendarMonth(date(String(input))).days.filter((day) => day.inMonth)
      expect(inMonth).toHaveLength(Number(days))
      expect(inMonth[0]?.date).toBe(`${String(input).slice(0, 7)}-01`)
      expect(inMonth.at(-1)?.date).toBe(`${String(input).slice(0, 7)}-${days}`)
    },
  )

  it('uses four rows when February exactly fills four calendar weeks', () => {
    const grid = getCalendarMonth(date('2027-02-18'))
    expect(grid.days).toHaveLength(28)
    expect(grid.days.every((day) => day.inMonth)).toBe(true)
  })

  it('uses six rows when required and includes dates across the previous year', () => {
    expect(getCalendarMonth(date('2026-03-01')).days).toHaveLength(42)
    expect(getCalendarMonth(date('2027-01-01')).startDate).toBe('2026-12-28')
  })

  it.each(['Europe/Moscow', 'America/Los_Angeles'])('retains local calendar dates in %s across DST', (timezone) => {
    vi.stubEnv('TZ', timezone)
    const march = getCalendarMonth(date('2026-03-08'))
    expect(march.month).toBe('2026-03-01')
    expect(march.days.filter((day) => day.inMonth).map((day) => day.date)).toEqual(
      Array.from({ length: 31 }, (_, index) => getLocalDate(new Date(2026, 2, index + 1))),
    )
    const november = getCalendarMonth(date('2026-11-01'))
    expect(november.days.filter((day) => day.inMonth)).toHaveLength(30)
    expect(new Set(november.days.map((day) => day.date)).size).toBe(november.days.length)
  })

  it('rejects malformed dates', () => {
    expect(() => getCalendarMonth('2026-02-30' as LocalDate)).toThrow('Некорректная')
  })
})

describe('calendar month navigation', () => {
  it.each([
    ['2026-12-31', 1, '2027-01-01'], ['2027-01-31', -1, '2026-12-01'],
    ['2026-01-31', 1, '2026-02-01'], ['2028-02-29', 12, '2029-02-01'],
    ['2026-10-04', 0, '2026-10-01'],
  ])('shifts %s by %s months to %s', (input, offset, expected) => {
    expect(shiftCalendarMonth(date(String(input)), Number(offset))).toBe(expected)
  })

  it('rejects invalid dates and non-integral offsets', () => {
    expect(() => shiftCalendarMonth('2026-02-30' as LocalDate, 1)).toThrow('Некорректная')
    for (const offset of [NaN, Infinity, 0.5]) {
      expect(() => shiftCalendarMonth(date('2026-10-04'), offset)).toThrow('смещение')
    }
  })
})
