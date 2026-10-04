import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import type { DurationRatingRange } from '../models/duration-rating'
import type { DurationHabit, Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import { DurationService } from '../services/duration-service'
import { TaskTrackerDatabase } from './database'
import { getInitialDurationRanges } from './duration-defaults'
import { createInitialHabits } from './seed'

type LegacyHabit = Exclude<Habit, DurationHabit> |
  (Omit<DurationHabit, 'ratingRanges'> & { ratingRanges?: DurationRatingRange[] })

class LegacyDatabase extends Dexie {
  habits!: Table<LegacyHabit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
    })
  }
}

const timestamp = '2026-10-01T10:00:00.000Z'
const today = getLocalDate(new Date(2026, 9, 3))
const yesterday = getLocalDate(new Date(2026, 9, 2))
const openDatabases: Dexie[] = []

async function createLegacyDatabase(): Promise<LegacyDatabase> {
  const database = new LegacyDatabase(`zadachnik-migration-test-${crypto.randomUUID()}`)
  openDatabases.push(database)
  await database.open()
  const habits = createInitialHabits(timestamp).map((habit) => {
    const legacy: LegacyHabit = { ...habit }
    if (legacy.type === 'duration') delete legacy.ratingRanges
    return legacy
  })
  await database.habits.bulkAdd(habits)
  return database
}

async function upgrade(legacy: LegacyDatabase): Promise<TaskTrackerDatabase> {
  legacy.close()
  const current = new TaskTrackerDatabase(legacy.name)
  openDatabases.push(current)
  await current.open()
  return current
}

afterEach(async () => {
  const names = new Set(openDatabases.map((database) => database.name))
  for (const database of openDatabases) database.close()
  openDatabases.length = 0
  for (const name of names) await Dexie.delete(name)
})

describe('duration configuration migration from IndexedDB v1 to v2', () => {
  it('adds ranges to legacy duration habits while preserving actual history and custom names', async () => {
    const legacy = await createLegacyDatabase()
    await legacy.habits.update('gaming', { name: 'Мои игры', description: 'Моё описание' })
    await legacy.habits.update('english', { name: 'Мой английский' })
    const entries: HabitEntry[] = [
      { habitId: 'english', date: today, type: 'boolean', status: 'success', createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'reading', date: today, type: 'boolean', status: 'no-data', createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'water', date: today, type: 'amount', value: 2400, createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'gaming', date: today, type: 'duration', minutes: 215, createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'gaming', date: yesterday, type: 'duration', minutes: 360, createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'social-media', date: today, type: 'duration', minutes: 0, createdAt: timestamp, updatedAt: timestamp },
    ]
    await legacy.habitEntries.bulkAdd(entries)
    const originalGaming = await legacy.habits.get('gaming')
    const originalEnglish = await legacy.habits.get('english')
    const originalWater = await legacy.habits.get('water')
    const current = await upgrade(legacy)

    expect(current.verno).toBe(2)
    expect(await current.habits.count()).toBe(11)
    expect(await current.habitEntries.count()).toBe(entries.length)
    expect(await current.habits.get('gaming')).toEqual({
      ...originalGaming, ratingRanges: getInitialDurationRanges('gaming'),
    })
    expect(await current.habits.get('social-media')).toMatchObject({ ratingRanges: getInitialDurationRanges('social-media') })
    expect(await current.habits.get('english')).toEqual(originalEnglish)
    expect(await current.habits.get('water')).toEqual(originalWater)
    for (const entry of entries) {
      expect(await current.habitEntries.get([entry.habitId, entry.date])).toEqual(entry)
    }
    const rows = await new DurationService(current).getTodayDurationHabits(today)
    expect(rows[0]).toMatchObject({ habit: { name: 'Мои игры' }, minutes: 215, rating: { id: 'good' } })
    expect(rows[1]).toMatchObject({ minutes: 0, rating: { id: 'excellent' } })
  })

  it('does not reseed deleted habits or remove archived history during upgrade', async () => {
    const legacy = await createLegacyDatabase()
    await legacy.habits.delete('social-media')
    await legacy.habits.delete('reading')
    await legacy.habits.update('gaming', { archivedAt: timestamp })
    const historicalEntry: HabitEntry = {
      habitId: 'gaming', date: yesterday, type: 'duration', minutes: 155,
      createdAt: timestamp, updatedAt: timestamp,
    }
    await legacy.habitEntries.put(historicalEntry)
    const current = await upgrade(legacy)

    expect(await current.habits.count()).toBe(9)
    expect(await current.habits.get('social-media')).toBeUndefined()
    expect(await current.habits.get('reading')).toBeUndefined()
    expect(await current.habits.get('gaming')).toMatchObject({
      archivedAt: timestamp, ratingRanges: getInitialDurationRanges('gaming'),
    })
    expect(await current.habitEntries.get(['gaming', yesterday])).toEqual(historicalEntry)
    expect(await new DurationService(current).getTodayDurationHabits(yesterday)).toEqual([])
  })

  it('keeps existing user configuration instead of replacing it with the new defaults', async () => {
    const legacy = await createLegacyDatabase()
    const customRanges: DurationRatingRange[] = [
      { id: 'custom', label: 'Моя оценка', emoji: '🎮', minMinutes: 0, maxMinutes: null },
    ]
    const gaming = await legacy.habits.get('gaming')
    if (!gaming || gaming.type !== 'duration') throw new Error('Missing legacy habit')
    await legacy.habits.put({ ...gaming, ratingRanges: customRanges })
    const saved = await legacy.habits.get('gaming')
    const current = await upgrade(legacy)
    expect(await current.habits.get('gaming')).toEqual(saved)
    expect(await current.habits.get('social-media')).toMatchObject({ ratingRanges: getInitialDurationRanges('social-media') })
    await new DurationService(current).setHabitDuration('gaming', today, 215)
    expect((await new DurationService(current).getTodayDurationHabits(today))[0]?.rating).toEqual(customRanges[0])

    current.close()
    const reopened = new TaskTrackerDatabase(current.name)
    openDatabases.push(reopened)
    await reopened.open()
    expect(await reopened.habits.get('gaming')).toEqual(saved)
    expect(await reopened.habitEntries.get(['gaming', today])).toMatchObject({ minutes: 215 })
  })

  it('does not rewrite a habit whose built-in id was changed to another type', async () => {
    const legacy = await createLegacyDatabase()
    const gaming = await legacy.habits.get('gaming')
    if (!gaming) throw new Error('Missing legacy habit')
    await legacy.habits.put({
      id: gaming.id, name: 'Моя отметка', description: gaming.description, order: gaming.order,
      createdAt: gaming.createdAt, updatedAt: gaming.updatedAt, archivedAt: null, type: 'boolean',
    })
    const before = await legacy.habits.get('gaming')
    const current = await upgrade(legacy)
    expect(await current.habits.get('gaming')).toEqual(before)
  })
})
