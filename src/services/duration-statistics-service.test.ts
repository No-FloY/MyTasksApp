import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { createInitialHabits } from '../db/seed'
import { isLocalDate, type LocalDate } from '../lib/local-date'
import type { DurationHabit } from '../models/habit'
import type { DurationHabitEntry, HabitEntry } from '../models/habit-entry'
import {
  calculateDurationWeek,
  DurationStatisticsService,
  getLastSevenDates,
} from './duration-statistics-service'

const timestamp = '2026-09-20T10:00:00.000Z'

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error(`Invalid fixture date: ${value}`)
  return value
}

const endDate = date('2026-10-03')
const weekDates = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].map(date)

function durationHabit(id: string): DurationHabit {
  const habit = createInitialHabits(timestamp).find((item) => item.id === id)
  if (!habit || habit.type !== 'duration') throw new Error('Missing duration fixture')
  return habit
}

function durationEntry(habitId: string, entryDate: LocalDate, minutes: number): DurationHabitEntry {
  return { habitId, date: entryDate, type: 'duration', minutes, createdAt: timestamp, updatedAt: timestamp }
}

function weeklyEntries(habitId: string, values: number[]): DurationHabitEntry[] {
  return values.map((minutes, index) => {
    const entryDate = weekDates[index]
    if (!entryDate) throw new Error('Too many fixture entries')
    return durationEntry(habitId, entryDate, minutes)
  })
}

const gamingEntries = weeklyEntries('gaming', [0, 120, 180, 300, 360, 420])
const socialEntries = weeklyEntries('social-media', [0, 60, 75, 90, 100])

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('seven local calendar days', () => {
  it('includes the end date and crosses month boundaries in chronological order', () => {
    expect(getLastSevenDates(endDate)).toEqual(weekDates)
  })

  it('crosses a year boundary without dropping or duplicating a calendar day', () => {
    expect(getLastSevenDates(date('2027-01-03'))).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ])
  })

  it('includes leap day', () => {
    expect(getLastSevenDates(date('2028-03-02'))).toEqual([
      '2028-02-25', '2028-02-26', '2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02',
    ])
  })

  it.each([
    ['2026-03-10', ['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']],
    ['2026-11-03', ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']],
  ])('keeps seven calendar dates across Los Angeles DST ending %s', (end, expected) => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(getLastSevenDates(date(String(end)))).toEqual(expected)
  })

  it('rejects impossible end dates', () => {
    expect(() => getLastSevenDates('2026-02-30' as LocalDate)).toThrow('Некорректная календарная дата')
  })
})

describe('weekly duration calculations', () => {
  it('sums gaming, averages recorded days including zero, and distributes all ratings', () => {
    const result = calculateDurationWeek(durationHabit('gaming'), gamingEntries, endDate)
    expect(result.totalMinutes).toBe(1380)
    expect(result.averageMinutes).toBe(230)
    expect(result.recordedDays).toBe(6)
    expect(result.missingDays).toBe(1)
    expect(result.days.map((day) => day.minutes)).toEqual([0, 120, 180, 300, 360, 420, null])
    expect(result.days.map((day) => day.date)).toEqual(weekDates)
    expect(result.days[6]?.rating).toBeNull()
    expect(result.ratingCounts.map(({ rating, days }) => [rating.id, rating.emoji, days])).toEqual([
      ['excellent', '😄', 2], ['good', '🙂', 1], ['neutral', '😐', 1], ['poor', '🙁', 1], ['very-poor', '😡', 1],
    ])
    expect(result.ratingCounts.reduce((sum, category) => sum + category.days, 0) + result.missingDays).toBe(7)
  })

  it('computes social-media totals and averages with its own three-category configuration', () => {
    const result = calculateDurationWeek(durationHabit('social-media'), socialEntries, endDate)
    expect(result.totalMinutes).toBe(325)
    expect(result.averageMinutes).toBe(65)
    expect(result.recordedDays).toBe(5)
    expect(result.missingDays).toBe(2)
    expect(result.ratingCounts.map(({ rating, days }) => [rating.id, days])).toEqual([
      ['excellent', 2], ['good', 2], ['poor', 1],
    ])
    expect(result.ratingCounts.reduce((sum, category) => sum + category.days, 0) + result.missingDays).toBe(7)
  })

  it('represents an entirely unrecorded week without pretending its average is zero', () => {
    const result = calculateDurationWeek(durationHabit('gaming'), [], endDate)
    expect(result.totalMinutes).toBe(0)
    expect(result.averageMinutes).toBeNull()
    expect(result.recordedDays).toBe(0)
    expect(result.missingDays).toBe(7)
    expect(result.days.every((day) => day.minutes === null && day.rating === null)).toBe(true)
    expect(result.ratingCounts.every((category) => category.days === 0)).toBe(true)
  })

  it('counts an explicitly recorded zero and excludes missing days from the average', () => {
    const result = calculateDurationWeek(durationHabit('gaming'), [durationEntry('gaming', endDate, 0)], endDate)
    expect(result).toMatchObject({ totalMinutes: 0, averageMinutes: 0, recordedDays: 1, missingDays: 6 })
    expect(result.ratingCounts[0]).toMatchObject({ rating: { id: 'excellent' }, days: 1 })
  })

  it('retains fractional average precision instead of rounding stored calculations', () => {
    const result = calculateDurationWeek(durationHabit('gaming'), weeklyEntries('gaming', [0, 1, 1]), endDate)
    expect(result.totalMinutes).toBe(2)
    expect(result.averageMinutes).toBe(2 / 3)
  })

  it('excludes dates outside the window and all records for other habits', () => {
    const entries: HabitEntry[] = [
      durationEntry('gaming', endDate, 60),
      durationEntry('gaming', date('2026-09-26'), 1440),
      durationEntry('gaming', date('2026-10-04'), 1440),
      durationEntry('social-media', endDate, 1440),
      { habitId: 'water', date: endDate, type: 'amount', value: 2400, createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'english', date: endDate, type: 'boolean', status: 'success', createdAt: timestamp, updatedAt: timestamp },
    ]
    const result = calculateDurationWeek(durationHabit('gaming'), entries, endDate)
    expect(result).toMatchObject({ totalMinutes: 60, averageMinutes: 60, recordedDays: 1, missingDays: 6 })
    expect(result.days[6]?.minutes).toBe(60)
  })

  it('does not mutate inputs or overwrite timestamps while deriving aggregates', () => {
    const habit = durationHabit('gaming')
    const entries = gamingEntries.map((entry) => ({ ...entry }))
    const previousHabit = structuredClone(habit)
    const previousEntries = structuredClone(entries)
    calculateDurationWeek(habit, entries, endDate)
    expect(habit).toEqual(previousHabit)
    expect(entries).toEqual(previousEntries)
  })
})

describe('weekly duration statistics from IndexedDB', () => {
  let database: TaskTrackerDatabase
  let service: DurationStatisticsService

  beforeEach(async () => {
    database = new TaskTrackerDatabase(`zadachnik-statistics-test-${crypto.randomUUID()}`)
    service = new DurationStatisticsService(database)
    await database.open()
    await database.habitEntries.bulkAdd([...gamingEntries, ...socialEntries])
  })

  afterEach(async () => {
    await database.delete()
  })

  it('queries the exact inclusive window and returns only active duration habits in order', async () => {
    await database.habitEntries.bulkAdd([
      durationEntry('gaming', date('2026-09-26'), 1440),
      durationEntry('gaming', date('2026-10-04'), 1440),
      { habitId: 'water', date: endDate, type: 'amount', value: 2400, createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'english', date: endDate, type: 'boolean', status: 'success', createdAt: timestamp, updatedAt: timestamp },
    ])
    const results = await service.getWeeklyStatistics(endDate)
    expect(results.map((result) => result.habit.id)).toEqual(['gaming', 'social-media'])
    expect(results[0]).toMatchObject({ totalMinutes: 1380, averageMinutes: 230, recordedDays: 6, missingDays: 1 })
    expect(results[1]).toMatchObject({ totalMinutes: 325, averageMinutes: 65, recordedDays: 5, missingDays: 2 })
    expect(results[0]?.days.map((day) => day.date)).toEqual(weekDates)
  })

  it('performs read-only calculation without persisting aggregates or modifying source records', async () => {
    const originalHabits = await database.habits.toArray()
    const originalEntries = await database.habitEntries.toArray()
    await service.getWeeklyStatistics(endDate)
    await service.getWeeklyStatistics(endDate)
    expect(await database.habits.toArray()).toEqual(originalHabits)
    expect(await database.habitEntries.toArray()).toEqual(originalEntries)
    expect(database.tables.map((table) => table.name).sort()).toEqual(['habitEntries', 'habits'])
    expect(await database.habitEntries.count()).toBe(11)
  })

  it('includes records on both the first and last dates of the queried window', async () => {
    await database.habitEntries.put(durationEntry('gaming', endDate, 60))
    const gaming = (await service.getWeeklyStatistics(endDate))[0]
    expect(gaming).toMatchObject({ totalMinutes: 1440, averageMinutes: 1440 / 7, recordedDays: 7, missingDays: 0 })
    expect(gaming?.days[0]).toMatchObject({ date: '2026-09-27', minutes: 0 })
    expect(gaming?.days[6]).toMatchObject({ date: '2026-10-03', minutes: 60 })
  })

  it('recalculates historical category counts after saved rating ranges change', async () => {
    const originalEntries = await database.habitEntries.toArray()
    const habit = await database.habits.get('gaming')
    if (!habit || habit.type !== 'duration') throw new Error('Missing duration habit')
    await database.habits.put({
      ...habit,
      ratingRanges: [
        { id: 'within-limit', label: 'В пределах', emoji: '🌱', minMinutes: 0, maxMinutes: 180 },
        { id: 'over-limit', label: 'Выше', emoji: '🌳', minMinutes: 181, maxMinutes: null },
      ],
    })
    const results = await service.getWeeklyStatistics(endDate)
    expect(results[0]).toMatchObject({ totalMinutes: 1380, averageMinutes: 230, missingDays: 1 })
    expect(results[0]?.ratingCounts.map(({ rating, days }) => [rating.id, days])).toEqual([
      ['within-limit', 3], ['over-limit', 3],
    ])
    expect(results[0]?.days.map((day) => day.rating?.id ?? null)).toEqual([
      'within-limit', 'within-limit', 'within-limit', 'over-limit', 'over-limit', 'over-limit', null,
    ])
    expect(await database.habitEntries.toArray()).toEqual(originalEntries)
  })

  it('filters archived habits without deleting their historical entries', async () => {
    const originalEntries = await database.habitEntries.toArray()
    await database.habits.update('gaming', { archivedAt: timestamp })
    expect((await service.getWeeklyStatistics(endDate)).map((result) => result.habit.id)).toEqual(['social-media'])
    expect(await database.habitEntries.toArray()).toEqual(originalEntries)
  })

  it('returns no-data statistics for future empty windows without writing placeholder entries', async () => {
    const results = await service.getWeeklyStatistics(date('2026-11-03'))
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.recordedDays === 0 && result.averageMinutes === null && result.missingDays === 7)).toBe(true)
    expect(await database.habitEntries.count()).toBe(11)
  })

  it('rejects an invalid calendar date without changing the database', async () => {
    const original = await database.habitEntries.toArray()
    await expect(service.getWeeklyStatistics('2026-02-30' as LocalDate)).rejects.toThrow('Некорректная календарная дата')
    expect(await database.habitEntries.toArray()).toEqual(original)
  })
})
