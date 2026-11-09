import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import type { Goal, GoalMilestone } from '../models/goal'
import type { BooleanHabit, Habit } from '../models/habit'
import type { BooleanHabitStatus, HabitEntry } from '../models/habit-entry'
import type { Task } from '../models/task'
import { BackupService, parseBackupJson } from '../services/backup-service'
import { HabitService } from '../services/habit-service'
import { TaskTrackerDatabase } from './database'
import { createInitialHabits, createSweetsHabit } from './seed'

const createdAt = '2026-09-01T10:00:00.000Z'
const updatedAt = '2026-10-15T10:00:00.000Z'
const migrationAt = '2026-11-05T10:00:00.000Z'
const times = { createdAt, updatedAt }
const day = getLocalDate(new Date(2026, 10, 4))
const statuses = ['success', 'failure', 'no-data'] as const

/** The released schema, without current populate/upgrade handlers. */
class VersionSixDatabase extends Dexie {
  habits!: Table<Habit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>
  tasks!: Table<Task, string>
  goals!: Table<Goal, string>
  goalMilestones!: Table<GoalMilestone, string>

  constructor(name: string) {
    super(name)
    this.version(6).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
      tasks: 'id, date, status, goalId',
      goals: 'id, status, deadline',
      goalMilestones: 'id, goalId, [goalId+order]',
    })
  }
}

const opened: Dexie[] = []
function track<T extends Dexie>(database: T): T {
  opened.push(database)
  return database
}

function legacySweets(fields: Partial<BooleanHabit> = {}): BooleanHabit {
  return { ...createSweetsHabit(createdAt), name: 'Без сладкого и шоколада', updatedAt, ...fields }
}

async function createLegacy(sweets: Habit | null = legacySweets()) {
  const database = track(new VersionSixDatabase(`sweets-upgrade-${crypto.randomUUID()}`))
  await database.open()
  const habits = createInitialHabits(createdAt).filter((habit) => habit.id !== 'no-sweets')
  if (sweets) habits.push(sweets)
  await database.habits.bulkAdd(habits)
  await database.habitEntries.bulkAdd([
    { ...times, habitId: 'english', date: day, type: 'boolean', status: 'success', note: 'Старая заметка' },
    { ...times, habitId: 'water', date: day, type: 'amount', value: 2700 },
    { ...times, habitId: 'gaming', date: day, type: 'duration', minutes: 0 },
    ...(sweets ? statuses.map((status, index): HabitEntry => ({ ...times, habitId: 'no-sweets',
      date: getLocalDate(new Date(2026, 9, 1 + index)), type: 'boolean', status, note: `История ${status}` })) : []),
  ])
  await database.goals.add({ ...times, id: 'goal', title: 'Цель', description: 'Сохранить описание',
    deadline: day, status: 'active', progressMode: 'auto', manualProgress: 0, archived: false })
  await database.goalMilestones.add({ ...times, id: 'milestone', goalId: 'goal', type: 'amount',
    title: 'Этап', order: 0, current: 3, target: 10 })
  await database.tasks.add({ ...times, id: 'task', goalId: 'goal', title: 'Связанная задача', description: 'Не менять',
    date: day, time: '15:30', priority: 'high', status: 'completed', completedAt: updatedAt })
  return database
}

async function snapshot(database: VersionSixDatabase | TaskTrackerDatabase) {
  const [habits, habitEntries, tasks, goals, goalMilestones] = await Promise.all([
    database.habits.toArray(), database.habitEntries.toArray(), database.tasks.toArray(),
    database.goals.toArray(), database.goalMilestones.toArray(),
  ])
  return { habits, habitEntries, tasks, goals, goalMilestones }
}

async function upgrade(legacy: VersionSixDatabase) {
  legacy.close()
  const current = track(new TaskTrackerDatabase(legacy.name))
  await current.open()
  return current
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(migrationAt))
})

afterEach(async () => {
  const names = new Set(opened.map((database) => database.name))
  for (const database of opened) database.close()
  opened.length = 0
  for (const name of names) await Dexie.delete(name)
  vi.useRealTimers()
})

describe('sweets habit migration from schema v6 to v7', () => {
  it('adds the missing definition once to an existing set of 22 and leaves all other stores intact', async () => {
    const legacy = await createLegacy(null)
    expect(await legacy.habits.count()).toBe(22)
    const before = await snapshot(legacy)
    const current = await upgrade(legacy)
    expect(current.verno).toBe(7)
    expect(current.backendDB().version).toBe(70)
    expect(current.tables.map((table) => table.name).sort()).toEqual(['goalMilestones', 'goals', 'habitEntries', 'habits', 'tasks'])
    expect(await current.habits.count()).toBe(23)
    expect(await current.habits.get('no-sweets')).toStrictEqual(createSweetsHabit(migrationAt))
    const migrated = await snapshot(current)
    expect({ ...migrated, habits: migrated.habits.filter((habit) => habit.id !== 'no-sweets') }).toStrictEqual(before)
    current.close()
    await current.open()
    expect(await snapshot(current)).toStrictEqual(migrated)
  })

  it('changes only the old standard name, preserving settings, timestamps, notes and all five tables', async () => {
    const original = legacySweets({ description: 'Мой текст', order: 99, category: 'self_development',
      schedule: { type: 'weekdays', days: [1, 4] }, archivedAt: updatedAt })
    const legacy = await createLegacy(original)
    const before = await snapshot(legacy)
    const current = await upgrade(legacy)
    expect(await current.habits.get('no-sweets')).toStrictEqual({ ...original, name: 'Без сладкого / шоколада' })
    expect(await snapshot(current)).toStrictEqual({ ...before,
      habits: before.habits.map((habit) => habit.id === 'no-sweets' ? { ...habit, name: 'Без сладкого / шоколада' } : habit) })
  })

  it.each([null, updatedAt])('preserves a customized name/category/schedule with archive value %s', async (archivedAt) => {
    const original = legacySweets({ name: 'Мой десертный режим', description: 'Пользовательское описание',
      category: 'study_work', schedule: { type: 'weekly', weekday: 5 }, archivedAt, order: 81 })
    const legacy = await createLegacy(original)
    const before = await snapshot(legacy)
    const current = await upgrade(legacy)
    expect(await current.habits.get('no-sweets')).toStrictEqual(original)
    expect(await snapshot(current)).toStrictEqual(before)
  })

  it('never repeats the upgrade or restores a habit deleted after upgrading', async () => {
    const current = await upgrade(await createLegacy(null))
    const upgraded = await snapshot(current)
    for (let index = 0; index < 2; index += 1) {
      current.close()
      await current.open()
      expect(await snapshot(current)).toStrictEqual(upgraded)
    }
    await current.habits.delete('no-sweets')
    const afterDeletion = await snapshot(current)
    current.close()
    await current.open()
    expect(await current.habits.get('no-sweets')).toBeUndefined()
    expect(await current.habits.count()).toBe(22)
    expect(await snapshot(current)).toStrictEqual(afterDeletion)
  })

  it('creates one current sweets definition and no results for a new database', async () => {
    const current = track(new TaskTrackerDatabase(`sweets-new-${crypto.randomUUID()}`))
    await current.open()
    expect(await current.habits.count()).toBe(23)
    expect(await current.habits.get('no-sweets')).toStrictEqual(createSweetsHabit(migrationAt))
    expect(await current.habitEntries.count()).toBe(0)
    expect(await current.habits.where('type').equals('boolean').count()).toBe(16)
  })

  it('rolls back the version and every store if adding the missing definition fails, then permits retry', async () => {
    const legacy = await createLegacy(null)
    const before = await snapshot(legacy)
    legacy.close()
    const broken = track(new TaskTrackerDatabase(legacy.name))
    broken.habits.hook('creating', (_key, habit) => {
      if (habit.id === 'no-sweets') throw new Error('Injected sweets migration failure')
    })
    await expect(broken.open()).rejects.toThrow('Injected sweets migration failure')
    broken.close()
    const unchanged = track(new VersionSixDatabase(legacy.name))
    await unchanged.open()
    expect(unchanged.backendDB().version).toBe(60)
    expect(await snapshot(unchanged)).toStrictEqual(before)
    const current = await upgrade(unchanged)
    expect(current.backendDB().version).toBe(70)
    expect(await current.habits.count()).toBe(23)
  })
})

describe('migrated sweets habit through universal services and backup format 3', () => {
  it('reads and updates success, failure and no-data without duplicating the daily fact or losing its note', async () => {
    const current = await upgrade(await createLegacy())
    const service = new HabitService(current)
    const before = await snapshot(current)
    for (const status of statuses) {
      await service.setBooleanHabitStatus('no-sweets', day, status)
      expect((await service.getTodayHabits(day)).find((item) => item.habit.id === 'no-sweets'))
        .toMatchObject({ habit: { name: 'Без сладкого / шоколада', category: 'food_water', type: 'boolean' }, status })
      expect(await current.habitEntries.get(['no-sweets', day])).toMatchObject({ status, createdAt: migrationAt })
      expect(await current.habitEntries.where('habitId').equals('no-sweets').count()).toBe(4)
    }
    const historicalDate = getLocalDate(new Date(2026, 9, 1))
    await service.setBooleanHabitStatus('no-sweets', historicalDate, 'failure')
    expect(await current.habitEntries.get(['no-sweets', historicalDate])).toStrictEqual({ habitId: 'no-sweets',
      date: historicalDate, type: 'boolean', status: 'failure', note: 'История success', createdAt, updatedAt: migrationAt })
    const after = await snapshot(current)
    expect({ ...after, habitEntries: before.habitEntries }).toStrictEqual(before)
    for (const status of statuses) {
      const historical = before.habitEntries.find((entry) => entry.habitId === 'no-sweets' && entry.type === 'boolean' && entry.status === status)!
      if (status !== 'success') expect(await current.habitEntries.get(['no-sweets', historical.date])).toStrictEqual(historical)
    }
  })

  it('round-trips every table and all three sweets statuses in backup v3, including repeated import and reopen', async () => {
    const current = await upgrade(await createLegacy())
    const service = new HabitService(current)
    for (const [index, status] of statuses.entries()) {
      await service.setBooleanHabitStatus('no-sweets', getLocalDate(new Date(2026, 10, 1 + index)), status)
    }
    const backup = await new BackupService(current).exportBackup()
    expect(backup.formatVersion).toBe(3)
    expect(backup.data.habits.find((habit) => habit.id === 'no-sweets'))
      .toMatchObject({ name: 'Без сладкого / шоколада', category: 'food_water', type: 'boolean' })
    expect(backup.data).toStrictEqual(await snapshot(current))
    const decoded = parseBackupJson(JSON.stringify(backup))
    const restored = track(new TaskTrackerDatabase(`sweets-restored-${crypto.randomUUID()}`))
    await restored.open()
    const restoreService = new BackupService(restored)
    await restoreService.importBackup(decoded)
    await restoreService.importBackup(decoded)
    restored.close()
    await restored.open()
    expect((await restoreService.exportBackup()).data).toStrictEqual(backup.data)
    expect(await restored.habits.count()).toBe(23)
    expect(await restored.habitEntries.where('habitId').equals('no-sweets').count()).toBe(6)
    const restoredHabits = new HabitService(restored)
    for (const [index, status] of statuses.entries()) {
      const result = await restoredHabits.getTodayHabits(getLocalDate(new Date(2026, 10, 1 + index)))
      expect(result.find((item) => item.habit.id === 'no-sweets')?.status).toBe(status satisfies BooleanHabitStatus)
    }
  })
})
