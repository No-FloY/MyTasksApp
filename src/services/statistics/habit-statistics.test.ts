import { describe, expect, it } from 'vitest'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { BooleanHabit } from '../../models/habit'
import type { BooleanHabitEntry, BooleanHabitStatus, HabitEntry } from '../../models/habit-entry'
import { calculateBooleanStatistics } from './habit-statistics'
import { getStatisticsPeriod } from './period-utils'

const timestamp = '2026-09-20T10:00:00.000Z'
const habit: BooleanHabit = { id: 'english', name: 'Английский', type: 'boolean', description: '', order: 0, createdAt: timestamp, updatedAt: timestamp, archivedAt: null }
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
function entry(day: string, status: BooleanHabitStatus = 'success', habitId = habit.id): BooleanHabitEntry {
  return { habitId, date: date(day), type: 'boolean', status, createdAt: timestamp, updatedAt: timestamp }
}
const period = getStatisticsPeriod('7d', date('2026-10-16'))

describe('boolean period statistics', () => {
  it('counts success, failure, explicit no-data and absent days while excluding no-data from the rate', () => {
    const entries = [entry('2026-10-10'), entry('2026-10-11'), entry('2026-10-12', 'failure'), entry('2026-10-13', 'no-data'), entry('2026-10-16')]
    expect(calculateBooleanStatistics(habit, entries, period)).toMatchObject({
      eligibleDays: 7, successCount: 3, failureCount: 1, noDataCount: 3, markedCount: 4,
      successRate: 75, currentStreak: 1, bestStreak: 2,
    })
  })

  it('uses null with no explicit ratings and zero percent for an explicit failure', () => {
    expect(calculateBooleanStatistics(habit, [], period)).toMatchObject({ markedCount: 0, noDataCount: 7, successRate: null, currentStreak: 0, bestStreak: 0 })
    expect(calculateBooleanStatistics(habit, [entry('2026-10-16', 'no-data')], period).successRate).toBeNull()
    expect(calculateBooleanStatistics(habit, [entry('2026-10-16', 'failure')], period).successRate).toBe(0)
  })

  it('limits streaks to the selected period and requires the current streak to end on its last day', () => {
    const entries = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-14', '2026-10-15', '2026-10-16'].map((day) => entry(day))
    expect(calculateBooleanStatistics(habit, entries, period)).toMatchObject({ successCount: 6, currentStreak: 3, bestStreak: 3 })
    expect(calculateBooleanStatistics(habit, entries.slice(0, -1), period)).toMatchObject({ currentStreak: 0, bestStreak: 3 })
  })

  it.each(['no-data', 'failure'] as const)('breaks consecutive successes on %s', (status) => {
    const entries = [entry('2026-10-13'), entry('2026-10-14'), entry('2026-10-15', status), entry('2026-10-16')]
    expect(calculateBooleanStatistics(habit, entries, period)).toMatchObject({ currentStreak: 1, bestStreak: 2 })
  })

  it('does not count days before creation or after archival as missing', () => {
    const createdLater = { ...habit, createdAt: '2026-10-14T10:00:00.000Z' }
    expect(calculateBooleanStatistics(createdLater, [], period)).toMatchObject({ eligibleDays: 3, noDataCount: 3 })
    const archived = { ...createdLater, archivedAt: '2026-10-15T10:00:00.000Z' }
    const entries = [entry('2026-10-14'), entry('2026-10-15')]
    expect(calculateBooleanStatistics(archived, entries, period)).toMatchObject({ eligibleDays: 2, noDataCount: 0, successCount: 2, successRate: 100, currentStreak: 0, bestStreak: 2 })
  })

  it('preserves historical backdated results even when creation timestamp is later', () => {
    const createdToday = { ...habit, createdAt: '2026-10-16T10:00:00.000Z' }
    expect(calculateBooleanStatistics(createdToday, [entry('2026-10-11')], period)).toMatchObject({ eligibleDays: 6, successCount: 1, noDataCount: 5 })
  })

  it('ignores unrelated habits and out-of-period results without mutating inputs', () => {
    const entries = [entry('2026-10-10', 'failure', 'reading'), entry('2026-10-09', 'failure'), entry('2026-10-17', 'failure'), entry('2026-10-16')]
    const original = structuredClone(entries)
    expect(calculateBooleanStatistics(habit, entries, period)).toMatchObject({ successCount: 1, failureCount: 0, noDataCount: 6, successRate: 100 })
    expect(entries).toEqual(original)
  })

  it('rejects inconsistent stored entry types and invalid statuses', () => {
    const wrongType: HabitEntry = { habitId: habit.id, date: period.endDate, type: 'amount', value: 2, createdAt: timestamp, updatedAt: timestamp }
    expect(() => calculateBooleanStatistics(habit, [wrongType], period)).toThrow('Тип записи')
    expect(() => calculateBooleanStatistics(habit, [entry('2026-10-16', 'invalid' as BooleanHabitStatus)], period)).toThrow('некорректен')
  })
})
