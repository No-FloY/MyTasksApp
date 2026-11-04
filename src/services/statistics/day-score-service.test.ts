import 'fake-indexeddb/auto'
import { liveQuery } from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../../db/database'
import { createInitialHabits } from '../../db/seed'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { HabitEntry } from '../../models/habit-entry'
import { type DayScoreData } from './day-score'
import { DayScoreService } from './day-score-service'
import { getStatisticsPeriod } from './period-utils'
import { StatisticsService } from './statistics-service'

const timestamp = '2026-10-01T12:00:00.000Z'
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
const today = date('2026-10-24')
function mark(day: string, habitId = 'reading', status: 'success' | 'failure' | 'no-data' = 'success'): HabitEntry {
  return { habitId, date: date(day), type: 'boolean', status, createdAt: timestamp, updatedAt: timestamp }
}

describe('day score read snapshots', () => {
  let database: TaskTrackerDatabase
  let service: DayScoreService
  beforeEach(async () => {
    database = new TaskTrackerDatabase(`day-score-${crypto.randomUUID()}`)
    service = new DayScoreService(database)
    await database.open()
    await database.habits.clear()
    await database.habits.bulkPut(createInitialHabits(timestamp).filter((habit) => ['reading', 'no-sweets', 'push-ups'].includes(habit.id)))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await database.delete()
  })

  it('reads only selected values and leaves every store unchanged', async () => {
    await database.habitEntries.bulkPut([mark('2026-10-23', 'reading', 'failure'), mark('2026-10-24'), mark('2026-10-25', 'no-sweets'),
      { habitId: 'push-ups', date: today, type: 'amount', value: 130, createdAt: timestamp, updatedAt: timestamp, note: 'Факт не обрезать' }])
    const before = await Promise.all(database.tables.map((table) => table.toArray()))
    const queries = vi.spyOn(database.habitEntries, 'where')
    const result = await service.getDayScore(today)
    expect(result).toMatchObject({ score: 100, eligible: 3, filled: 2, sufficient: true })
    expect(result.coverage).toBeCloseTo(200 / 3)
    expect(queries).toHaveBeenCalledTimes(1)
    expect(queries).toHaveBeenCalledWith('date')
    expect(await Promise.all(database.tables.map((table) => table.toArray()))).toEqual(before)
  })

  it('loads earlier backdated lifecycle keys with one extra indexed query', async () => {
    await database.habits.toCollection().modify({ createdAt: '2026-10-25T12:00:00.000Z' })
    await database.habitEntries.bulkPut([mark('2026-10-01'), mark('2026-10-24', 'no-sweets')])
    const queries = vi.spyOn(database.habitEntries, 'where')
    expect(await service.getDayScore(today)).toMatchObject({ score: 100, eligible: 2, filled: 1, coverage: 50, sufficient: true })
    expect(queries).toHaveBeenCalledTimes(2)
    expect(queries).toHaveBeenCalledWith('[habitId+date]')
  })

  it('recalculates cross-connection entries, targets, categories, archive and older lifecycle keys', async () => {
    const other = new TaskTrackerDatabase(database.name)
    await other.open()
    const results: DayScoreData[] = []
    const errors: unknown[] = []
    const subscription = liveQuery(() => service.getDayScore(today)).subscribe({ next: (data) => results.push(data), error: (error: unknown) => errors.push(error) })
    const latest = () => results.at(-1)
    try {
      await vi.waitFor(() => expect(latest()).toMatchObject({ eligible: 3, coverage: 0 }))
      await other.habitEntries.bulkPut([mark('2026-10-24'), mark('2026-10-24', 'no-sweets', 'failure'),
        { habitId: 'push-ups', date: today, type: 'amount', value: 100, createdAt: timestamp, updatedAt: timestamp }])
      await vi.waitFor(() => expect(latest()).toMatchObject({ score: 200 / 3, coverage: 100 }))
      await other.habits.update('reading', { category: 'training' })
      await vi.waitFor(() => expect(latest()?.score).toBe(50))
      await other.habits.update('push-ups', (habit) => { if (habit.type === 'amount') habit.target = 200 })
      await vi.waitFor(() => expect(latest()?.score).toBe(37.5))
      await other.habitEntries.delete(['no-sweets', today])
      await other.habits.update('no-sweets', { archivedAt: timestamp })
      await vi.waitFor(() => expect(latest()).toMatchObject({ score: 75, eligible: 2, coverage: 100 }))
      await other.habitEntries.delete(['reading', today])
      await other.habits.update('reading', { createdAt: '2026-10-25T12:00:00.000Z' })
      await vi.waitFor(() => expect(latest()).toMatchObject({ eligible: 1, coverage: 100 }))
      await other.habitEntries.add(mark('2026-10-10'))
      await vi.waitFor(() => expect(latest()).toMatchObject({ eligible: 2, coverage: 50 }))
      await other.habitEntries.delete(['reading', date('2026-10-10')])
      await vi.waitFor(() => expect(latest()?.eligible).toBe(1))
      expect(errors).toEqual([])
    } finally {
      subscription.unsubscribe()
      other.close()
    }
  })

  it('gives the compact and full statistics summaries identical results', async () => {
    await database.habitEntries.bulkPut([mark('2026-10-24'), mark('2026-10-24', 'no-sweets', 'failure')])
    const stats = new StatisticsService(database)
    const period = getStatisticsPeriod('7d', today)
    expect((await stats.getStatistics(period, new Date('2026-10-24T12:00:00.000Z'))).dayScore).toEqual(await service.getDayScore(today))
  })

  it('loads the complete score week for a one-day selection without polluting detailed statistics', async () => {
    await database.habitEntries.bulkPut([
      mark('2026-10-17'), mark('2026-10-17', 'no-sweets'), // Outside the score week.
      mark('2026-10-19'), mark('2026-10-19', 'no-sweets'),
      mark('2026-10-24', 'reading', 'failure'), mark('2026-10-24', 'no-sweets', 'failure'),
    ])
    const stats = new StatisticsService(database)
    const period = getStatisticsPeriod('custom', today, { startDate: today, endDate: today })
    const result = await stats.getStatistics(period, new Date('2026-10-24T12:00:00.000Z'))
    expect(result).toMatchObject({ markedCount: 2, successCount: 0, habitSuccessRate: 0,
      dayScore: { score: 0, filled: 2 }, weeklyScore: { score: 50, sufficientDays: 2, partialDays: 2, missingDays: 4 } })
    expect(result.weeklyScore.averageCoverage).toBeCloseTo((200 / 3) * 2 / 6)
    expect(result.booleans.every((item) => item.eligibleDays === 1 && item.days.length === 1)).toBe(true)
  })

  it('propagates a read failure so the shared UI can show retry instead of a misleading empty score', async () => {
    vi.spyOn(database.habits, 'toArray').mockRejectedValueOnce(new Error('Read failed'))
    await expect(service.getDayScore(today)).rejects.toThrow('Read failed')
    expect((await service.getDayScore(today)).eligible).toBe(3)
  })

  it('reads canonical weekly entries before a selected day and current-month alcohol beyond a past selection', async () => {
    await database.habits.bulkPut(createInitialHabits(timestamp).filter((habit) => ['cleaning', 'no-alcohol'].includes(habit.id)))
    await database.habitEntries.bulkPut([mark('2026-10-19', 'cleaning'), mark('2026-10-24', 'no-alcohol', 'failure'),
      mark('2026-11-01', 'no-alcohol', 'failure'), mark('2026-11-02', 'no-alcohol', 'failure')])
    const actualToday = date('2026-11-03')
    const period = getStatisticsPeriod('custom', actualToday, { startDate: today, endDate: today })
    const result = await new StatisticsService(database).getStatistics(period, new Date('2026-11-03T12:00:00.000Z'))
    expect(result.food.alcohol?.selected.failureCount).toBe(1)
    expect(result.food.alcohol?.currentMonth.failureCount).toBe(2)
    expect(result.weeklyHabits.find((item) => item.habit.id === 'cleaning')).toMatchObject({ eligibleWeeks: 1, successCount: 1 })
    expect(result.weeklyScore.weeklyGoals).toEqual([{ id: 'cleaning', name: 'Уборка', category: 'routine', score: 100 }])
    await database.habits.update('cleaning', { schedule: { type: 'weekly', weekday: 6 } })
    expect((await service.getDayScore(today)).categories.find((item) => item.category === 'routine')).toMatchObject({ score: 100, filled: 1 })
  })
})
