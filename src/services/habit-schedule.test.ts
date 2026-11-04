import { describe, expect, it } from 'vitest'
import { isLocalDate, type LocalDate } from '../lib/local-date'
import type { HabitSchedule } from '../models/habit-schedule'
import { getHabitEntryDate, getHabitSchedule, getWeekEnd, getWeekStart, isHabitExpectedOnDate, isWeeklyHabit } from './habit-schedule'

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

describe('universal habit schedules', () => {
  it('treats legacy habits and explicit daily schedules as expected every day', () => {
    expect(getHabitSchedule({})).toEqual({ type: 'daily' })
    for (const day of ['2026-10-26', '2026-10-27', '2026-11-01']) {
      expect(isHabitExpectedOnDate({}, date(day))).toBe(true)
      expect(isHabitExpectedOnDate({ schedule: { type: 'daily' } }, date(day))).toBe(true)
      expect(getHabitEntryDate({}, date(day))).toBe(day)
    }
  })

  it('makes an unscheduled weekly habit a single occurrence with no daily expectation', () => {
    const habit = { schedule: { type: 'weekly' } as HabitSchedule }
    expect(isWeeklyHabit(habit)).toBe(true)
    for (const day of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']) {
      expect(isHabitExpectedOnDate(habit, date(day))).toBe(false)
      expect(getHabitEntryDate(habit, date(day))).toBe('2026-10-26')
    }
  })

  it('expects assigned weekly habits only on their ISO weekday', () => {
    const habit = { schedule: { type: 'weekly', weekday: 7 } as HabitSchedule }
    expect(isHabitExpectedOnDate(habit, date('2026-10-31'))).toBe(false)
    expect(isHabitExpectedOnDate(habit, date('2026-11-01'))).toBe(true)
    expect(getHabitEntryDate(habit, date('2026-11-01'))).toBe('2026-10-26')
  })

  it('supports weekday-only and three scheduled days without special habit IDs', () => {
    const weekdays = { schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5] } as HabitSchedule }
    const threeDays = { schedule: { type: 'weekdays', days: [1, 3, 5] } as HabitSchedule }
    expect(isHabitExpectedOnDate(weekdays, date('2026-10-30'))).toBe(true)
    expect(isHabitExpectedOnDate(weekdays, date('2026-10-31'))).toBe(false)
    expect(isHabitExpectedOnDate(threeDays, date('2026-10-28'))).toBe(true)
    expect(isHabitExpectedOnDate(threeDays, date('2026-10-29'))).toBe(false)
    expect(isWeeklyHabit(threeDays)).toBe(false)
  })

  it('uses local calendar week boundaries across months, years and DST dates', () => {
    expect(getWeekStart(date('2027-01-01'))).toBe('2026-12-28')
    expect(getWeekEnd(date('2027-01-01'))).toBe('2027-01-03')
    expect(getWeekStart(date('2026-11-01'))).toBe('2026-10-26')
    expect(getWeekEnd(date('2026-11-01'))).toBe('2026-11-01')
    expect(getWeekStart(date('2026-11-02'))).toBe('2026-11-02')
  })
})
