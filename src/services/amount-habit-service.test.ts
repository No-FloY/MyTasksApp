import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import { HabitService, parseAmountInput } from './habit-service'

let database: TaskTrackerDatabase
let service: HabitService
const today = getLocalDate(new Date(2026, 9, 2))
const tomorrow = getLocalDate(new Date(2026, 9, 3))
const originalTimestamp = '2026-10-01T10:00:00.000Z'

beforeEach(async () => {
  database = new TaskTrackerDatabase(`zadachnik-amount-test-${crypto.randomUUID()}`)
  service = new HabitService(database)
  await database.open()
})

afterEach(async () => {
  await database.delete()
})

describe('amount habit results', () => {
  it('reads the existing water seed as no-data without inventing an entry', async () => {
    const rows = await service.getTodayAmountHabits(today)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      habit: { id: 'water', type: 'amount', target: 2000, unit: 'ml' },
      value: 0,
      status: 'no-data',
      progress: 0,
    })
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('adds quick and arbitrary amounts into one actual daily value', async () => {
    let total = 0
    for (const delta of [200, 400, 150, 330]) {
      await service.addHabitAmount('water', today, delta)
      total += delta
      expect(await database.habitEntries.get(['water', today])).toMatchObject({
        type: 'amount', value: total,
      })
      expect((await service.getTodayAmountHabits(today))[0]).toMatchObject({
        value: total, status: 'in-progress',
      })
    }
    expect(await database.habitEntries.count()).toBe(1)
  })

  it('derives progress and success while retaining amounts beyond the target', async () => {
    for (const [delta, value, progress, status] of [
      [500, 500, 25, 'in-progress'],
      [500, 1000, 50, 'in-progress'],
      [1000, 2000, 100, 'success'],
      [400, 2400, 100, 'success'],
    ] as const) {
      await service.addHabitAmount('water', today, delta)
      expect((await service.getTodayAmountHabits(today))[0]).toMatchObject({ value, progress, status })
    }
    const stored = await database.habitEntries.get(['water', today])
    expect(stored).toMatchObject({ type: 'amount', value: 2400 })
    expect(stored).not.toHaveProperty('status')
    expect(stored).not.toHaveProperty('progress')
  })

  it('uses the configured amount target instead of hardcoding water rules', async () => {
    const water = await database.habits.get('water')
    if (!water || water.type !== 'amount') throw new Error('Missing water seed')
    await database.habits.put({ ...water, id: 'other-amount', name: 'Другая привычка', target: 300, order: -1 })
    await service.addHabitAmount('other-amount', today, 150)
    expect((await service.getTodayAmountHabits(today))[0]).toMatchObject({
      habit: { id: 'other-amount' }, value: 150, progress: 50, status: 'in-progress',
    })
    await service.addHabitAmount('other-amount', today, 150)
    expect((await service.getTodayAmountHabits(today))[0]).toMatchObject({ value: 300, status: 'success' })
    expect((await service.getTodayAmountHabits(today))[1]).toMatchObject({ habit: { id: 'water' }, value: 0 })
  })

  it('restores actual amounts after closing and reopening the existing database', async () => {
    await service.addHabitAmount('water', today, 2400)
    const name = database.name
    database.close()
    database = new TaskTrackerDatabase(name)
    service = new HabitService(database)
    await database.open()
    expect((await service.getTodayAmountHabits(today))[0]).toMatchObject({
      value: 2400, status: 'success', progress: 100,
    })
    expect(await database.habits.count()).toBe(11)
    expect(await database.habitEntries.count()).toBe(1)
  })

  it('keeps additions on distinct local calendar dates independent', async () => {
    await service.addHabitAmount('water', today, 200)
    expect((await service.getTodayAmountHabits(tomorrow))[0]).toMatchObject({ value: 0, status: 'no-data' })
    await service.addHabitAmount('water', tomorrow, 400)
    expect((await service.getTodayAmountHabits(today))[0]?.value).toBe(200)
    expect((await service.getTodayAmountHabits(tomorrow))[0]?.value).toBe(400)
    expect(await database.habitEntries.count()).toBe(2)
  })

  it('preserves concurrent increments without losing updates', async () => {
    const anotherService = new HabitService(database)
    await Promise.all([
      service.addHabitAmount('water', today, 200),
      anotherService.addHabitAmount('water', today, 400),
    ])
    expect((await service.getTodayAmountHabits(today))[0]?.value).toBe(600)
    expect(await database.habitEntries.count()).toBe(1)
  })

  it('keeps the creation timestamp of an existing entry', async () => {
    await database.habitEntries.put({
      habitId: 'water', date: today, type: 'amount', value: 200,
      createdAt: originalTimestamp, updatedAt: originalTimestamp,
    })
    await service.addHabitAmount('water', today, 400)
    const entry = await database.habitEntries.get(['water', today])
    expect(entry).toMatchObject({ value: 600, createdAt: originalTimestamp })
    expect(entry?.updatedAt).not.toBe(originalTimestamp)
  })

  it('keeps boolean results intact and independently editable', async () => {
    await service.setBooleanHabitStatus('english', today, 'success')
    const original = await database.habitEntries.get(['english', today])
    await service.addHabitAmount('water', today, 2400)
    await expect(service.addHabitAmount('english', today, 200)).rejects.toThrow('не поддерживает')
    expect(await database.habitEntries.get(['english', today])).toEqual(original)
    await service.setBooleanHabitStatus('english', today, 'failure')
    expect((await service.getTodayHabits(today)).find((row) => row.habit.id === 'english')?.status).toBe('failure')
    expect((await service.getTodayHabits(today))).toHaveLength(8)
    expect((await service.getTodayAmountHabits(today))[0]?.value).toBe(2400)
  })

  it('hides archived amounts, rejects additions and retains history', async () => {
    await service.addHabitAmount('water', today, 200)
    await database.habits.update('water', { archivedAt: originalTimestamp })
    expect(await service.getTodayAmountHabits(today)).toEqual([])
    await expect(service.addHabitAmount('water', today, 400)).rejects.toThrow('в архиве')
    expect(await database.habitEntries.get(['water', today])).toMatchObject({ value: 200 })
  })

  it('rejects missing and duration habits without creating entries', async () => {
    await expect(service.addHabitAmount('missing', today, 200)).rejects.toThrow('не найдена')
    await expect(service.addHabitAmount('gaming', today, 200)).rejects.toThrow('не поддерживает')
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('rejects invalid local dates at both service boundaries', async () => {
    const invalidDate = '2026-02-30' as LocalDate
    await expect(service.getTodayAmountHabits(invalidDate)).rejects.toThrow('Некорректная календарная дата')
    await expect(service.addHabitAmount('water', invalidDate, 200)).rejects.toThrow('Некорректная календарная дата')
    expect(await database.habitEntries.count()).toBe(0)
  })

  it.each([0, -200, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid increment %s without changing the actual value', async (delta) => {
      await service.addHabitAmount('water', today, 200)
      const original = await database.habitEntries.get(['water', today])
      await expect(service.addHabitAmount('water', today, delta)).rejects.toThrow('положительное целое')
      expect(await database.habitEntries.get(['water', today])).toEqual(original)
    },
  )

  it('rejects an unsafe sum without changing the stored value', async () => {
    await service.addHabitAmount('water', today, Number.MAX_SAFE_INTEGER)
    const original = await database.habitEntries.get(['water', today])
    await expect(service.addHabitAmount('water', today, 1)).rejects.toThrow('Итоговое количество слишком большое')
    expect(await database.habitEntries.get(['water', today])).toEqual(original)
  })

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid stored amount %s without overwriting it', async (value) => {
      await database.habitEntries.put({
        habitId: 'water', date: today, type: 'amount', value,
        createdAt: originalTimestamp, updatedAt: originalTimestamp,
      })
      const original = await database.habitEntries.get(['water', today])
      await expect(service.addHabitAmount('water', today, 200)).rejects.toThrow('Сохранённое количество некорректно')
      await expect(service.getTodayAmountHabits(today)).rejects.toThrow('Сохранённое количество некорректно')
      expect(await database.habitEntries.get(['water', today])).toEqual(original)
    },
  )

  it('rejects an incompatible saved entry instead of overwriting it', async () => {
    await database.habitEntries.put({
      habitId: 'water', date: today, type: 'boolean', status: 'success',
      createdAt: originalTimestamp, updatedAt: originalTimestamp,
    })
    const original = await database.habitEntries.get(['water', today])
    await expect(service.addHabitAmount('water', today, 200)).rejects.toThrow('Тип сохранённой записи')
    await expect(service.getTodayAmountHabits(today)).rejects.toThrow('Тип сохранённой записи')
    expect(await database.habitEntries.get(['water', today])).toEqual(original)
  })

  it.each([0, -1, NaN, Infinity])('rejects invalid target %s before reading or writing progress', async (target) => {
    const water = await database.habits.get('water')
    if (!water || water.type !== 'amount') throw new Error('Missing water seed')
    await database.habits.put({ ...water, target })
    await expect(service.getTodayAmountHabits(today)).rejects.toThrow('некорректная дневная цель')
    await expect(service.addHabitAmount('water', today, 200)).rejects.toThrow('некорректная дневная цель')
    expect(await database.habitEntries.count()).toBe(0)
  })
})

describe('manual amount input', () => {
  it.each([['150', 150], [' 330 ', 330], ['500', 500], ['00200', 200]])(
    'parses decimal integer input %s', (input, amount) => {
      expect(parseAmountInput(input)).toBe(amount)
    },
  )

  it.each(['', ' ', '0', '-150', '+200', '1.5', '1,5', '1e3', 'NaN', 'Infinity', '0x100', '1 000', '9007199254740992'])(
    'rejects invalid manual input %s', (input) => {
      expect(() => parseAmountInput(input)).toThrow('положительное целое')
    },
  )
})
