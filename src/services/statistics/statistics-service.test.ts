import 'fake-indexeddb/auto'
import { liveQuery } from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../../db/database'
import { createInitialHabits } from '../../db/seed'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { Goal, GoalMilestone } from '../../models/goal'
import type { HabitEntry } from '../../models/habit-entry'
import type { Task } from '../../models/task'
import { getStatisticsPeriod } from './period-utils'
import { calculateStatistics, StatisticsService, type StatisticsDashboard, type StatisticsSource } from './statistics-service'

const timestamp = '2026-09-01T10:00:00.000Z'
const now = new Date(2026, 9, 16, 12)

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

const today = date('2026-10-16')
const period = getStatisticsPeriod('month', today)

function booleanEntry(day: string, status: 'success' | 'failure' | 'no-data', habitId = 'english'): HabitEntry {
  return { habitId, date: date(day), type: 'boolean', status, createdAt: timestamp, updatedAt: timestamp }
}

function amountEntry(day: string, value: number): HabitEntry {
  return { habitId: 'water', date: date(day), type: 'amount', value, createdAt: timestamp, updatedAt: timestamp }
}

function durationEntry(day: string, minutes: number, habitId = 'gaming'): HabitEntry {
  return { habitId, date: date(day), type: 'duration', minutes, createdAt: timestamp, updatedAt: timestamp }
}

function task(fields: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(), title: 'Задача', description: '', date: today, time: null,
    priority: 'medium', status: 'active', completedAt: null, createdAt: timestamp, updatedAt: timestamp,
    ...fields,
  }
}

function goal(fields: Partial<Goal> = {}): Goal {
  return {
    id: 'goal', title: 'Цель', description: '', deadline: null, status: 'active',
    progressMode: 'auto', manualProgress: 0, archived: false, createdAt: timestamp, updatedAt: timestamp,
    ...fields,
  }
}

function milestone(completed = false): GoalMilestone {
  return { id: 'milestone', goalId: 'goal', title: 'Этап', type: 'boolean', completed, order: 0, createdAt: timestamp, updatedAt: timestamp }
}

function source(fields: Partial<StatisticsSource> = {}): StatisticsSource {
  return { habits: createInitialHabits(timestamp), entries: [], tasks: [], goals: [], milestones: [], ...fields }
}

describe('statistics dashboard calculations', () => {
  it('weights explicit habit marks equally without averaging per-habit percentages', () => {
    const input = source({ entries: [
      booleanEntry('2026-10-01', 'success'), booleanEntry('2026-10-02', 'success'),
      booleanEntry('2026-10-03', 'success'), booleanEntry('2026-10-04', 'no-data'),
      booleanEntry('2026-10-01', 'failure', 'reading'),
    ] })
    const original = structuredClone(input)
    const result = calculateStatistics(input, period, now)
    expect(result).toMatchObject({ successCount: 3, markedCount: 4, habitSuccessRate: 75, hasPeriodData: true })
    expect(input).toEqual(original)
  })

  it('groups independent real measures into clipped Monday weeks without repeating boundary days', () => {
    const input = source({
      entries: [
        booleanEntry('2026-10-04', 'success'), booleanEntry('2026-10-05', 'failure'),
        booleanEntry('2026-10-11', 'success'), booleanEntry('2026-10-12', 'no-data'),
        amountEntry('2026-10-04', 3000), amountEntry('2026-10-05', 0),
        durationEntry('2026-10-04', 60), durationEntry('2026-10-05', 0), durationEntry('2026-10-11', 120),
        durationEntry('2026-10-12', 15, 'social-media'),
      ],
      tasks: [
        task({ date: date('2026-10-04'), status: 'completed', completedAt: new Date(2026, 9, 4, 15).toISOString() }),
        task({ date: date('2026-10-05'), status: 'failed' }),
        task({ date: date('2026-10-11'), status: 'cancelled' }),
      ],
    })
    expect(calculateStatistics(input, period, now).weekly).toEqual([
      { startDate: '2026-10-01', endDate: '2026-10-04', habitSuccessRate: 100, taskOnTimeRate: 100, waterSuccessRate: 100, gamingAverage: 60, socialAverage: null },
      { startDate: '2026-10-05', endDate: '2026-10-11', habitSuccessRate: 50, taskOnTimeRate: 0, waterSuccessRate: 0, gamingAverage: 60, socialAverage: null },
      { startDate: '2026-10-12', endDate: '2026-10-16', habitSuccessRate: null, taskOnTimeRate: null, waterSuccessRate: null, gamingAverage: null, socialAverage: 15 },
    ])
    expect(calculateStatistics(input, getStatisticsPeriod('7d', today), now).weekly).toEqual([])
  })

  it('distinguishes no period results from explicit numeric zero and current goals', () => {
    const empty = calculateStatistics(source({ goals: [goal()], entries: [booleanEntry('2026-10-16', 'no-data')] }), period, now)
    expect(empty).toMatchObject({ hasPeriodData: false, habitSuccessRate: null })
    expect(empty.goals.activeGoals).toBe(1)
    expect(empty.tasks.onTimeRate).toBeNull()
    expect(empty.weekly.every((week) => week.habitSuccessRate === null)).toBe(true)
    expect(calculateStatistics(source({ entries: [amountEntry('2026-10-16', 0)] }), period, now).hasPeriodData).toBe(true)
    expect(calculateStatistics(source({ entries: [durationEntry('2026-10-16', 0)] }), period, now).hasPeriodData).toBe(true)
  })

  it('shows current goals unchanged when selecting an earlier period', () => {
    const input = source({ goals: [goal({ createdAt: '2026-10-15T10:00:00.000Z', deadline: date('2026-10-15') })], milestones: [milestone(true)] })
    const previousMonth = getStatisticsPeriod('previous-month', today)
    const currentGoals = calculateStatistics(input, period, now).goals
    expect(calculateStatistics(input, previousMonth, now).goals).toEqual(currentGoals)
    expect(currentGoals).toMatchObject({ activeGoals: 1, overdueGoals: 1, averageProgress: 100 })
  })
})

describe('statistics snapshot from IndexedDB', () => {
  let database: TaskTrackerDatabase
  let service: StatisticsService

  beforeEach(async () => {
    database = new TaskTrackerDatabase(`statistics-dashboard-${crypto.randomUUID()}`)
    service = new StatisticsService(database)
    await database.open()
    await database.habits.bulkPut(createInitialHabits(timestamp))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await database.delete()
  })

  it('reads both range boundaries and preserves all five source stores without saved aggregates', async () => {
    await database.habitEntries.bulkPut([
      booleanEntry('2026-09-30', 'failure'), booleanEntry('2026-10-01', 'success'),
      booleanEntry('2026-10-16', 'success'), booleanEntry('2026-10-17', 'failure'),
      amountEntry('2026-10-01', 0), amountEntry('2026-10-16', 2400),
      durationEntry('2026-10-01', 0), durationEntry('2026-10-16', 120),
    ])
    await database.tasks.bulkAdd([
      task({ date: date('2026-09-30') }), task({ date: date('2026-10-01'), status: 'failed' }),
      task({ date: today, status: 'completed', completedAt: now.toISOString() }), task({ date: date('2026-10-17') }),
    ])
    await database.goals.add(goal())
    await database.goalMilestones.add(milestone(true))
    const before = await Promise.all(database.tables.map((table) => table.toArray()))
    const result = await service.getStatistics(period, now)
    expect(result).toMatchObject({ markedCount: 2, successCount: 2, habitSuccessRate: 100 })
    expect(result.amounts[0]).toMatchObject({ total: 2400, average: 1200, daysWithData: 2 })
    expect(result.durations[0]).toMatchObject({ totalMinutes: 120, averageMinutes: 60, recordedDays: 2 })
    expect(result.tasks).toMatchObject({ tasksDue: 2, failed: 1, completedOnTime: 1, onTimeRate: 50 })
    expect(result.goals).toMatchObject({ activeGoals: 1, averageProgress: 100 })
    expect(await Promise.all(database.tables.map((table) => table.toArray()))).toEqual(before)
    expect(database.verno).toBe(4)
    expect(database.tables.map((table) => table.name).sort()).toEqual(['goalMilestones', 'goals', 'habitEntries', 'habits', 'tasks'])
  })

  it('retains archived histories and omits habits that did not exist during the selected period', async () => {
    await database.habits.update('english', { createdAt: '2026-10-03T10:00:00.000Z', archivedAt: '2026-10-04T10:00:00.000Z' })
    await database.habits.update('gaming', { archivedAt: '2026-09-20T10:00:00.000Z' })
    await database.habits.update('water', { createdAt: '2026-10-15T10:00:00.000Z' })
    await database.habitEntries.bulkAdd([booleanEntry('2026-10-03', 'success'), amountEntry('2026-10-16', 0)])
    const result = await service.getStatistics(period, now)
    expect(result.booleans.find((item) => item.habit.id === 'english')).toMatchObject({ eligibleDays: 2, markedCount: 1, noDataCount: 1 })
    expect(result.amounts[0]).toMatchObject({ eligibleDays: 2, noDataCount: 1, daysWithData: 1, total: 0 })
    expect(result.durations.map((item) => item.habit.id)).toEqual(['social-media'])
    expect(await database.habitEntries.count()).toBe(2)
  })

  it('uses older backdated keys consistently when switching ranges without reading their values', async () => {
    await database.habits.bulkPut(createInitialHabits('2026-10-15T10:00:00.000Z'))
    await database.habitEntries.bulkAdd([
      booleanEntry('2026-09-20', 'success'), amountEntry('2026-09-20', 3000), durationEntry('2026-09-20', 120),
      booleanEntry('2026-10-16', 'success'), amountEntry('2026-10-16', 2000), durationEntry('2026-10-16', 60),
    ])
    const result = await service.getStatistics(period, now)
    expect(result.booleans.find((item) => item.habit.id === 'english')).toMatchObject({ eligibleDays: 16, successCount: 1, noDataCount: 15 })
    expect(result.amounts[0]).toMatchObject({ eligibleDays: 16, noDataCount: 15, total: 2000 })
    expect(result.durations[0]).toMatchObject({ eligibleDays: 16, noDataCount: 15, totalMinutes: 60, averagePerDayMinutes: 60 / 16 })
    expect(result.durations.find((item) => item.habit.id === 'social-media')).toMatchObject({ eligibleDays: 2 })
    const earlier = await service.getStatistics(getStatisticsPeriod('custom', today, { startDate: '2026-10-01', endDate: '2026-10-04' }), now)
    expect(earlier.booleans.find((item) => item.habit.id === 'english')).toMatchObject({ eligibleDays: 4, successCount: 0, noDataCount: 4 })
    expect(earlier.amounts[0]).toMatchObject({ eligibleDays: 4, noDataCount: 4, total: null })
    expect(earlier.durations[0]).toMatchObject({ eligibleDays: 4, noDataCount: 4, averagePerDayMinutes: null })
  })

  it('reads a year with a bounded number of indexed queries instead of one query per day', async () => {
    const habitQuery = vi.spyOn(database.habitEntries, 'where')
    const taskQuery = vi.spyOn(database.tasks, 'where')
    const result = await service.getStatistics(getStatisticsPeriod('year', today), now)
    expect(result.period.dates).toHaveLength(365)
    expect(result.weekly.length).toBeGreaterThan(50)
    expect(habitQuery.mock.calls.length).toBeLessThanOrEqual(2)
    expect(taskQuery).toHaveBeenCalledTimes(1)
  })

  it('updates live results after changes to entries, habit settings, tasks, goals and milestones in another connection', async () => {
    const other = new TaskTrackerDatabase(database.name)
    await other.open()
    const results: StatisticsDashboard[] = []
    const errors: unknown[] = []
    const subscription = liveQuery(() => service.getStatistics(period, now)).subscribe({
      next: (result) => results.push(result), error: (error: unknown) => errors.push(error),
    })
    const latest = () => results.at(-1)
    try {
      await vi.waitFor(() => expect(latest()?.hasPeriodData).toBe(false))
      await other.habitEntries.put(amountEntry('2026-10-16', 2400))
      await vi.waitFor(() => expect(latest()?.amounts[0]?.successfulDays).toBe(1))
      await other.habits.update('water', (habit) => {
        if (habit.type === 'amount') habit.target = 2500
      })
      await vi.waitFor(() => expect(latest()?.amounts[0]?.successfulDays).toBe(0))
      await other.tasks.add(task({ status: 'completed', completedAt: now.toISOString() }))
      await vi.waitFor(() => expect(latest()?.tasks.completedOnTime).toBe(1))
      await other.goals.add(goal())
      await vi.waitFor(() => expect(latest()?.goals.activeGoals).toBe(1))
      await other.goalMilestones.add(milestone(true))
      await vi.waitFor(() => expect(latest()?.goals.averageProgress).toBe(100))
      expect(errors).toEqual([])
    } finally {
      subscription.unsubscribe()
      other.close()
    }
  })

  it('recalculates lifecycle counts when an older backdated entry is added or deleted', async () => {
    await database.habits.update('english', { createdAt: '2026-10-15T10:00:00.000Z' })
    const pastPeriod = getStatisticsPeriod('custom', today, { startDate: '2026-10-01', endDate: '2026-10-04' })
    const results: StatisticsDashboard[] = []
    const errors: unknown[] = []
    const subscription = liveQuery(() => service.getStatistics(pastPeriod, now)).subscribe({
      next: (result) => results.push(result), error: (error: unknown) => errors.push(error),
    })
    const english = () => results.at(-1)?.booleans.find((item) => item.habit.id === 'english')
    try {
      await vi.waitFor(() => expect(results).toHaveLength(1))
      expect(english()).toBeUndefined()
      await database.habitEntries.add(booleanEntry('2026-09-20', 'success'))
      await vi.waitFor(() => expect(english()).toMatchObject({ eligibleDays: 4, noDataCount: 4, successCount: 0 }))
      await database.habitEntries.delete(['english', date('2026-09-20')])
      await vi.waitFor(() => expect(english()).toBeUndefined())
      expect(errors).toEqual([])
    } finally {
      subscription.unsubscribe()
    }
  })
})
