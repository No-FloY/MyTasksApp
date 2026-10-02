import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  delayUntilNextLocalDay,
  formatLocalDate,
  getLocalDate,
  isLocalDate,
  type LocalDate,
} from './local-date'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local calendar dates', () => {
  it('uses the local calendar day near midnight east of UTC', () => {
    vi.stubEnv('TZ', 'Europe/Moscow')
    expect(getLocalDate(new Date('2026-10-01T22:30:00Z'))).toBe('2026-10-02')
  })

  it('uses the local calendar day near midnight west of UTC', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(getLocalDate(new Date('2026-10-02T01:30:00Z'))).toBe('2026-10-01')
  })

  it('validates actual calendar dates including leap years', () => {
    expect(isLocalDate('2028-02-29')).toBe(true)
    expect(isLocalDate('2026-02-29')).toBe(false)
    expect(isLocalDate('2026-04-31')).toBe(false)
    expect(isLocalDate('2026-13-01')).toBe(false)
    expect(isLocalDate('2026-1-01')).toBe(false)
    expect(isLocalDate('2026-10-02T00:00:00Z')).toBe(false)
  })

  it('formats a date using Russian names without shifting the day', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(formatLocalDate(getLocalDate(new Date(2026, 9, 2)))).toBe('пятница, 2 октября')
  })

  it('rejects invalid dates instead of producing a broken storage key', () => {
    expect(() => getLocalDate(new Date('invalid'))).toThrow()
    expect(() => formatLocalDate('2026-02-30' as LocalDate)).toThrow()
    expect(() => delayUntilNextLocalDay(new Date('invalid'))).toThrow()
  })

  it('schedules the next local day across a year boundary', () => {
    vi.stubEnv('TZ', 'Europe/Moscow')
    expect(delayUntilNextLocalDay(new Date(2026, 11, 31, 23, 59, 59, 750))).toBe(250)
  })

  it('accounts for both shorter and longer days during daylight saving changes', () => {
    vi.stubEnv('TZ', 'America/New_York')
    expect(delayUntilNextLocalDay(new Date(2026, 2, 8))).toBe(23 * 60 * 60 * 1000)
    expect(delayUntilNextLocalDay(new Date(2026, 10, 1))).toBe(25 * 60 * 60 * 1000)
  })
})
