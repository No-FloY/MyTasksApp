import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import { TaskService } from '../services/task-service'
import { TaskTrackerDatabase } from './database'
import { createInitialHabits } from './seed'

/** The installed v2 schema, before tasks existed. */
class VersionTwoDatabase extends Dexie {
  habits!: Table<Habit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>

  constructor(name: string) {
    super(name)
    this.version(2).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
    })
  }
}

const createdAt = '2026-09-01T07:05:00.000Z'
const updatedAt = '2026-10-02T21:20:00.000Z'
const archivedAt = '2026-10-03T08:30:00.000Z'
const firstDay = getLocalDate(new Date(2026, 9, 1))
const secondDay = getLocalDate(new Date(2026, 9, 2))
const thirdDay = getLocalDate(new Date(2026, 9, 3))
const openDatabases: Dexie[] = []

async function createVersionTwoDatabase() {
  const database = new VersionTwoDatabase(`zadachnik-task-migration-${crypto.randomUUID()}`)
  openDatabases.push(database)
  await database.open()
  const habits: Habit[] = createInitialHabits(createdAt)
    .filter((habit) => habit.id !== 'reading' && habit.id !== 'social-media')
    .map((habit) => {
      if (habit.type === 'amount') {
        return { ...habit, name: 'Моя вода', description: 'Моя цель', target: 2500, order: 20, updatedAt }
      }
      if (habit.type === 'duration') {
        return {
          ...habit, name: 'Игры в архиве', order: 30, updatedAt, archivedAt,
          ratingRanges: [
            { id: 'custom-short', label: 'Мой лимит', emoji: '🎮', minMinutes: 0, maxMinutes: 45 },
            { id: 'custom-long', label: 'Пора отдохнуть', emoji: '🌿', minMinutes: 46, maxMinutes: null },
          ],
        }
      }
      if (habit.id === 'english') {
        return { ...habit, name: 'Моя практика', description: 'Первая строка\nВторая строка', order: 10, updatedAt }
      }
      return habit
    })
  habits.push({
    id: 'personal-rating', type: 'rating', name: 'Моя оценка', description: 'Пользовательская привычка',
    order: 40, createdAt, updatedAt, archivedAt: null,
  })
  const timestamps = { createdAt, updatedAt }
  const entries: HabitEntry[] = [
    { ...timestamps, habitId: 'english', date: firstDay, type: 'boolean', status: 'success', note: 'Прочитана глава\nИ сделаны упражнения' },
    { ...timestamps, habitId: 'english', date: secondDay, type: 'boolean', status: 'failure' },
    { ...timestamps, habitId: 'english', date: thirdDay, type: 'boolean', status: 'no-data', note: 'Без оценки' },
    { ...timestamps, habitId: 'water', date: firstDay, type: 'amount', value: 2800, note: 'Выше личной цели' },
    { ...timestamps, habitId: 'water', date: secondDay, type: 'amount', value: 0 },
    { ...timestamps, habitId: 'gaming', date: firstDay, type: 'duration', minutes: 155, note: 'История архивной привычки' },
    { ...timestamps, habitId: 'gaming', date: secondDay, type: 'duration', minutes: 0 },
    { ...timestamps, habitId: 'personal-rating', date: firstDay, type: 'rating', value: 4, note: 'Сохранить оценку' },
  ]
  await database.habits.bulkAdd(habits)
  await database.habitEntries.bulkAdd(entries)
  return database
}

async function openCurrentDatabase(name: string) {
  const database = new TaskTrackerDatabase(name)
  openDatabases.push(database)
  await database.open()
  return database
}

afterEach(async () => {
  const names = new Set(openDatabases.map((database) => database.name))
  for (const database of openDatabases) database.close()
  openDatabases.length = 0
  for (const name of names) await Dexie.delete(name)
})

describe('task store migration from IndexedDB v2 to v3', () => {
  it('adds only an empty task store and preserves all existing values, timestamps and indexes exactly', async () => {
    const legacy = await createVersionTwoDatabase()
    const originalHabits = await legacy.habits.toArray()
    const originalEntries = await legacy.habitEntries.toArray()
    const originalHabitSchema = legacy.habits.schema
    const originalEntrySchema = legacy.habitEntries.schema
    legacy.close()

    const current = await openCurrentDatabase(legacy.name)

    expect(current.verno).toBe(3)
    expect(current.tables.map((table) => table.name).sort()).toEqual(['habitEntries', 'habits', 'tasks'])
    expect(await current.habits.toArray()).toStrictEqual(originalHabits)
    expect(await current.habitEntries.toArray()).toStrictEqual(originalEntries)
    expect(current.habits.schema).toStrictEqual(originalHabitSchema)
    expect(current.habitEntries.schema).toStrictEqual(originalEntrySchema)
    expect(await current.tasks.toArray()).toEqual([])
    expect(current.tasks.schema.primKey).toMatchObject({ name: 'id', keyPath: 'id', auto: false })
    expect(current.tasks.schema.indexes.map(({ name, keyPath, unique, multi }) => ({ name, keyPath, unique, multi })))
      .toEqual([
        { name: 'date', keyPath: 'date', unique: false, multi: false },
        { name: 'status', keyPath: 'status', unique: false, multi: false },
      ])
  })

  it('persists a task across repeated reopening without reseeding deleted habits or changing history', async () => {
    const legacy = await createVersionTwoDatabase()
    const originalHabits = await legacy.habits.toArray()
    const originalEntries = await legacy.habitEntries.toArray()
    legacy.close()
    const migrated = await openCurrentDatabase(legacy.name)
    const service = new TaskService(migrated)
    const task = await service.createTask({
      title: 'После обновления', description: 'Данные остались на месте',
      date: thirdDay, time: '18:30', priority: 'high',
    })
    const completed = await service.completeTask(task.id)
    migrated.close()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reopened = await openCurrentDatabase(legacy.name)
      expect(reopened.verno).toBe(3)
      expect(await reopened.tasks.toArray()).toStrictEqual([completed])
      expect(await reopened.tasks.where('date').equals(thirdDay).toArray()).toStrictEqual([completed])
      expect(await reopened.tasks.where('status').equals('completed').toArray()).toStrictEqual([completed])
      expect(await reopened.habits.toArray()).toStrictEqual(originalHabits)
      expect(await reopened.habitEntries.toArray()).toStrictEqual(originalEntries)
      expect(await reopened.habits.get('reading')).toBeUndefined()
      expect(await reopened.habits.get('social-media')).toBeUndefined()
      reopened.close()
    }
  })
})
