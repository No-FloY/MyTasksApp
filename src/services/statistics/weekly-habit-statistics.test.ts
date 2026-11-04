import { describe, expect, it } from 'vitest'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { BooleanHabit } from '../../models/habit'
import type { BooleanHabitStatus, HabitEntry } from '../../models/habit-entry'
import { calculateWeeklyHabitStatistics } from './weekly-habit-statistics'
import { getStatisticsPeriod } from './period-utils'

const timestamp = '2026-09-01T10:00:00.000Z'
const cleaning: BooleanHabit = { id: 'cleaning', name: 'Уборка', description: '', order: 0, category: 'routine',
  type: 'boolean', schedule: { type: 'weekly' }, createdAt: timestamp, updatedAt: timestamp, archivedAt: null }
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
const today = date('2026-10-28')
function period(from: string, to: string, now = today) {
  return getStatisticsPeriod('custom', now, { startDate: from, endDate: to })
}
function mark(day: string, status: BooleanHabitStatus): HabitEntry {
  return { habitId: 'cleaning', date: date(day), type: 'boolean', status, createdAt: timestamp, updatedAt: timestamp }
}

describe('weekly habit statistics', () => {
  it('counts successes, explicit failures and explicit no-data as single weeks', () => {
    const result = calculateWeeklyHabitStatistics(cleaning, [mark('2026-10-05', 'success'),
      mark('2026-10-12', 'failure'), mark('2026-10-19', 'no-data')], period('2026-10-05', '2026-10-25'))
    expect(result).toMatchObject({ eligibleWeeks: 3, successCount: 1, failureCount: 1, noDataCount: 1,
      markedCount: 2, successRate: 50 })
    expect(result.weeks.every((week) => !week.inferredFailure)).toBe(true)
  })

  it('infers a missing completed week without writing a synthetic entry', () => {
    const entries: HabitEntry[] = []
    const result = calculateWeeklyHabitStatistics(cleaning, entries, period('2026-10-19', '2026-10-25'))
    expect(result).toMatchObject({ eligibleWeeks: 1, failureCount: 1, successRate: 0 })
    expect(result.weeks[0]).toMatchObject({ startDate: '2026-10-19', endDate: '2026-10-25',
      status: 'failure', inferredFailure: true, entry: undefined })
    expect(entries).toEqual([])
  })

  it('keeps the current unfinished week without a result as no-data', () => {
    expect(calculateWeeklyHabitStatistics(cleaning, [], period('2026-10-26', '2026-10-28')))
      .toMatchObject({ eligibleWeeks: 1, failureCount: 0, noDataCount: 1, successRate: null })
  })

  it('does not infer failure while Sunday is still in progress', () => {
    expect(calculateWeeklyHabitStatistics(cleaning, [], period('2026-10-19', '2026-10-25', date('2026-10-25'))))
      .toMatchObject({ failureCount: 0, noDataCount: 1 })
  })

  it.each([['2026-10-20', '2026-10-25'], ['2026-10-19', '2026-10-24']])(
    'keeps an incomplete boundary %s..%s as no-data when there is no explicit result', (from, to) => {
      expect(calculateWeeklyHabitStatistics(cleaning, [], period(from, to)))
        .toMatchObject({ eligibleWeeks: 1, failureCount: 0, noDataCount: 1 })
      expect(calculateWeeklyHabitStatistics(cleaning, [mark('2026-10-19', 'success')], period(from, to)))
        .toMatchObject({ eligibleWeeks: 1, successCount: 1, noDataCount: 0 })
    },
  )

  it('does not penalize a partial creation or archival week', () => {
    const range = period('2026-10-19', '2026-10-25')
    expect(calculateWeeklyHabitStatistics({ ...cleaning, createdAt: '2026-10-21T10:00:00.000Z' }, [], range))
      .toMatchObject({ eligibleWeeks: 1, failureCount: 0, noDataCount: 1 })
    expect(calculateWeeklyHabitStatistics({ ...cleaning, archivedAt: '2026-10-23T10:00:00.000Z' }, [], range))
      .toMatchObject({ eligibleWeeks: 1, failureCount: 0, noDataCount: 1 })
    expect(calculateWeeklyHabitStatistics({ ...cleaning, createdAt: '2026-10-26T10:00:00.000Z' }, [], range).eligibleWeeks).toBe(0)
  })

  it('uses earlier backdated keys to establish tracked weeks but preserves archived explicit history', () => {
    const range = period('2026-10-19', '2026-10-25')
    const laterCreated = { ...cleaning, createdAt: '2026-10-28T10:00:00.000Z' }
    expect(calculateWeeklyHabitStatistics(laterCreated, [], range, date('2026-10-05')).failureCount).toBe(1)
    expect(calculateWeeklyHabitStatistics({ ...cleaning, archivedAt: '2026-10-10T10:00:00.000Z' },
      [mark('2026-10-19', 'success')], range)).toMatchObject({ eligibleWeeks: 1, successCount: 1 })
  })

  it('spans calendar months and years without duplicating a week', () => {
    const range = period('2026-12-28', '2027-01-10', date('2027-01-11'))
    expect(calculateWeeklyHabitStatistics(cleaning, [mark('2026-12-28', 'success')], range))
      .toMatchObject({ eligibleWeeks: 2, successCount: 1, failureCount: 1 })
  })
})
