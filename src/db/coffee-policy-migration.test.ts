import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import type { Habit, BooleanHabit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import type { Goal, GoalMilestone } from '../models/goal'
import type { Task } from '../models/task'
import { BackupService } from '../services/backup-service'
import { resolveHabitResult } from '../services/habit-result'
import { initializeDatabase, TaskTrackerDatabase } from './database'
import { createCoffeeHabit, createInitialHabits } from './seed'

const createdAt = '2026-09-01T10:00:00.000Z'
const updatedAt = '2026-10-15T09:15:00.000Z'
const now = '2026-11-10T10:00:00.000Z'
const historicalDate = getLocalDate(new Date(2026, 9, 12))
const today = getLocalDate(new Date(now))
const times = { createdAt, updatedAt }
const opened: Dexie[] = []
function track<T extends Dexie>(database: T): T { opened.push(database); return database }

class VersionEightDatabase extends Dexie {
  habits!: Table<Habit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>
  tasks!: Table<Task, string>
  goals!: Table<Goal, string>
  goalMilestones!: Table<GoalMilestone, string>
  constructor(name: string) {
    super(name)
    this.version(8).stores({ habits: 'id, type, order', habitEntries: '[habitId+date], habitId, date, type',
      tasks: 'id, date, status, goalId', goals: 'id, status, deadline', goalMilestones: 'id, goalId, [goalId+order]' })
  }
}

function oldDefinitions(): Habit[] {
  return createInitialHabits(createdAt).filter((habit) => habit.id !== 'coffee').map((habit) => {
    const legacy = { ...habit }
    delete legacy.missingDataPolicy
    if (legacy.type === 'boolean') delete legacy.booleanMode
    return legacy
  })
}

async function snapshot(database: VersionEightDatabase | TaskTrackerDatabase) {
  return { habits: await database.habits.toArray(), habitEntries: await database.habitEntries.toArray(),
    tasks: await database.tasks.toArray(), goals: await database.goals.toArray(), goalMilestones: await database.goalMilestones.toArray() }
}

async function legacyDatabase(extraCoffee?: BooleanHabit) {
  const database = track(new VersionEightDatabase(`coffee-v8-${crypto.randomUUID()}`))
  await database.open()
  await database.habits.bulkAdd([...oldDefinitions(), ...(extraCoffee ? [extraCoffee] : [])])
  await database.habitEntries.bulkAdd([
    { ...times, habitId: 'english', type: 'boolean', date: historicalDate, status: 'no-data', note: 'Не помню' },
    { ...times, habitId: 'water', type: 'amount', date: historicalDate, value: 1800 },
    ...(extraCoffee ? [{ ...times, habitId: 'coffee', type: 'boolean' as const, date: historicalDate, status: 'success' as const, note: 'Утром' }] : []),
  ])
  await database.goals.add({ ...times, id: 'goal', title: 'Цель', description: 'Оригинал', deadline: null,
    status: 'active', progressMode: 'auto', manualProgress: 0, archived: false })
  await database.goalMilestones.add({ ...times, id: 'milestone', goalId: 'goal', title: 'Этап', type: 'boolean', order: 0, completed: true })
  await database.tasks.add({ ...times, id: 'task', goalId: 'goal', title: 'Задача', description: 'История', date: historicalDate,
    time: null, priority: 'medium', status: 'active', completedAt: null })
  return database
}

async function upgrade(legacy: VersionEightDatabase) {
  legacy.close()
  const current = track(new TaskTrackerDatabase(legacy.name))
  await current.open()
  return current
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now)) })
afterEach(async () => {
  const names = new Set(opened.map((database) => database.name))
  for (const database of opened) database.close()
  opened.length = 0
  for (const name of names) await Dexie.delete(name)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('schema v9 coffee and missing data policy', () => {
  it('adds coffee once and supplies intentional defaults without rewriting any old fact or timestamp', async () => {
    const old = await legacyDatabase()
    const before = await snapshot(old)
    const current = await upgrade(old)
    expect(current.verno).toBe(9)
    expect(current.backendDB().version).toBe(90)
    expect(await current.habits.count()).toBe(24)
    expect(await current.habits.get('coffee')).toStrictEqual(createCoffeeHabit(now))
    const after = await snapshot(current)
    expect({ ...after, habits: before.habits }).toStrictEqual(before)
    for (const original of before.habits) {
      const actual = await current.habits.get(original.id)
      expect(actual).toMatchObject(original)
      expect(actual?.createdAt).toBe(original.createdAt)
      expect(actual?.updatedAt).toBe(original.updatedAt)
    }
    const known = new Map(after.habits.map((habit) => [habit.id, habit]))
    for (const id of ['english', 'reading', 'workout', 'walk-10km', 'push-ups', 'abs', 'squats', 'pull-ups', 'cleaning']) {
      expect(known.get(id)?.missingDataPolicy).toBe('assume_not_done')
    }
    for (const id of ['coffee', 'no-alcohol', 'no-sweets', 'no-chips', 'no-energy-drinks', 'no-fast-food', 'no-soda-or-juice']) {
      expect(known.get(id)?.missingDataPolicy).toBe('assume_not_occurred')
    }
    for (const id of ['water', 'gaming', 'social-media', 'breakfast', 'lunch', 'dinner', 'early-rising', 'abstinence']) {
      expect(known.get(id)?.missingDataPolicy).toBe('manual')
    }
    expect(known.get('coffee')).toMatchObject({ booleanMode: 'observation' })
    expect(known.get('no-alcohol')).toMatchObject({ booleanMode: 'avoidance' })
    expect(known.get('english')).toMatchObject({ booleanMode: 'achievement' })
    await initializeDatabase(current)
    current.close()
    await initializeDatabase(current)
    expect(await snapshot(current)).toStrictEqual(after)
  })

  it('preserves a renamed archived coffee, explicit policies, all custom config and its original history', async () => {
    const coffee: BooleanHabit = { ...createCoffeeHabit(createdAt), name: 'Мой напиток', description: 'Личный текст', category: 'routine',
      missingDataPolicy: 'manual', order: 71, updatedAt, archivedAt: updatedAt, schedule: { type: 'weekdays', days: [2, 6] } }
    const old = await legacyDatabase(coffee)
    await old.habits.update('english', { name: 'Мои уроки', missingDataPolicy: 'manual', category: 'study_work' })
    const before = await snapshot(old)
    const current = await upgrade(old)
    expect(await current.habits.get('coffee')).toStrictEqual(coffee)
    expect(await current.habits.get('english')).toMatchObject({ name: 'Мои уроки', missingDataPolicy: 'manual', category: 'study_work' })
    expect(await current.habits.where('id').equals('coffee').count()).toBe(1)
    const after = await snapshot(current)
    expect({ ...after, habits: before.habits }).toStrictEqual(before)
  })

  it('creates no coffee results before tracking starts, or on the open local day', async () => {
    const current = await upgrade(await legacyDatabase())
    const coffee = await current.habits.get('coffee')
    if (!coffee || coffee.type !== 'boolean') throw new Error('Missing coffee')
    expect(resolveHabitResult(coffee, undefined, historicalDate, today)).toEqual({ type: 'boolean', status: 'no-data', source: 'no-data' })
    expect(resolveHabitResult(coffee, undefined, today, today)).toEqual({ type: 'boolean', status: 'no-data', source: 'no-data' })
    expect(await current.habitEntries.where('habitId').equals('coffee').count()).toBe(0)
  })

  it('rolls back the version upgrade and all metadata if adding coffee fails, then safely retries', async () => {
    const old = await legacyDatabase()
    const before = await snapshot(old)
    old.close()
    const current = track(new TaskTrackerDatabase(old.name))
    const fail = (_key: unknown, habit: Habit) => { if (habit.id === 'coffee') throw new Error('Coffee migration failed') }
    current.habits.hook('creating', fail)
    await expect(current.open()).rejects.toThrow('Coffee migration failed')
    current.habits.hook('creating').unsubscribe(fail)
    const unchanged = track(new VersionEightDatabase(old.name))
    await unchanged.open()
    expect(unchanged.backendDB().version).toBe(80)
    expect(await snapshot(unchanged)).toStrictEqual(before)
    unchanged.close()
    await current.open()
    expect(await current.habits.count()).toBe(24)
    expect(await current.habitEntries.toArray()).toStrictEqual(before.habitEntries)
  })

  it('backfills a version 3 backup through the same mechanism and round-trips the current data exactly', async () => {
    const old = await legacyDatabase()
    const legacyData = await snapshot(old)
    const current = track(new TaskTrackerDatabase(`coffee-import-${crypto.randomUUID()}`))
    await current.open()
    const service = new BackupService(current)
    await service.importBackup({ app: 'zadachnik', formatVersion: 3, exportedAt: now, data: legacyData })
    expect(await current.habits.count()).toBe(24)
    expect(await current.habits.get('coffee')).toStrictEqual(createCoffeeHabit(now))
    const imported = await snapshot(current)
    expect({ ...imported, habits: legacyData.habits }).toStrictEqual(legacyData)
    const backup = await service.exportBackup()
    await service.importBackup(JSON.parse(JSON.stringify(backup)))
    await initializeDatabase(current)
    expect(await snapshot(current)).toStrictEqual(imported)
    expect(await current.habitEntries.where('habitId').equals('coffee').count()).toBe(0)
  })
})
