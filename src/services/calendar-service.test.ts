import 'fake-indexeddb/auto'
import { liveQuery } from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { createInitialHabits } from '../db/seed'
import { isLocalDate, type LocalDate } from '../lib/local-date'
import type { Habit, RatingHabit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import { CalendarService, computeDaySummary, type CalendarMonthData } from './calendar-service'
import { HabitService } from './habit-service'

const timestamp = '2026-09-20T10:00:00.000Z'
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
const selectedDate = date('2026-10-02')
const habits = createInitialHabits(timestamp)

function entry(habitId: string, entryDate = selectedDate): HabitEntry {
  const base = { habitId, date: entryDate, createdAt: timestamp, updatedAt: timestamp }
  const habit = habits.find((item) => item.id === habitId)
  if (!habit) throw new Error('Missing fixture habit')
  if (habit.type === 'boolean') return { ...base, type: 'boolean', status: 'failure' }
  if (habit.type === 'amount') return { ...base, type: 'amount', value: 0 }
  if (habit.type === 'duration') return { ...base, type: 'duration', minutes: 0 }
  throw new Error('Unsupported fixture type')
}

describe('computed daily calendar summary', () => {
  it('treats absent records and explicit boolean no-data as unrecorded rather than failures', () => {
    expect(computeDaySummary(habits, [], selectedDate)).toEqual({
      status: 'no-data', recorded: 0, total: 11, successes: 0, failures: 0,
    })
    const noData: HabitEntry = { ...entry('english'), type: 'boolean', status: 'no-data' }
    expect(computeDaySummary(habits, [noData], selectedDate)).toEqual(computeDaySummary(habits, [], selectedDate))
  })

  it('counts recorded amount and duration zero and distinguishes them from missing records', () => {
    expect(computeDaySummary(habits, [entry('water'), entry('gaming')], selectedDate)).toEqual({
      status: 'partial', recorded: 2, total: 11, successes: 0, failures: 0,
    })
  })

  it('marks all recorded habits complete even when boolean outcomes are failures', () => {
    const entries = habits.map((habit) => entry(habit.id))
    expect(computeDaySummary(habits, entries, selectedDate)).toEqual({
      status: 'complete', recorded: 11, total: 11, successes: 0, failures: 8,
    })
  })

  it('keeps boolean success and failure counts separate from amount success and duration ratings', () => {
    const entries: HabitEntry[] = [
      { ...entry('english'), type: 'boolean', status: 'success' }, entry('reading'),
      { ...entry('water'), type: 'amount', value: 2400 }, entry('gaming'),
    ]
    expect(computeDaySummary(habits, entries, selectedDate)).toEqual({
      status: 'partial', recorded: 4, total: 11, successes: 1, failures: 1,
    })
  })

  it('uses only active supported habits and excludes unrelated dates and orphaned entries', () => {
    const supportedHabit = habits.find((habit) => habit.id === 'english')
    if (!supportedHabit) throw new Error('Missing fixture')
    const ratingHabit: RatingHabit = { ...supportedHabit, id: 'rating', type: 'rating' }
    const activeHabits: Habit[] = [supportedHabit, ratingHabit, { ...supportedHabit, id: 'archived', archivedAt: timestamp }]
    const entries: HabitEntry[] = [
      entry('english', date('2026-10-01')), { ...entry('reading'), habitId: 'orphan' },
      { ...entry('reading'), habitId: 'archived' },
      { ...entry('reading'), habitId: 'rating', type: 'rating', value: 5 },
    ]
    expect(computeDaySummary(activeHabits, entries, selectedDate)).toEqual({
      status: 'no-data', recorded: 0, total: 1, successes: 0, failures: 0,
    })
    expect(computeDaySummary([], entries, selectedDate).status).toBe('no-data')
  })

  it('does not mutate inputs or create aggregate fields on records', () => {
    const entries = habits.map((habit) => entry(habit.id))
    const before = structuredClone({ habits, entries })
    computeDaySummary(habits, entries, selectedDate)
    expect({ habits, entries }).toEqual(before)
  })

  it('rejects malformed dates and incompatible or invalid stored results', () => {
    expect(() => computeDaySummary(habits, [], '2026-02-30' as LocalDate)).toThrow('Некорректная')
    expect(() => computeDaySummary(habits, [{ ...entry('water'), type: 'duration', minutes: 0 }], selectedDate)).toThrow('Тип сохранённой записи')
    expect(() => computeDaySummary(habits, [{ ...entry('water'), type: 'amount', value: -1 }], selectedDate)).toThrow('некорректно')
  })
})

describe('calendar month data from existing IndexedDB tables', () => {
  let database: TaskTrackerDatabase
  let service: CalendarService
  let habitService: HabitService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 4, 12))
    database = new TaskTrackerDatabase(`zadachnik-calendar-test-${crypto.randomUUID()}`)
    service = new CalendarService(database)
    habitService = new HabitService(database)
    await database.open()
  })

  afterEach(async () => {
    await database.delete()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('queries both inclusive range boundaries through the date index, retaining all habit types', async () => {
    const entries: HabitEntry[] = [
      entry('english', date('2026-09-27')), entry('water', date('2026-09-28')),
      entry('gaming', selectedDate), entry('english', date('2026-11-01')),
      entry('social-media', date('2026-11-02')),
    ]
    await database.habitEntries.bulkAdd(entries)
    const query = vi.spyOn(database.habitEntries, 'where')
    const result = await habitService.getEntriesForDateRange(date('2026-09-28'), date('2026-11-01'))
    expect(result.map((item) => item.date)).toEqual(['2026-09-28', '2026-10-02', '2026-11-01'])
    expect(result.map((item) => item.type)).toEqual(['amount', 'duration', 'boolean'])
    expect(query).toHaveBeenCalledExactlyOnceWith('date')
    expect(await habitService.getEntriesForDateRange(selectedDate, selectedDate)).toEqual([entry('gaming')])
  })

  it('rejects malformed and reversed ranges while allowing empty and future ranges to be read', async () => {
    await expect(habitService.getEntriesForDateRange('2026-02-30' as LocalDate, selectedDate)).rejects.toThrow('Некорректная')
    await expect(habitService.getEntriesForDateRange(selectedDate, '2026-13-01' as LocalDate)).rejects.toThrow('Некорректная')
    await expect(habitService.getEntriesForDateRange(selectedDate, date('2026-10-01'))).rejects.toThrow('позже конца')
    expect(await habitService.getEntriesForDateRange(date('2027-01-01'), date('2027-01-31'))).toEqual([])
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('reads habits once and a single entry range for every visible cell, including adjacent months', async () => {
    await database.habitEntries.bulkAdd([entry('water', date('2026-09-28')), entry('gaming'), entry('english', date('2026-11-01'))])
    const habitQuery = vi.spyOn(database.habits, 'orderBy')
    const entryQuery = vi.spyOn(database.habitEntries, 'where')
    const data = await service.getMonth(selectedDate)
    expect(habitQuery).toHaveBeenCalledExactlyOnceWith('order')
    expect(entryQuery).toHaveBeenCalledExactlyOnceWith('date')
    expect(data.habits).toHaveLength(11)
    expect(data.entries).toHaveLength(3)
    expect(Object.keys(data.summaries)).toHaveLength(35)
    expect(data.summaries['2026-09-28']).toMatchObject({ status: 'partial', recorded: 1 })
    expect(data.summaries['2026-11-01']).toMatchObject({ status: 'partial', failures: 1 })
    expect(data.summaries['2026-10-03']).toMatchObject({ status: 'no-data', recorded: 0, failures: 0 })
  })

  it('retains archived habits and their history without counting them in active completion', async () => {
    await habitService.setBooleanHabitStatus('english', selectedDate, 'failure')
    await database.habits.update('english', { archivedAt: timestamp })
    const before = await database.habitEntries.toArray()
    const data = await service.getMonth(selectedDate)
    expect(data.habits.find((habit) => habit.id === 'english')?.archivedAt).toBe(timestamp)
    expect(data.entries).toEqual(before)
    expect(data.summaries[selectedDate]).toMatchObject({ status: 'no-data', total: 10, failures: 0 })
    expect(await database.habitEntries.toArray()).toEqual(before)
    expect(database.tables.map((table) => table.name).sort()).toEqual(['habitEntries', 'habits'])
  })

  it('recomputes through liveQuery after a historical write and creates no persisted summaries', async () => {
    const updates: CalendarMonthData[] = []
    const errors: unknown[] = []
    const subscription = liveQuery(() => service.getMonth(selectedDate)).subscribe({
      next: (data) => updates.push(data), error: (error: unknown) => errors.push(error),
    })
    try {
      await vi.waitFor(() => expect(updates.at(-1)?.summaries[selectedDate]?.status).toBe('no-data'))
      await habitService.setHabitAmount('water', selectedDate, 0)
      await vi.waitFor(() => expect(updates.at(-1)?.summaries[selectedDate]?.recorded).toBe(1))
      await habitService.setBooleanHabitStatus('english', selectedDate, 'failure')
      await vi.waitFor(() => expect(updates.at(-1)?.summaries[selectedDate]).toMatchObject({ recorded: 2, failures: 1 }))
      expect(errors).toEqual([])
      expect(await database.habitEntries.count()).toBe(2)
      expect((await database.habitEntries.toArray()).every((item) => !('recorded' in item) && !('progress' in item))).toBe(true)
    } finally {
      subscription.unsubscribe()
    }
  })
})
