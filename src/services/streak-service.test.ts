import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { isLocalDate, type LocalDate } from '../lib/local-date'
import type { BooleanHabitEntry, BooleanHabitStatus, HabitEntry } from '../models/habit-entry'
import { calculateBooleanStreak, StreakService } from './streak-service'

const timestamp = '2026-09-20T10:00:00.000Z'
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
function entry(day: string, status: BooleanHabitStatus = 'success', habitId = 'english'): BooleanHabitEntry {
  return { habitId, date: date(day), type: 'boolean', status, createdAt: timestamp, updatedAt: timestamp }
}

describe('boolean calendar streaks', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('calculates current, best and success rate from actual results independently of input order', () => {
    const entries = [
      entry('2026-09-27'), entry('2026-09-28'), entry('2026-09-29'),
      entry('2026-09-30', 'failure'), entry('2026-10-01', 'no-data'),
      entry('2026-10-02'), entry('2026-10-03'),
    ].reverse()
    expect(calculateBooleanStreak('english', entries, date('2026-10-03'))).toEqual({
      currentStreak: 2, bestStreak: 3, successes: 5, failures: 1, successRate: 5 / 6 * 100,
    })
    expect(entries[0]?.date).toBe('2026-10-03')
  })

  it('breaks on absent days but does not count them as failures in the success rate', () => {
    const entries = [entry('2026-09-29'), entry('2026-09-30'), entry('2026-10-02'), entry('2026-10-03')]
    expect(calculateBooleanStreak('english', entries, date('2026-10-03'))).toEqual({
      currentStreak: 2, bestStreak: 2, successes: 4, failures: 0, successRate: 100,
    })
  })

  it.each(['no-data', 'failure'] as const)('breaks on explicit %s, while only failure contributes to the denominator', (status) => {
    const result = calculateBooleanStreak('english', [entry('2026-10-01'), entry('2026-10-02', status), entry('2026-10-03')], date('2026-10-03'))
    expect(result).toMatchObject({ currentStreak: 1, bestStreak: 1, successes: 2, failures: status === 'failure' ? 1 : 0 })
    expect(result.successRate).toBe(status === 'failure' ? 2 / 3 * 100 : 100)
  })

  it('requires the current series to end on the selected day even when yesterday had a success', () => {
    const entries = [entry('2026-10-01'), entry('2026-10-02')]
    expect(calculateBooleanStreak('english', entries, date('2026-10-03'))).toMatchObject({ currentStreak: 0, bestStreak: 2 })
    expect(calculateBooleanStreak('english', [...entries, entry('2026-10-03', 'no-data')], date('2026-10-03')))
      .toMatchObject({ currentStreak: 0, bestStreak: 2 })
  })

  it('uses null for no rated days and zero percent for only failures', () => {
    expect(calculateBooleanStreak('english', [], date('2026-10-03'))).toEqual({
      currentStreak: 0, bestStreak: 0, successes: 0, failures: 0, successRate: null,
    })
    expect(calculateBooleanStreak('english', [entry('2026-10-03', 'no-data')], date('2026-10-03')).successRate).toBeNull()
    expect(calculateBooleanStreak('english', [entry('2026-10-03', 'failure')], date('2026-10-03')).successRate).toBe(0)
  })

  it('excludes later entries and unrelated habits when looking at a past date', () => {
    const entries = [
      entry('2026-10-01'), entry('2026-10-02', 'failure'), entry('2026-10-03'),
      entry('2026-10-01', 'failure', 'reading'), entry('2026-10-02', 'failure', 'reading'),
    ]
    expect(calculateBooleanStreak('english', entries, date('2026-10-01'))).toEqual({
      currentStreak: 1, bestStreak: 1, successes: 1, failures: 0, successRate: 100,
    })
  })

  it.each([
    ['2026-12-30', '2026-12-31', '2027-01-01'],
    ['2028-02-28', '2028-02-29', '2028-03-01'],
    ['2026-03-07', '2026-03-08', '2026-03-09'],
    ['2026-10-31', '2026-11-01', '2026-11-02'],
  ])('counts calendar-consecutive days across year, leap day or DST starting %s', (first, second, third) => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(calculateBooleanStreak('english', [entry(first), entry(second), entry(third)], date(third)))
      .toMatchObject({ currentStreak: 3, bestStreak: 3, successRate: 100 })
  })

  it('rejects invalid dates and incompatible saved entry types', () => {
    expect(() => calculateBooleanStreak('english', [], '2026-02-30' as LocalDate)).toThrow('Некорректная календарная дата')
    const mismatched: HabitEntry = { habitId: 'english', date: date('2026-10-03'), type: 'amount', value: 1, createdAt: timestamp, updatedAt: timestamp }
    expect(() => calculateBooleanStreak('english', [mismatched], date('2026-10-03'))).toThrow('Тип записи')
  })
})

describe('boolean streak queries', () => {
  let database: TaskTrackerDatabase
  let service: StreakService
  beforeEach(async () => {
    database = new TaskTrackerDatabase(`zadachnik-streak-test-${crypto.randomUUID()}`)
    service = new StreakService(database)
    await database.open()
  })
  afterEach(async () => database.delete())

  it('returns active boolean habits in order with history bounded by the chosen date', async () => {
    await database.habitEntries.bulkPut([
      entry('2026-09-30'), entry('2026-10-01'), entry('2026-10-02', 'failure'),
      entry('2026-09-30', 'failure', 'reading'),
      { habitId: 'water', date: date('2026-10-01'), type: 'amount', value: 2400, createdAt: timestamp, updatedAt: timestamp },
    ])
    const before = await database.habitEntries.toArray()
    await database.habits.update('reading', { archivedAt: timestamp })
    const results = await service.getBooleanStatistics(date('2026-10-01'))
    expect(results).toHaveLength(7)
    expect(results.find((row) => row.habit.id === 'english')).toMatchObject({
      currentStreak: 2, bestStreak: 2, successes: 2, failures: 0, successRate: 100,
    })
    expect(results.some((row) => row.habit.id === 'reading' || row.habit.id === 'water')).toBe(false)
    expect(results.map((row) => row.habit.order)).toEqual(results.map((row) => row.habit.order).sort((a, b) => a - b))
    expect(results.find((row) => row.habit.id === 'abstinence')).toMatchObject({ currentStreak: 0, bestStreak: 0, successRate: null })
    expect(await database.habitEntries.toArray()).toEqual(before)
  })
})
