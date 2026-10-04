import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { HabitEntry } from '../models/habit-entry'
import { DurationService } from './duration-service'
import { HabitService } from './habit-service'
import { HabitNoteService, MAX_HABIT_NOTE_LENGTH } from './habit-note-service'

const timestamp = '2026-09-20T10:00:00.000Z'
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
const pastDate = date('2026-09-30')
const selectedDate = date('2026-10-03')
const futureDate = date('2026-10-05')

describe('notes on existing habit entries', () => {
  let database: TaskTrackerDatabase
  let service: HabitNoteService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 4, 12))
    database = new TaskTrackerDatabase(`zadachnik-note-test-${crypto.randomUUID()}`)
    service = new HabitNoteService(database)
    await database.open()
  })

  afterEach(async () => {
    await database.delete()
    vi.useRealTimers()
  })

  async function record(entry: Pick<HabitEntry, 'habitId'> & (
    { type: 'boolean'; status: 'success' | 'failure' | 'no-data' }
    | { type: 'amount'; value: number }
    | { type: 'duration'; minutes: number }
  ), day = selectedDate) {
    await database.habitEntries.put({ ...entry, date: day, createdAt: timestamp, updatedAt: timestamp })
  }

  it('adds and trims a past note while preserving the result, creation time, other dates and habits', async () => {
    await record({ habitId: 'english', type: 'boolean', status: 'success' })
    await record({ habitId: 'english', type: 'boolean', status: 'failure' }, pastDate)
    await record({ habitId: 'water', type: 'amount', value: 2400 })
    const pastEntry = await database.habitEntries.get(['english', pastDate])
    const waterEntry = await database.habitEntries.get(['water', selectedDate])
    await service.setHabitEntryNote('english', selectedDate, '  Прочитал главу.\nПовторил слова.  ')
    expect(await database.habitEntries.get(['english', selectedDate])).toEqual({
      habitId: 'english', date: selectedDate, type: 'boolean', status: 'success',
      note: 'Прочитал главу.\nПовторил слова.', createdAt: timestamp, updatedAt: new Date().toISOString(),
    })
    expect(await database.habitEntries.get(['english', pastDate])).toEqual(pastEntry)
    expect(await database.habitEntries.get(['water', selectedDate])).toEqual(waterEntry)
    expect(await database.habitEntries.count()).toBe(3)
  })

  it('supports explicit no-data, amount, duration zero and generic rating entries', async () => {
    await record({ habitId: 'english', type: 'boolean', status: 'no-data' })
    await record({ habitId: 'water', type: 'amount', value: 400 })
    await record({ habitId: 'gaming', type: 'duration', minutes: 0 })
    const habit = await database.habits.get('english')
    if (!habit) throw new Error('Missing fixture habit')
    await database.habits.add({ ...habit, id: 'rating-example', type: 'rating', name: 'Оценка', order: 100 })
    await database.habitEntries.add({
      habitId: 'rating-example', date: selectedDate, type: 'rating', value: 3,
      createdAt: timestamp, updatedAt: timestamp,
    })
    for (const id of ['english', 'water', 'gaming', 'rating-example']) {
      await service.setHabitEntryNote(id, selectedDate, `Заметка ${id}`)
    }
    const rows = await service.getDayNotes(selectedDate)
    expect(rows.map((row) => row.habit.id)).toEqual(['english', 'water', 'gaming', 'rating-example'])
    expect(rows.map((row) => row.entry.note)).toEqual(['Заметка english', 'Заметка water', 'Заметка gaming', 'Заметка rating-example'])
    expect(await database.habitEntries.get(['gaming', selectedDate])).toMatchObject({ minutes: 0 })
    expect(await database.habitEntries.get(['english', selectedDate])).toMatchObject({ status: 'no-data' })
  })

  it('removes only the note when cleared and keeps the saved result after reopening', async () => {
    await record({ habitId: 'water', type: 'amount', value: 2400 })
    await service.setHabitEntryNote('water', selectedDate, 'После прогулки')
    await service.setHabitEntryNote('water', selectedDate, ' \n ')
    const name = database.name
    database.close()
    database = new TaskTrackerDatabase(name)
    service = new HabitNoteService(database)
    await database.open()
    expect((await service.getDayNotes(selectedDate))[0]?.entry).toMatchObject({ value: 2400, createdAt: timestamp })
    expect((await service.getDayNotes(selectedDate))[0]?.entry).not.toHaveProperty('note')
    expect(await database.habitEntries.count()).toBe(1)
  })

  it('restores the note after reopening the database', async () => {
    await record({ habitId: 'gaming', type: 'duration', minutes: 75 })
    await service.setHabitEntryNote('gaming', selectedDate, 'С друзьями')
    const name = database.name
    database.close()
    database = new TaskTrackerDatabase(name)
    service = new HabitNoteService(database)
    await database.open()
    expect((await service.getDayNotes(selectedDate))[0]?.entry).toMatchObject({ minutes: 75, note: 'С друзьями' })
  })

  it.each(['english', 'water', 'gaming'])('does not create a fictitious result for a note on %s', async (id) => {
    await expect(service.setHabitEntryNote(id, selectedDate, 'Наблюдение')).rejects.toThrow('Сначала сохраните результат')
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('rejects a missing habit and an archived habit without changing history', async () => {
    await expect(service.setHabitEntryNote('missing', selectedDate, 'Заметка')).rejects.toThrow('не найдена')
    await record({ habitId: 'english', type: 'boolean', status: 'failure' })
    await service.setHabitEntryNote('english', selectedDate, 'Исходная заметка')
    const original = await database.habitEntries.get(['english', selectedDate])
    await database.habits.update('english', { archivedAt: timestamp })
    await expect(service.setHabitEntryNote('english', selectedDate, 'Изменение')).rejects.toThrow('в архиве')
    expect(await service.getDayNotes(selectedDate)).toEqual([])
    expect(await database.habitEntries.get(['english', selectedDate])).toEqual(original)
  })

  it('rejects a future date, including when a future record already exists', async () => {
    await record({ habitId: 'english', type: 'boolean', status: 'success' }, futureDate)
    const original = await database.habitEntries.get(['english', futureDate])
    await expect(service.setHabitEntryNote('english', futureDate, 'Слишком рано')).rejects.toThrow('Будущий день')
    expect(await database.habitEntries.get(['english', futureDate])).toEqual(original)
  })

  it('accepts the actual local day and rejects an impossible date', async () => {
    const today = getLocalDate()
    await record({ habitId: 'english', type: 'boolean', status: 'success' }, today)
    await service.setHabitEntryNote('english', today, 'Сегодня')
    expect(await database.habitEntries.get(['english', today])).toMatchObject({ note: 'Сегодня' })
    const invalid = '2026-02-30' as LocalDate
    await expect(service.setHabitEntryNote('english', invalid, 'Ошибка')).rejects.toThrow('Некорректная календарная дата')
    await expect(service.getDayNotes(invalid)).rejects.toThrow('Некорректная календарная дата')
  })

  it('accepts the length boundary after trimming and rejects longer notes without changing the saved note', async () => {
    await record({ habitId: 'english', type: 'boolean', status: 'success' })
    const text = 'я'.repeat(MAX_HABIT_NOTE_LENGTH)
    await service.setHabitEntryNote('english', selectedDate, `  ${text}  `)
    const original = await database.habitEntries.get(['english', selectedDate])
    expect(original?.note).toBe(text)
    await expect(service.setHabitEntryNote('english', selectedDate, `${text}я`)).rejects.toThrow('2000 символов')
    expect(await database.habitEntries.get(['english', selectedDate])).toEqual(original)
  })

  it('rejects incompatible and invalid records without overwriting them', async () => {
    await record({ habitId: 'english', type: 'amount', value: 1 })
    const original = await database.habitEntries.get(['english', selectedDate])
    await expect(service.setHabitEntryNote('english', selectedDate, 'Заметка')).rejects.toThrow('Тип записи')
    expect(await database.habitEntries.get(['english', selectedDate])).toEqual(original)
    await record({ habitId: 'water', type: 'amount', value: -1 })
    await expect(service.setHabitEntryNote('water', selectedDate, 'Заметка')).rejects.toThrow('количество некорректно')
    await record({ habitId: 'gaming', type: 'duration', minutes: 1441 })
    await expect(service.setHabitEntryNote('gaming', selectedDate, 'Заметка')).rejects.toThrow('от 0 до 24 часов')
  })

  it('preserves notes when results are edited and during concurrent amount updates', async () => {
    const habits = new HabitService(database)
    const durations = new DurationService(database)
    await record({ habitId: 'english', type: 'boolean', status: 'success' })
    await record({ habitId: 'water', type: 'amount', value: 400 })
    await record({ habitId: 'gaming', type: 'duration', minutes: 60 })
    await service.setHabitEntryNote('english', selectedDate, 'Английский')
    await service.setHabitEntryNote('gaming', selectedDate, 'Игры')
    await habits.setBooleanHabitStatus('english', selectedDate, 'failure')
    await durations.setHabitDuration('gaming', selectedDate, 90)
    await Promise.all([
      habits.addHabitAmount('water', selectedDate, 200),
      service.setHabitEntryNote('water', selectedDate, 'Вода'),
    ])
    expect(await database.habitEntries.get(['english', selectedDate])).toMatchObject({ status: 'failure', note: 'Английский' })
    expect(await database.habitEntries.get(['gaming', selectedDate])).toMatchObject({ minutes: 90, note: 'Игры' })
    expect(await database.habitEntries.get(['water', selectedDate])).toMatchObject({ value: 600, note: 'Вода' })
  })
})
