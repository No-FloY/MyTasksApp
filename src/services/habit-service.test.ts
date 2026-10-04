import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import type { BooleanHabitStatus } from '../models/habit-entry'
import { HabitService } from './habit-service'

let database: TaskTrackerDatabase
let service: HabitService
const today = getLocalDate(new Date(2026, 9, 2))
const tomorrow = getLocalDate(new Date(2026, 9, 3))

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 4, 12))
  database = new TaskTrackerDatabase(`zadachnik-test-${crypto.randomUUID()}`)
  service = new HabitService(database)
  await database.open()
})

afterEach(async () => {
  await database.delete()
  vi.useRealTimers()
})

describe('past and future boolean writes', () => {
  it('rejects a future day without writing a result', async () => {
    await expect(service.setBooleanHabitStatus('english', getLocalDate(new Date(2026, 9, 5)), 'success'))
      .rejects.toThrow('Будущий день')
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('preserves additional record fields when editing a past result', async () => {
    const entry = {
      habitId: 'english', date: today, type: 'boolean' as const, status: 'success' as const,
      createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', note: 'Старая запись',
    }
    await database.habitEntries.put(entry)
    await service.setBooleanHabitStatus('english', today, 'failure')
    expect(await database.habitEntries.get(['english', today])).toMatchObject({
      status: 'failure', note: 'Старая запись', createdAt: entry.createdAt,
    })
  })
})

describe('initial database', () => {
  it('creates the 11 required habits without inventing results', async () => {
    const habits = await database.habits.orderBy('order').toArray()
    expect(habits.map((habit) => [habit.name, habit.type])).toEqual([
      ['Воздержание', 'boolean'],
      ['Английский каждый день', 'boolean'],
      ['Чтение книги каждый день', 'boolean'],
      ['Подъём до 8:00', 'boolean'],
      ['Без чипсов', 'boolean'],
      ['Без газировок и соков', 'boolean'],
      ['Без энергетиков', 'boolean'],
      ['Без фастфуда', 'boolean'],
      ['Вода', 'amount'],
      ['Время в играх', 'duration'],
      ['Время в социальных сетях', 'duration'],
    ])
    expect(habits.find((habit) => habit.id === 'water')).toMatchObject({ target: 2000, unit: 'ml' })
    expect(habits.find((habit) => habit.id === 'gaming')).toMatchObject({ unit: 'minutes' })
    expect(habits.find((habit) => habit.id === 'social-media')).toMatchObject({ unit: 'minutes' })
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('preserves changes and deleted seeds after closing and reopening the database', async () => {
    await database.habits.update('english', { name: 'Моя практика английского' })
    await database.habits.delete('water')
    await service.setBooleanHabitStatus('english', today, 'success')
    const name = database.name
    database.close()
    database = new TaskTrackerDatabase(name)
    service = new HabitService(database)
    await database.open()

    expect(await database.habits.count()).toBe(10)
    expect((await database.habits.get('english'))?.name).toBe('Моя практика английского')
    expect(await database.habits.get('water')).toBeUndefined()
    expect(await database.habitEntries.get(['english', today])).toMatchObject({ status: 'success' })
  })
})

describe('boolean habit results', () => {
  it('returns only boolean habits and treats absent entries as no-data', async () => {
    const rows = await service.getTodayHabits(today)
    expect(rows).toHaveLength(8)
    expect(rows.every((row) => row.habit.type === 'boolean' && row.status === 'no-data')).toBe(true)
    expect(rows.map((row) => row.habit.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('persists success, failure and explicit no-data in one entry per habit and date', async () => {
    const statuses: BooleanHabitStatus[] = ['success', 'failure', 'no-data']
    for (const status of statuses) {
      await service.setBooleanHabitStatus('english', today, status)
      expect(await database.habitEntries.get(['english', today])).toMatchObject({
        habitId: 'english',
        date: today,
        type: 'boolean',
        status,
      })
      expect((await service.getTodayHabits(today)).find((row) => row.habit.id === 'english')?.status).toBe(status)
      expect(await database.habitEntries.count()).toBe(1)
    }
  })

  it('preserves creation time when updating a result', async () => {
    const originalTimestamp = '2026-10-01T10:00:00.000Z'
    await database.habitEntries.put({
      habitId: 'reading',
      date: today,
      type: 'boolean',
      status: 'success',
      createdAt: originalTimestamp,
      updatedAt: originalTimestamp,
    })
    await service.setBooleanHabitStatus('reading', today, 'failure')
    const entry = await database.habitEntries.get(['reading', today])
    expect(entry?.createdAt).toBe(originalTimestamp)
    expect(entry?.updatedAt).not.toBe(originalTimestamp)
  })

  it('keeps different dates and habits independent', async () => {
    await service.setBooleanHabitStatus('english', today, 'success')
    await service.setBooleanHabitStatus('english', tomorrow, 'failure')
    await service.setBooleanHabitStatus('reading', today, 'failure')

    expect(await database.habitEntries.count()).toBe(3)
    const nextDay = await service.getTodayHabits(tomorrow)
    expect(nextDay.find((row) => row.habit.id === 'english')?.status).toBe('failure')
    expect(nextDay.find((row) => row.habit.id === 'reading')?.status).toBe('no-data')
    expect((await service.getTodayHabits(today)).find((row) => row.habit.id === 'english')?.status).toBe('success')
  })

  it('does not create duplicate records for concurrent writes', async () => {
    await Promise.all([
      service.setBooleanHabitStatus('english', today, 'success'),
      service.setBooleanHabitStatus('english', today, 'failure'),
      service.setBooleanHabitStatus('english', today, 'no-data'),
    ])
    expect(await database.habitEntries.count()).toBe(1)
  })

  it('enforces the unique habit/date key at the IndexedDB schema level', async () => {
    await service.setBooleanHabitStatus('english', today, 'success')
    await expect(database.habitEntries.add({
      habitId: 'english',
      date: today,
      type: 'boolean',
      status: 'failure',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })).rejects.toMatchObject({ name: 'ConstraintError' })
    expect(await database.habitEntries.count()).toBe(1)
  })

  it('rejects unknown and non-boolean habits without writing a result', async () => {
    await expect(service.setBooleanHabitStatus('missing', today, 'success')).rejects.toThrow('Привычка не найдена')
    await expect(service.setBooleanHabitStatus('water', today, 'success')).rejects.toThrow('не поддерживает')
    await expect(service.setBooleanHabitStatus('gaming', today, 'success')).rejects.toThrow('не поддерживает')
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('hides archived habits and disallows new results while retaining history', async () => {
    await service.setBooleanHabitStatus('english', today, 'success')
    await database.habits.update('english', { archivedAt: new Date().toISOString() })
    expect((await service.getTodayHabits(today)).some((row) => row.habit.id === 'english')).toBe(false)
    await expect(service.setBooleanHabitStatus('english', tomorrow, 'failure')).rejects.toThrow('в архиве')
    expect(await database.habitEntries.get(['english', today])).toMatchObject({ status: 'success' })
    expect(await database.habitEntries.count()).toBe(1)
  })

  it('rejects malformed dates and statuses at the service boundary', async () => {
    await expect(service.getTodayHabits('2026-02-30' as LocalDate)).rejects.toThrow('Некорректная')
    await expect(service.setBooleanHabitStatus('english', '2026-02-30' as LocalDate, 'success')).rejects.toThrow('Некорректная')
    await expect(service.setBooleanHabitStatus('english', today, 'unknown' as BooleanHabitStatus)).rejects.toThrow('Некорректный')
    expect(await database.habitEntries.count()).toBe(0)
  })
})
