import { describe, expect, it } from 'vitest'
import { createInitialHabits } from '../../db/seed'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { BooleanHabitStatus, HabitEntry } from '../../models/habit-entry'
import { calculateFoodStatistics } from './food-statistics'
import { getStatisticsPeriod } from './period-utils'

const timestamp = '2026-09-01T10:00:00.000Z'
const habits = createInitialHabits(timestamp)
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
function mark(habitId: string, day: string, status: BooleanHabitStatus = 'success'): HabitEntry {
  return { habitId, date: date(day), type: 'boolean', status, createdAt: timestamp, updatedAt: timestamp }
}
const today = date('2026-11-03')
const october = getStatisticsPeriod('previous-month', today)

describe('alcohol statistics use ordinary daily boolean outcomes', () => {
  it('counts drinking dates, not absent or explicit no-data, and uses only marked days in the rate', () => {
    const entries = [mark('no-alcohol', '2026-10-01'), mark('no-alcohol', '2026-10-02', 'failure'),
      mark('no-alcohol', '2026-10-03', 'failure'), mark('no-alcohol', '2026-10-04', 'no-data')]
    const result = calculateFoodStatistics(habits, entries, october)
    expect(result.alcohol?.selected).toMatchObject({ successCount: 1, failureCount: 2, noDataCount: 28,
      eligibleDays: 31, markedCount: 3 })
    expect(result.alcohol?.selected.successRate).toBeCloseTo(100 / 3)
  })

  it('separates the current month from a selected past month', () => {
    const result = calculateFoodStatistics(habits, [mark('no-alcohol', '2026-10-01', 'failure'),
      mark('no-alcohol', '2026-11-01', 'failure'), mark('no-alcohol', '2026-11-02', 'failure'),
      mark('no-alcohol', '2026-11-03')], october)
    expect(result.alcohol?.selected.failureCount).toBe(1)
    expect(result.alcohol?.currentMonth).toMatchObject({ failureCount: 2, successCount: 1, noDataCount: 0, eligibleDays: 3 })
  })

  it('groups monthly trends only within the selected calendar boundaries', () => {
    const period = getStatisticsPeriod('custom', today, { startDate: '2026-09-30', endDate: '2026-11-02' })
    const result = calculateFoodStatistics(habits, [mark('no-alcohol', '2026-09-30', 'failure'),
      mark('no-alcohol', '2026-10-31', 'failure'), mark('no-alcohol', '2026-11-02'),
      mark('no-alcohol', '2026-11-03', 'failure')], period)
    expect(result.alcohol?.months.map((month) => [month.month, month.eligibleDays, month.failureCount, month.successCount]))
      .toEqual([['2026-09', 1, 1, 0], ['2026-10', 31, 1, 0], ['2026-11', 2, 0, 1]])
  })

  it('keeps an entirely unrecorded month unavailable, without drinking days or an invented zero rate', () => {
    expect(calculateFoodStatistics(habits, [], october).alcohol?.selected)
      .toMatchObject({ successCount: 0, failureCount: 0, noDataCount: 31, successRate: null })
  })
})

describe('meal statistics', () => {
  it.each(['breakfast', 'lunch', 'dinner'])('calculates %s success, missing, no-data and the rate', (id) => {
    const result = calculateFoodStatistics(habits, [mark(id, '2026-10-01'), mark(id, '2026-10-02', 'failure'),
      mark(id, '2026-10-03', 'no-data')], october)
    expect(result.meals.find((meal) => meal.habit.id === id)).toMatchObject({ successCount: 1,
      failureCount: 1, noDataCount: 29, successRate: 50 })
    expect(result.fullMealDays).toBe(0)
  })

  it('requires all three successes on the same date for a full meal day', () => {
    const entries = ['breakfast', 'lunch', 'dinner'].flatMap((id) => [mark(id, '2026-10-01'), mark(id, '2026-10-02')])
    entries.push(mark('breakfast', '2026-10-03'), mark('lunch', '2026-10-03'), mark('dinner', '2026-10-03', 'failure'))
    entries.push(mark('breakfast', '2026-10-04'), mark('lunch', '2026-10-04'), mark('dinner', '2026-10-04', 'no-data'))
    entries.push(mark('breakfast', '2026-10-05'), mark('lunch', '2026-10-05'))
    const before = structuredClone(entries)
    expect(calculateFoodStatistics(habits, entries, october)).toMatchObject({ fullMealDays: 2, eligibleMealDays: 31 })
    expect(entries).toEqual(before)
  })

  it('does not invent a full meal day when a meal definition is absent', () => {
    const entries = [mark('breakfast', '2026-10-01'), mark('lunch', '2026-10-01'), mark('dinner', '2026-10-01')]
    expect(calculateFoodStatistics(habits.filter((habit) => habit.id !== 'dinner'), entries, october))
      .toMatchObject({ fullMealDays: 0, eligibleMealDays: 0 })
  })

  it('respects creation dates when counting eligible full meal days', () => {
    const changed = habits.map((habit) => habit.id === 'dinner' ? { ...habit, createdAt: '2026-10-20T10:00:00.000Z' } : habit)
    expect(calculateFoodStatistics(changed, [], october)).toMatchObject({ fullMealDays: 0, eligibleMealDays: 12 })
  })
})
