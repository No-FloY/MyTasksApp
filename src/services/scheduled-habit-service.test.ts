import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { isLocalDate, type LocalDate } from '../lib/local-date'
import { HabitService } from './habit-service'
import { HabitNoteService } from './habit-note-service'
import { computeDaySummary } from './calendar-service'
import { StreakService } from './streak-service'

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid test date')
  return value
}

let database: TaskTrackerDatabase
let service: HabitService
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 1, 12))
  database = new TaskTrackerDatabase(`scheduled-${crypto.randomUUID()}`)
  await database.open()
  service = new HabitService(database)
})
afterEach(async () => {
  await database.delete()
  vi.useRealTimers()
})

describe('scheduled HabitEntry persistence', () => {
  it('updates one weekly entry from different days, retaining the note and creation timestamp', async () => {
    await service.setBooleanHabitStatus('cleaning', date('2026-10-28'), 'success')
    const notes = new HabitNoteService(database)
    await notes.setHabitEntryNote('cleaning', date('2026-10-30'), 'Вымыты окна')
    const original = await database.habitEntries.get(['cleaning', date('2026-10-26')])
    await service.setBooleanHabitStatus('cleaning', date('2026-11-01'), 'failure')
    expect(await database.habitEntries.count()).toBe(1)
    expect(await database.habitEntries.get(['cleaning', date('2026-10-26')])).toMatchObject({
      status: 'failure', note: 'Вымыты окна', createdAt: original?.createdAt,
    })
    expect((await service.getTodayHabits(date('2026-10-29'))).find((item) => item.habit.id === 'cleaning')?.status).toBe('failure')
    expect((await notes.getDayNotes(date('2026-10-31'))).find((item) => item.habit.id === 'cleaning')?.entry.note).toBe('Вымыты окна')
    expect((await service.getTodayHabits(date('2026-10-19'))).find((item) => item.habit.id === 'cleaning')?.status).toBe('no-data')
  })

  it('keeps weeks independent across month boundaries and preserves explicit no-data', async () => {
    await service.setBooleanHabitStatus('cleaning', date('2026-10-25'), 'success')
    await service.setBooleanHabitStatus('cleaning', date('2026-11-01'), 'no-data')
    expect(await database.habitEntries.count()).toBe(2)
    expect((await service.getTodayHabits(date('2026-10-22'))).find((item) => item.habit.id === 'cleaning')?.status).toBe('success')
    expect((await service.getTodayHabits(date('2026-11-01'))).find((item) => item.habit.id === 'cleaning')?.status).toBe('no-data')
  })

  it('keeps alcohol and meals as daily booleans', async () => {
    for (const id of ['no-alcohol', 'breakfast', 'lunch', 'dinner']) {
      await service.setBooleanHabitStatus(id, date('2026-10-31'), 'success')
      await service.setBooleanHabitStatus(id, date('2026-11-01'), 'failure')
      expect(await database.habitEntries.get([id, date('2026-10-31')])).toMatchObject({ status: 'success' })
      expect(await database.habitEntries.get([id, date('2026-11-01')])).toMatchObject({ status: 'failure' })
    }
    expect(await database.habitEntries.count()).toBe(8)
  })

  it('does not put weekly results into daily calendar cells or daily streaks', async () => {
    await service.setBooleanHabitStatus('cleaning', date('2026-11-01'), 'failure')
    const habits = await database.habits.toArray()
    const entries = await database.habitEntries.toArray()
    for (const day of ['2026-10-26', '2026-10-27', '2026-11-01']) {
      expect(computeDaySummary(habits, entries, date(day))).toMatchObject({ total: 22, recorded: 0, failures: 0 })
    }
    expect((await new StreakService(database).getBooleanStatistics(date('2026-11-01'))).some((item) => item.habit.id === 'cleaning')).toBe(false)
  })

  it('shows weekday habits only when expected, and maps a scheduled weekly result to its due day', async () => {
    await database.habits.update('english', { schedule: { type: 'weekdays', days: [1, 3, 5] } })
    expect((await service.getTodayHabits(date('2026-10-27'))).some((item) => item.habit.id === 'english')).toBe(false)
    expect((await service.getTodayHabits(date('2026-10-28'))).some((item) => item.habit.id === 'english')).toBe(true)
    await database.habits.update('cleaning', { schedule: { type: 'weekly', weekday: 7 } })
    await service.setBooleanHabitStatus('cleaning', date('2026-10-28'), 'success')
    const habits = await database.habits.toArray()
    const entries = await database.habitEntries.toArray()
    expect(computeDaySummary(habits, entries, date('2026-11-01'))).toMatchObject({ total: 22, recorded: 1, successes: 1 })
    expect(computeDaySummary(habits, entries, date('2026-10-28'))).toMatchObject({ total: 22, recorded: 0 })
  })
})
