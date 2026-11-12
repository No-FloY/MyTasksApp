import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import type { Task } from '../models/task'
import type { Goal, GoalMilestone } from '../models/goal'
import { calculateDayScore } from '../services/statistics/day-score'
import { initializeDatabase, TaskTrackerDatabase } from './database'
import type { LegacyHabit } from './habit-backfill'
import { createInitialHabits } from './seed'
import { backfillCurrentSystemHabits, ensureCurrentSystemData } from './system-data'

const createdAt = '2026-09-01T10:00:00.000Z'
const now = '2026-11-09T10:00:00.000Z'
const historicalDay = getLocalDate(new Date(2026, 9, 1))
const times = { createdAt, updatedAt: createdAt }
const opened: Dexie[] = []
function track<T extends Dexie>(database: T): T { opened.push(database); return database }

class VersionSevenDatabase extends Dexie {
  habits!: Table<Habit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>
  tasks!: Table<Task, string>
  goals!: Table<Goal, string>
  goalMilestones!: Table<GoalMilestone, string>
  constructor(name: string) {
    super(name)
    this.version(7).stores({ habits: 'id, type, order', habitEntries: '[habitId+date], habitId, date, type',
      tasks: 'id, date, status, goalId', goals: 'id, status, deadline', goalMilestones: 'id, goalId, [goalId+order]' })
  }
}

async function snapshot(database: VersionSevenDatabase | TaskTrackerDatabase) {
  return { habits: await database.habits.toArray(), habitEntries: await database.habitEntries.toArray(),
    tasks: await database.tasks.toArray(), goals: await database.goals.toArray(), goalMilestones: await database.goalMilestones.toArray() }
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now)) })
afterEach(async () => {
  vi.restoreAllMocks()
  const names = new Set(opened.map((database) => database.name))
  for (const database of opened) database.close()
  opened.length = 0
  for (const name of names) await Dexie.delete(name)
  vi.useRealTimers()
})

describe('shared current system data backfill', () => {
  it('completes metadata and all missing definitions from the current seed without mutating the input', () => {
    const legacy = createInitialHabits(createdAt).filter((habit) => habit.order < 11).map((habit): LegacyHabit => {
      const item: LegacyHabit = { ...habit }
      delete item.category
      if (item.type === 'amount') { delete item.quickActions; delete item.manualMode }
      if (item.type === 'duration') Reflect.deleteProperty(item, 'ratingRanges')
      return item
    })
    const before = structuredClone(legacy)
    const actual = backfillCurrentSystemHabits(legacy, now)
    expect(legacy).toStrictEqual(before)
    expect(actual).toHaveLength(24)
    expect(new Set(actual.map((habit) => habit.id)).size).toBe(24)
    expect(actual.find((habit) => habit.id === 'water')).toMatchObject({ category: 'food_water', quickActions: [200, 400], manualMode: 'add', createdAt })
    expect(actual.find((habit) => habit.id === 'gaming')).toHaveProperty('ratingRanges')
    for (const habit of createInitialHabits(now).filter((item) => item.order >= 11)) {
      expect(actual.find((item) => item.id === habit.id)).toStrictEqual(habit)
    }
    expect(backfillCurrentSystemHabits(actual, '2026-12-01T10:00:00.000Z')).toStrictEqual(actual)
  })

  it('preserves all user changes and an existing daily schedule while supplying weekly defaults only for new cleaning', () => {
    const habits = createInitialHabits(createdAt).map((habit): Habit => ({ ...habit, name: `Моё ${habit.id}`,
      description: 'Моё описание', order: habit.order + 50, category: 'study_work', archivedAt: createdAt,
      schedule: { type: 'weekdays', days: [2, 5] } }))
    const pushUps = habits.find((habit) => habit.id === 'push-ups')!
    if (pushUps.type === 'amount') Object.assign(pushUps, { target: 7, quickActions: [], manualMode: 'add', unit: 'items' })
    const cleaning = habits.find((habit) => habit.id === 'cleaning')!
    delete cleaning.schedule
    expect(backfillCurrentSystemHabits(habits, now)).toStrictEqual(habits)
    expect(backfillCurrentSystemHabits(habits.filter((habit) => habit.id !== 'cleaning'), now).find((habit) => habit.id === 'cleaning'))
      .toMatchObject({ schedule: { type: 'weekly' }, createdAt: now, archivedAt: null })
  })

  it('repairs a v7 database left incomplete by an old import and preserves all history and linked tables', async () => {
    const old = track(new VersionSevenDatabase(`system-upgrade-${crypto.randomUUID()}`))
    await old.open()
    const english = { ...createInitialHabits(createdAt)[1]!, name: 'Мой язык', archivedAt: createdAt }
    await old.habits.add(english)
    await old.habitEntries.add({ ...times, habitId: 'english', type: 'boolean', date: historicalDay, status: 'success', note: 'Старый факт' })
    await old.goals.add({ ...times, id: 'goal', title: 'Цель', description: '', deadline: historicalDay, status: 'active', progressMode: 'auto', manualProgress: 0, archived: false })
    await old.goalMilestones.add({ ...times, id: 'milestone', goalId: 'goal', type: 'boolean', title: 'Этап', order: 0, completed: true })
    await old.tasks.add({ ...times, id: 'task', title: 'Задача', description: '', date: historicalDay, time: null, priority: 'low', status: 'active', completedAt: null, goalId: 'goal' })
    const before = await snapshot(old)
    old.close()
    const current = track(new TaskTrackerDatabase(old.name))
    await current.open()
    expect(current.verno).toBe(9)
    expect(current.backendDB().version).toBe(90)
    const after = await snapshot(current)
    expect(after.habits).toHaveLength(24)
    expect(await current.habits.get('english')).toStrictEqual(english)
    expect({ ...after, habits: before.habits }).toStrictEqual(before)
    const historicalScore = calculateDayScore(after.habits, after.habitEntries, historicalDay)
    expect(historicalScore).toMatchObject({ score: 100, coverage: 100, eligible: 1, filled: 1 })
    for (const habit of after.habits.filter((item) => item.id !== 'english')) expect(habit.createdAt).toBe(now)
  })

  it('repairs current-version omissions on normal startup and is a no-op on subsequent startup', async () => {
    const database = track(new TaskTrackerDatabase(`system-startup-${crypto.randomUUID()}`))
    await database.open()
    await database.habits.delete('push-ups')
    const beforeEntries = await database.habitEntries.toArray()
    await initializeDatabase(database)
    expect(await database.habits.get('push-ups')).toMatchObject({ createdAt: now, quickActions: [10] })
    expect(await database.habitEntries.toArray()).toStrictEqual(beforeEntries)
    const before = await snapshot(database)
    const writes = vi.spyOn(database.habits, 'bulkPut')
    await initializeDatabase(database)
    expect(writes).not.toHaveBeenCalled()
    expect(await snapshot(database)).toStrictEqual(before)
  })

  it('uses the existing write transaction and rolls metadata plus definitions back together on failure', async () => {
    const database = track(new TaskTrackerDatabase(`system-atomic-${crypto.randomUUID()}`))
    await database.open()
    await database.habits.clear()
    const legacy: LegacyHabit = { ...createInitialHabits(createdAt)[1]! }
    delete legacy.category
    await database.habits.add(legacy as Habit)
    const before = await snapshot(database)
    const fail = (_key: unknown, habit: Habit) => { if (habit.id === 'push-ups') throw new Error('Backfill write failed') }
    database.habits.hook('creating', fail)
    try {
      await expect(database.transaction('rw', database.habits, () => ensureCurrentSystemData(database.habits))).rejects.toThrow('Backfill write failed')
    } finally { database.habits.hook('creating').unsubscribe(fail) }
    expect(await snapshot(database)).toStrictEqual(before)
    await database.transaction('rw', database.habits, () => ensureCurrentSystemData(database.habits))
    expect(await database.habits.count()).toBe(24)
    expect(await database.habitEntries.count()).toBe(0)
  })
})
