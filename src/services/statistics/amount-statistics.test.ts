import { describe, expect, it } from 'vitest'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { AmountHabit } from '../../models/habit'
import type { AmountHabitEntry } from '../../models/habit-entry'
import { calculateAmountStatistics } from './amount-statistics'
import { getStatisticsPeriod } from './period-utils'

const timestamp = '2026-09-20T10:00:00.000Z'
const habit: AmountHabit = { id: 'water', name: 'Вода', type: 'amount', unit: 'мл', target: 2000, description: '', order: 0, createdAt: timestamp, updatedAt: timestamp, archivedAt: null }
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
function entry(day: string, value: number, habitId = habit.id): AmountHabitEntry {
  return { habitId, date: date(day), type: 'amount', value, createdAt: timestamp, updatedAt: timestamp }
}
const period = getStatisticsPeriod('7d', date('2026-10-16'))

describe('amount statistics', () => {
  it('keeps actual over-target values and calculates average/min/max/total only from recorded days', () => {
    const entries = [entry('2026-10-10', 0), entry('2026-10-11', 1800), entry('2026-10-12', 2000), entry('2026-10-16', 4200)]
    expect(calculateAmountStatistics(habit, entries, period)).toMatchObject({
      total: 8000, average: 2000, minimum: 0, maximum: 4200, daysWithData: 4,
      noDataCount: 3, successfulDays: 2, failedDays: 2, successRate: 50,
    })
    expect(calculateAmountStatistics(habit, entries, period).days.map((day) => day.value)).toEqual([0, 1800, 2000, null, null, null, 4200])
  })

  it('has null measures and no failures for a wholly empty period', () => {
    expect(calculateAmountStatistics(habit, [], period)).toMatchObject({
      total: null, average: null, minimum: null, maximum: null,
      daysWithData: 0, successfulDays: 0, failedDays: 0, successRate: null, noDataCount: 7,
    })
  })

  it('distinguishes a recorded zero from no data', () => {
    expect(calculateAmountStatistics(habit, [entry('2026-10-16', 0)], period)).toMatchObject({
      total: 0, average: 0, minimum: 0, maximum: 0, daysWithData: 1, failedDays: 1, successRate: 0,
    })
  })

  it('reads the habit target and retains fractional averages until display', () => {
    const custom = { ...habit, target: 2500 }
    const entries = [entry('2026-10-14', 2000), entry('2026-10-15', 2500), entry('2026-10-16', 2501)]
    expect(calculateAmountStatistics(custom, entries, period)).toMatchObject({ average: 7001 / 3, successfulDays: 2, failedDays: 1, successRate: 2 / 3 * 100 })
  })

  it('preserves archived history and excludes lifecycle gaps from missing results', () => {
    const archived = { ...habit, createdAt: '2026-10-13T10:00:00.000Z', archivedAt: '2026-10-14T10:00:00.000Z' }
    const result = calculateAmountStatistics(archived, [entry('2026-10-14', 2100)], period)
    expect(result).toMatchObject({ eligibleDays: 2, ineligibleDays: 5, noDataCount: 1, daysWithData: 1, successRate: 100 })
    expect(result.days).toHaveLength(7)
  })

  it('does not include outside dates or other habits and does not modify entries', () => {
    const entries = [entry('2026-10-09', 9000), entry('2026-10-17', 9000), entry('2026-10-16', 9000, 'other'), entry('2026-10-16', 2500)]
    const original = structuredClone(entries)
    expect(calculateAmountStatistics(habit, entries, period)).toMatchObject({ daysWithData: 1, total: 2500 })
    expect(entries).toEqual(original)
  })

  it('rejects invalid stored values and invalid targets instead of returning NaN', () => {
    expect(() => calculateAmountStatistics(habit, [entry('2026-10-16', Number.NaN)], period)).toThrow('некорректно')
    expect(() => calculateAmountStatistics({ ...habit, target: 0 }, [], period)).toThrow('цель')
  })
})
