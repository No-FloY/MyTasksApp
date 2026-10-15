import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import type { Task } from '../models/task'
import { GoalService } from '../services/goal-service'
import { TaskTrackerDatabase } from './database'
import { createInitialHabits } from './seed'

class VersionThreeDatabase extends Dexie {
  habits!: Table<Habit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>
  tasks!: Table<Task, string>

  constructor(name: string) {
    super(name)
    this.version(3).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
      tasks: 'id, date, status',
    })
  }
}

const databases: Dexie[] = []
const createdAt = '2026-09-01T07:05:00.000Z'
const updatedAt = '2026-10-02T21:20:00.000Z'
const day = getLocalDate(new Date(2026, 9, 3))

async function legacyDatabase() {
  const legacy = new VersionThreeDatabase(`zadachnik-goal-migration-${crypto.randomUUID()}`)
  databases.push(legacy)
  await legacy.open()
  await legacy.habits.bulkAdd(createInitialHabits(createdAt).filter((habit) => habit.id !== 'reading'))
  await legacy.habits.update('gaming', { name: 'Мои игры', updatedAt, archivedAt: updatedAt })
  const history: HabitEntry[] = [
    { habitId: 'english', date: day, type: 'boolean', status: 'no-data', note: 'Моя заметка', createdAt, updatedAt },
    { habitId: 'water', date: day, type: 'amount', value: 2400, createdAt, updatedAt },
    { habitId: 'gaming', date: day, type: 'duration', minutes: 0, createdAt, updatedAt },
  ]
  await legacy.habitEntries.bulkAdd(history)
  await legacy.tasks.bulkAdd([
    { id: 'active-task', title: 'Подготовить резюме', description: 'Первая строка\nВторая строка', date: day, time: '18:30', priority: 'high', status: 'active', completedAt: null, createdAt, updatedAt },
    { id: 'completed-task', title: 'Собрать документы', description: '', date: day, time: null, priority: 'low', status: 'completed', completedAt: updatedAt, createdAt, updatedAt },
  ])
  return legacy
}

async function currentDatabase(name: string) {
  const current = new TaskTrackerDatabase(name)
  databases.push(current)
  await current.open()
  return current
}

afterEach(async () => {
  const names = new Set(databases.map((database) => database.name))
  for (const database of databases) database.close()
  databases.length = 0
  for (const name of names) await Dexie.delete(name)
})

describe('goal migration from IndexedDB v3 to v4', () => {
  it('adds only empty goal stores and an optional goalId index, preserving every legacy row exactly', async () => {
    const legacy = await legacyDatabase()
    const habits = await legacy.habits.toArray()
    const entries = await legacy.habitEntries.toArray()
    const tasks = await legacy.tasks.toArray()
    const habitSchema = legacy.habits.schema
    const entrySchema = legacy.habitEntries.schema
    const taskPrimaryKey = legacy.tasks.schema.primKey
    const taskIndexes = legacy.tasks.schema.indexes
    legacy.close()
    const current = await currentDatabase(legacy.name)

    expect(current.verno).toBe(4)
    expect(current.backendDB().version).toBe(40)
    expect(current.tables.map(({ name }) => name).sort()).toEqual(['goalMilestones', 'goals', 'habitEntries', 'habits', 'tasks'])
    expect(await current.habits.toArray()).toStrictEqual(habits)
    expect(await current.habitEntries.toArray()).toStrictEqual(entries)
    expect(await current.tasks.toArray()).toStrictEqual(tasks)
    expect(current.habits.schema).toStrictEqual(habitSchema)
    expect(current.habitEntries.schema).toStrictEqual(entrySchema)
    expect(current.tasks.schema.primKey).toStrictEqual(taskPrimaryKey)
    expect(current.tasks.schema.indexes.slice(0, 2)).toStrictEqual(taskIndexes)
    expect(current.tasks.schema.idxByName.goalId).toMatchObject({ keyPath: 'goalId', unique: false, multi: false })
    expect(current.goalMilestones.schema.idxByName['[goalId+order]']).toMatchObject({ keyPath: ['goalId', 'order'], unique: false })
    expect(await current.goals.count()).toBe(0)
    expect(await current.goalMilestones.count()).toBe(0)
    expect(await current.tasks.where('goalId').equals('missing').toArray()).toEqual([])
  })

  it('can link migrated tasks and persist milestones through reopen without reseeding or rewriting history', async () => {
    const legacy = await legacyDatabase()
    const habits = await legacy.habits.toArray()
    const history = await legacy.habitEntries.toArray()
    const task = await legacy.tasks.get('active-task')
    const completedTask = await legacy.tasks.get('completed-task')
    legacy.close()
    const current = await currentDatabase(legacy.name)
    const service = new GoalService(current)
    const goal = await service.createGoal({ title: 'Найти работу', deadline: '2026-12-31', progressMode: 'auto', manualProgress: 0 })
    const boolean = await service.addMilestone(goal.id, { type: 'boolean', title: 'Резюме', completed: true })
    const amount = await service.addMilestone(goal.id, { type: 'amount', title: 'Отклики', current: 17, target: 30 })
    const linked = await service.linkTask(goal.id, 'active-task')
    current.close()

    const reopened = await currentDatabase(legacy.name)
    const details = await new GoalService(reopened).getGoalDetails(goal.id)
    expect(details).toMatchObject({ goal: { ...goal, updatedAt: expect.any(String) }, milestones: [boolean, amount], tasks: [linked] })
    expect(linked).toMatchObject({ ...task, goalId: goal.id, updatedAt: expect.any(String) })
    expect(await reopened.tasks.get('completed-task')).toStrictEqual(completedTask)
    expect(await reopened.habits.toArray()).toStrictEqual(habits)
    expect(await reopened.habitEntries.toArray()).toStrictEqual(history)
    expect(await reopened.habits.get('reading')).toBeUndefined()
    expect(await reopened.tasks.where('date').equals(day).count()).toBe(2)
    expect(await reopened.tasks.where('status').equals('completed').count()).toBe(1)
    expect(await reopened.tasks.where('goalId').equals(goal.id).toArray()).toEqual([linked])
  })

  it('creates new databases with the usual seed and no invented goals, milestones or tasks', async () => {
    const current = await currentDatabase(`zadachnik-new-goals-${crypto.randomUUID()}`)
    expect(await current.habits.count()).toBe(11)
    expect(await current.habitEntries.count()).toBe(0)
    expect(await current.tasks.count()).toBe(0)
    expect(await current.goals.count()).toBe(0)
    expect(await current.goalMilestones.count()).toBe(0)
    current.close()
    await current.open()
    expect(await current.habits.count()).toBe(11)
  })
})
