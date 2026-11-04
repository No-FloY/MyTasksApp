import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import type { Goal, GoalMilestone } from '../models/goal'
import type { Habit, DurationHabit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import type { Task } from '../models/task'
import { HABIT_CATEGORIES } from '../models/habit-category'
import { TaskTrackerDatabase } from './database'
import { backfillHabitDefinitions, enrichLegacyHabit, type LegacyHabit } from './habit-backfill'
import { createInitialHabits, createStageTenHabits } from './seed'

const createdAt = '2026-09-01T10:00:00.000Z'
const updatedAt = '2026-10-01T10:00:00.000Z'
const migrationTime = '2026-10-26T10:00:00.000Z'
const day = getLocalDate(new Date(2026, 9, 1))
const times = { createdAt, updatedAt }
type OldStoredHabit = Exclude<LegacyHabit, { type: 'duration' }> | (Omit<DurationHabit, 'category' | 'ratingRanges'> & { ratingRanges?: DurationHabit['ratingRanges'] })

class OldDatabase extends Dexie {
  habits!: Table<OldStoredHabit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>
  tasks!: Table<Task, string>
  goals!: Table<Goal, string>
  goalMilestones!: Table<GoalMilestone, string>

  constructor(name: string, version: number) {
    super(name)
    this.version(version).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
      ...(version >= 3 ? { tasks: version >= 4 ? 'id, date, status, goalId' : 'id, date, status' } : {}),
      ...(version >= 4 ? { goals: 'id, status, deadline', goalMilestones: 'id, goalId, [goalId+order]' } : {}),
    })
  }
}

function legacyHabits(): LegacyHabit[] {
  return createInitialHabits(createdAt).filter((habit) => habit.order < 11).map((habit): LegacyHabit => {
    const legacy: LegacyHabit = { ...habit }
    delete legacy.category
    if (legacy.type === 'amount') {
      delete legacy.quickActions
      delete legacy.manualMode
    }
    return legacy
  })
}

const openDatabases: Dexie[] = []
function track<T extends Dexie>(database: T): T {
  openDatabases.push(database)
  return database
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(migrationTime))
})

afterEach(async () => {
  const names = new Set(openDatabases.map((database) => database.name))
  for (const database of openDatabases) database.close()
  openDatabases.length = 0
  for (const name of names) await Dexie.delete(name)
  vi.useRealTimers()
})

describe('category definitions and stage 10 backfill', () => {
  it('assigns stable categories by ID even after renaming every habit', () => {
    const actual = legacyHabits().map((habit) => enrichLegacyHabit({ ...habit, name: 'Изменённое имя' }))
    expect(Object.fromEntries(actual.map((habit) => [habit.id, habit.category]))).toEqual({
      abstinence: 'self_development', english: 'self_development', reading: 'self_development',
      'early-rising': 'routine', 'no-chips': 'food_water', 'no-soda-or-juice': 'food_water',
      'no-energy-drinks': 'food_water', 'no-fast-food': 'food_water', water: 'food_water',
      gaming: 'screen_time', 'social-media': 'screen_time',
    })
    expect(HABIT_CATEGORIES.map(({ id }) => id)).toEqual(['food_water', 'training', 'routine', 'study_work', 'screen_time', 'self_development'])
  })

  it('adds exactly twelve definitions with exercise controls and no invented history', () => {
    const result = backfillHabitDefinitions(legacyHabits(), migrationTime)
    expect(result).toHaveLength(23)
    const fresh = result.filter((habit) => habit.createdAt === migrationTime)
    expect(fresh.map((habit) => habit.id)).toEqual(['no-sweets', 'push-ups', 'abs', 'squats', 'pull-ups', 'walk-10km', 'workout', 'no-alcohol', 'breakfast', 'lunch', 'dinner', 'cleaning'])
    expect(fresh.filter((habit) => habit.type === 'amount').map(({ id, target, quickActions, manualMode, unit, category }) => ({ id, target, quickActions, manualMode, unit, category }))).toEqual([
      { id: 'push-ups', target: 100, quickActions: [10], manualMode: 'total', unit: 'reps', category: 'training' },
      { id: 'abs', target: 100, quickActions: [10], manualMode: 'total', unit: 'reps', category: 'training' },
      { id: 'squats', target: 100, quickActions: [10], manualMode: 'total', unit: 'reps', category: 'training' },
      { id: 'pull-ups', target: 15, quickActions: [1], manualMode: 'total', unit: 'reps', category: 'training' },
    ])
    expect(result.find((habit) => habit.id === 'water')).toMatchObject({ target: 2000, quickActions: [200, 400], manualMode: 'add' })
  })

  it('is idempotent and preserves preexisting new IDs, user categories and custom controls', () => {
    const custom: Habit = {
      id: 'push-ups', category: 'study_work', type: 'amount', name: 'Моя практика', description: 'Личное',
      unit: 'items', target: 7, quickActions: [2, 3], manualMode: 'add', order: 50,
      ...times, archivedAt: updatedAt,
    }
    const source = [...legacyHabits(), custom]
    const before = structuredClone(source)
    const first = backfillHabitDefinitions(source, migrationTime)
    expect(first.find((habit) => habit.id === custom.id)).toStrictEqual(custom)
    expect(backfillHabitDefinitions(first, '2026-11-01T10:00:00.000Z')).toStrictEqual(first)
    expect(source).toStrictEqual(before)
    const unknownSource: LegacyHabit = { ...custom, id: 'custom' }
    delete unknownSource.category
    const unknown = enrichLegacyHabit(unknownSource)
    expect(unknown.category).toBe('self_development')
  })
})

describe('real legacy schema upgrade to schema v6', () => {
  it.each([1, 2, 3, 4])('upgrades v%s old shapes, preserves history and adds only missing definitions', async (version) => {
    const legacy = track(new OldDatabase(`category-upgrade-${crypto.randomUUID()}`, version))
    await legacy.open()
    const definitions: OldStoredHabit[] = legacyHabits().filter((habit) => habit.id !== 'reading').map((habit) => {
      if (habit.id === 'water' && habit.type === 'amount') return { ...habit, name: 'Моя вода', target: 2750, order: 70, updatedAt }
      if (habit.id === 'english') return { ...habit, name: 'Архивный язык', archivedAt: updatedAt, updatedAt }
      if (habit.type === 'duration') {
        const result: OldStoredHabit = { ...habit, ratingRanges: [{ id: 'mine', label: 'Моя оценка', emoji: '🙂', minMinutes: 0, maxMinutes: null }] }
        if (version === 1 && result.type === 'duration' && result.id === 'social-media') delete result.ratingRanges
        return result
      }
      return habit
    })
    const entries: HabitEntry[] = [
      { ...times, habitId: 'english', date: day, type: 'boolean', status: 'no-data', note: 'Исходная заметка' },
      { ...times, habitId: 'water', date: day, type: 'amount', value: 3000 },
      { ...times, habitId: 'gaming', date: day, type: 'duration', minutes: 0 },
    ]
    await legacy.habits.bulkAdd(definitions)
    await legacy.habitEntries.bulkAdd(entries)
    if (version >= 3) await legacy.tasks.add({ ...times, id: 'task', title: 'Задача', description: '', date: day, time: null, priority: 'high', status: 'active', completedAt: null, ...(version === 4 ? { goalId: 'goal' } : {}) })
    if (version === 4) {
      await legacy.goals.add({ ...times, id: 'goal', title: 'Цель', description: '', deadline: null, status: 'active', progressMode: 'auto', manualProgress: 0, archived: false })
      await legacy.goalMilestones.add({ ...times, id: 'milestone', goalId: 'goal', type: 'amount', title: 'Этап', order: 0, current: 5, target: 10 })
    }
    const otherRows = await Promise.all(legacy.tables.filter((table) => table.name !== 'habits').map(async (table) => [table.name, await table.toArray()] as const))
    const schema = legacy.habits.schema
    legacy.close()

    const current = track(new TaskTrackerDatabase(legacy.name))
    await current.open()
    expect(current.verno).toBe(6)
    expect(current.backendDB().version).toBe(60)
    expect(current.tables.map((table) => table.name).sort()).toEqual(['goalMilestones', 'goals', 'habitEntries', 'habits', 'tasks'])
    expect(current.habits.schema).toStrictEqual(schema)
    expect(await current.habits.count()).toBe(22)
    expect(await current.habits.get('reading')).toBeUndefined()
    for (const [name, rows] of otherRows) expect(await current.table(name).toArray()).toStrictEqual(rows)
    for (const original of definitions) {
      const actual = await current.habits.get(original.id)
      expect(actual).toMatchObject(original)
      expect(actual?.category).toBeDefined()
    }
    for (const definition of createStageTenHabits(migrationTime)) expect(await current.habits.get(definition.id)).toStrictEqual(definition)
    expect(await current.habits.get('gaming')).toMatchObject({ ratingRanges: [{ id: 'mine', label: 'Моя оценка', emoji: '🙂', minMinutes: 0, maxMinutes: null }] })
    expect(await current.habits.get('social-media')).toHaveProperty('ratingRanges')
    const migrated = await current.habits.toArray()
    current.close()
    await current.open()
    expect(await current.habits.toArray()).toStrictEqual(migrated)
    for (const [name, rows] of otherRows) expect(await current.table(name).toArray()).toStrictEqual(rows)
    await current.habits.delete('workout')
    current.close()
    await current.open()
    expect(await current.habits.get('workout')).toBeUndefined()
  })

  it('rolls back metadata, new habits and schema version together when an upgrade write fails', async () => {
    const legacy = track(new OldDatabase(`category-rollback-${crypto.randomUUID()}`, 4))
    await legacy.open()
    await legacy.habits.bulkAdd(legacyHabits())
    const before = await legacy.habits.toArray()
    legacy.close()
    const broken = track(new TaskTrackerDatabase(legacy.name))
    broken.habits.hook('creating', (_key, habit) => {
      if (habit.id === 'push-ups') throw new Error('Injected upgrade failure')
    })
    await expect(broken.open()).rejects.toThrow('Injected upgrade failure')
    broken.close()
    const unchanged = track(new OldDatabase(legacy.name, 4))
    await unchanged.open()
    expect(unchanged.backendDB().version).toBe(40)
    expect(await unchanged.habits.toArray()).toStrictEqual(before)
    unchanged.close()
    const retry = track(new TaskTrackerDatabase(legacy.name))
    await retry.open()
    expect(await retry.habits.count()).toBe(23)
    expect(retry.backendDB().version).toBe(60)
  })

  it('adds the supplement to an existing v5 without changing definitions, weekly settings or history', async () => {
    const legacy = track(new OldDatabase(`supplement-upgrade-${crypto.randomUUID()}`, 5))
    await legacy.open()
    const definitions = createInitialHabits(createdAt).filter((habit) => habit.order < 18)
    const ownAlcohol: Habit = {
      ...createInitialHabits(createdAt).find((habit) => habit.id === 'no-alcohol')!,
      name: 'Моё название', category: 'self_development', archivedAt: updatedAt,
      schedule: { type: 'weekdays', days: [2, 4] },
    }
    definitions.push(ownAlcohol)
    const entries: HabitEntry[] = [
      { ...times, habitId: 'english', date: day, type: 'boolean', status: 'success', note: 'Не менять' },
      { ...times, habitId: 'no-alcohol', date: day, type: 'boolean', status: 'failure' },
    ]
    await legacy.habits.bulkAdd(definitions)
    await legacy.habitEntries.bulkAdd(entries)
    legacy.close()

    const current = track(new TaskTrackerDatabase(legacy.name))
    await current.open()
    expect(current.verno).toBe(6)
    expect(await current.habits.count()).toBe(23)
    for (const original of definitions) expect(await current.habits.get(original.id)).toStrictEqual(original)
    expect(await current.habitEntries.orderBy('[habitId+date]').toArray()).toStrictEqual(entries)
    expect(await current.habits.get('cleaning')).toMatchObject({ schedule: { type: 'weekly' }, category: 'routine' })
    const first = await current.habits.toArray()
    current.close()
    await current.open()
    expect(await current.habits.toArray()).toStrictEqual(first)
    expect(await current.habitEntries.orderBy('[habitId+date]').toArray()).toStrictEqual(entries)
  })
})
