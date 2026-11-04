import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { getLocalDate } from '../lib/local-date'
import { HabitService } from './habit-service'

let database: TaskTrackerDatabase
let service: HabitService
const date = getLocalDate(new Date(2026, 9, 24))

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 24, 12))
  database = new TaskTrackerDatabase(`training-${crypto.randomUUID()}`)
  service = new HabitService(database)
  await database.open()
})
afterEach(async () => { await database.delete(); vi.useRealTimers() })

describe('training uses universal Habit/HabitEntry services', () => {
  it.each([
    ['push-ups', 10, 100], ['abs', 10, 100], ['squats', 10, 100], ['pull-ups', 1, 15],
  ] as const)('%s increments atomically, replaces totals, preserves notes and allows overachievement', async (id, increment, target) => {
    const habit = await database.habits.get(id)
    expect(habit).toMatchObject({ type: 'amount', category: 'training', unit: 'reps', target, quickActions: [increment], manualMode: 'total' })
    await Promise.all([service.addHabitAmount(id, date, increment), service.addHabitAmount(id, date, increment)])
    expect(await database.habitEntries.get([id, date])).toMatchObject({ type: 'amount', value: increment * 2 })
    await database.habitEntries.update([id, date], { note: 'Не терять заметку' })
    const createdAt = (await database.habitEntries.get([id, date]))?.createdAt
    await service.setHabitAmount(id, date, target)
    expect((await service.getTodayAmountHabits(date)).find((item) => item.habit.id === id)).toMatchObject({ value: target, status: 'success', progress: 100 })
    await service.setHabitAmount(id, date, target + increment * 3)
    expect((await service.getTodayAmountHabits(date)).find((item) => item.habit.id === id)).toMatchObject({ value: target + increment * 3, status: 'success', progress: 100 })
    expect(await database.habitEntries.get([id, date])).toMatchObject({ note: 'Не терять заметку', createdAt })
    await service.setHabitAmount(id, date, 0)
    expect((await service.getTodayAmountHabits(date)).find((item) => item.habit.id === id)).toMatchObject({ value: 0, hasEntry: true, status: 'in-progress' })
    expect(await database.habitEntries.where('habitId').equals(id).count()).toBe(1)
  })

  it.each(['no-sweets', 'walk-10km', 'workout'])('%s preserves all explicit boolean states without derived workout results', async (id) => {
    for (const status of ['success', 'failure', 'no-data'] as const) {
      await service.setBooleanHabitStatus(id, date, status)
      expect(await database.habitEntries.get([id, date])).toMatchObject({ type: 'boolean', status })
    }
    await service.setHabitAmount('push-ups', date, 130)
    if (id !== 'workout') expect(await database.habitEntries.get(['workout', date])).toBeUndefined()
    else expect(await database.habitEntries.get(['workout', date])).toMatchObject({ status: 'no-data' })
  })
})
