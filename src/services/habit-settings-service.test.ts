import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { DurationRatingRange } from '../models/duration-rating'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import { BackupService, parseBackupJson } from './backup-service'
import { CalendarService } from './calendar-service'
import { DurationService, getDurationRating } from './duration-service'
import { HabitNoteService } from './habit-note-service'
import { HabitService } from './habit-service'
import {
  HabitSettingsService, MAX_HABIT_DESCRIPTION_LENGTH, MAX_HABIT_NAME_LENGTH,
  MAX_RATING_EMOJI_LENGTH, MAX_RATING_LABEL_LENGTH, type HabitSettingsInput,
} from './habit-settings-service'
import { getStatisticsPeriod } from './statistics/period-utils'
import { StatisticsService } from './statistics/statistics-service'

const timestamp = '2026-10-01T09:00:00.000Z'
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
const past = date('2026-10-10')
const rangeFixture: DurationRatingRange[] = [
  { id: 'short', label: 'Недолго', emoji: '🙂', minMinutes: 0, maxMinutes: 60 },
  { id: 'long', label: 'Долго', emoji: '🙁', minMinutes: 61, maxMinutes: null },
]
const booleanInput: HabitSettingsInput = { type: 'boolean', name: 'Новое название', description: 'Описание' }
const amountInput: HabitSettingsInput = { type: 'amount', name: 'Вода', description: '', target: 2500 }
const durationInput: HabitSettingsInput = { type: 'duration', name: 'Игры', description: '', ratingRanges: rangeFixture }

describe('habit settings on the existing universal model', () => {
  let database: TaskTrackerDatabase
  let service: HabitSettingsService
  let results: HabitService
  let durations: DurationService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 20, 12))
    database = new TaskTrackerDatabase(`zadachnik-settings-test-${crypto.randomUUID()}`)
    service = new HabitSettingsService(database)
    results = new HabitService(database)
    durations = new DurationService(database)
    await database.open()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await database.delete()
    vi.useRealTimers()
  })

  async function getHabit(id: string): Promise<Habit> {
    const habit = await database.habits.get(id)
    if (!habit) throw new Error('Missing fixture habit')
    return habit
  }

  async function seedHistory(): Promise<HabitEntry[]> {
    await database.habitEntries.bulkPut([
      { habitId: 'english', date: past, type: 'boolean', status: 'success', note: 'Урок\nи повторение', createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'water', date: past, type: 'amount', value: 2200, note: 'После прогулки', createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'water', date: date('2026-10-11'), type: 'amount', value: 1800, createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'water', date: date('2026-10-12'), type: 'amount', value: 2600, createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'gaming', date: past, type: 'duration', minutes: 90, note: 'С друзьями', createdAt: timestamp, updatedAt: timestamp },
      { habitId: 'social-media', date: past, type: 'duration', minutes: 0, createdAt: timestamp, updatedAt: timestamp },
    ])
    return database.habitEntries.toArray()
  }

  it('returns active and archived habits in the existing order', async () => {
    await service.setHabitArchived('english', true)
    await database.habits.update('english', { order: 100 })
    const habits = await service.getHabits()
    expect(habits).toHaveLength(11)
    expect(habits.at(-1)).toMatchObject({ id: 'english', order: 100, archivedAt: new Date().toISOString() })
    expect(habits.map((habit) => habit.order)).toEqual(habits.map((habit) => habit.order).sort((a, b) => a - b))
  })

  it('renames and describes a habit while preserving its identity and all exact historical fields', async () => {
    const history = await seedHistory()
    const previous = await getHabit('english')
    vi.setSystemTime(new Date(2026, 9, 21, 12))
    await service.updateHabit('english', { ...booleanInput, name: '  Языки  ', description: '  Урок\nи повторение  ' })
    expect(await getHabit('english')).toEqual({
      ...previous, name: 'Языки', description: 'Урок\nи повторение', updatedAt: new Date().toISOString(),
    })
    expect(await database.habitEntries.toArray()).toEqual(history)
  })

  it('supports generic rating habits without changing their historical numeric value', async () => {
    const base = await getHabit('english')
    await database.habits.put({ ...base, id: 'mood', name: 'Настроение', type: 'rating' })
    const entry: HabitEntry = { habitId: 'mood', date: past, type: 'rating', value: 4.5, createdAt: timestamp, updatedAt: timestamp }
    await database.habitEntries.put(entry)
    await service.updateHabit('mood', { type: 'rating', name: 'Самочувствие', description: 'Моя оценка' })
    expect(await getHabit('mood')).toMatchObject({ id: 'mood', type: 'rating', name: 'Самочувствие' })
    expect(await database.habitEntries.get(['mood', past])).toEqual(entry)
  })

  it('changes the amount target and reclassifies statistics without rewriting facts', async () => {
    const history = await seedHistory()
    const period = getStatisticsPeriod('month', getLocalDate())
    const statistics = new StatisticsService(database)
    expect((await statistics.getStatistics(period, new Date())).amounts.find((item) => item.habit.id === 'water')?.successfulDays).toBe(2)
    const previous = await getHabit('water')
    await service.updateHabit('water', amountInput)
    expect(await getHabit('water')).toEqual({ ...previous, name: 'Вода', description: '', target: 2500 })
    expect((await statistics.getStatistics(period, new Date())).amounts.find((item) => item.habit.id === 'water')).toMatchObject({
      successfulDays: 1, daysWithData: 3, total: 6600,
    })
    expect(await database.habitEntries.toArray()).toEqual(history)
  })

  it('changes duration ranges and reclassifies historical ratings while preserving exact minutes and notes', async () => {
    const history = await seedHistory()
    const statistics = new StatisticsService(database)
    const period = getStatisticsPeriod('month', getLocalDate())
    const before = await statistics.getStatistics(period, new Date())
    expect(before.durations.find((item) => item.habit.id === 'gaming')?.days.find((day) => day.date === past)?.rating?.label).toBe('Отлично')
    await service.updateHabit('gaming', durationInput)
    const after = await statistics.getStatistics(period, new Date())
    expect(after.durations.find((item) => item.habit.id === 'gaming')?.days.find((day) => day.date === past)).toMatchObject({
      minutes: 90, rating: { id: 'long', label: 'Долго' },
    })
    expect(await database.habitEntries.toArray()).toEqual(history)
  })

  it('accepts inclusive boundaries at zero, an adjacent minute and the maximum daily duration', async () => {
    const ranges: DurationRatingRange[] = [
      { id: 'zero', label: 'Ноль', emoji: '🙂', minMinutes: 0, maxMinutes: 0 },
      { id: 'middle', label: 'До суток', emoji: '😐', minMinutes: 1, maxMinutes: 1439 },
      { id: 'day', label: 'Сутки', emoji: '🙁', minMinutes: 1440, maxMinutes: null },
    ]
    await service.updateHabit('gaming', { ...durationInput, ratingRanges: ranges })
    for (const [minutes, expected] of [[0, 'zero'], [1, 'middle'], [1439, 'middle'], [1440, 'day']] as const) {
      expect(getDurationRating(minutes, ranges).id).toBe(expected)
    }
  })

  it('normalizes labels without retaining unrelated input fields or changing range IDs', async () => {
    const ranges = rangeFixture.map((range) => ({ ...range, label: ` ${range.label} `, emoji: ` ${range.emoji} `, unexpected: 'ignore' }))
    await service.updateHabit('gaming', { ...durationInput, ratingRanges: ranges })
    expect(await getHabit('gaming')).toMatchObject({ ratingRanges: rangeFixture })
  })

  it.each([
    {
      scenario: 'many existing categories and long immutable range IDs',
      legacyRanges: Array.from({ length: 51 }, (_, index) => ({
        id: `${'legacy-category-'.repeat(20)}${index}`,
        label: `Категория ${index + 1}`,
        emoji: '🙂',
        minMinutes: index,
        maxMinutes: index === 50 ? null : index,
      })),
    },
    {
      scenario: 'configuration boundaries beyond the maximum daily duration',
      legacyRanges: [
        { ...rangeFixture[0]!, maxMinutes: 1800 },
        { ...rangeFixture[1]!, minMinutes: 1801 },
      ],
    },
  ])('can rename an imported habit with $scenario', async ({ legacyRanges }) => {
    const history = await seedHistory()
    const gaming = await getHabit('gaming')
    if (gaming.type !== 'duration') throw new Error('Expected duration fixture')
    await database.habits.put({ ...gaming, ratingRanges: legacyRanges })
    const backups = new BackupService(database)
    const snapshot = parseBackupJson(JSON.stringify(await backups.exportBackup()))
    await database.habits.put({ ...gaming, ratingRanges: rangeFixture })
    await backups.importBackup(snapshot)

    const restored = await getHabit('gaming')
    if (restored.type !== 'duration') throw new Error('Expected duration fixture')
    await service.updateHabit(restored.id, {
      type: restored.type, name: 'Мои игры', description: restored.description, ratingRanges: restored.ratingRanges,
    })

    expect(await getHabit('gaming')).toEqual({ ...restored, name: 'Мои игры' })
    expect(await database.habitEntries.toArray()).toEqual(history)
    expect((await backups.exportBackup()).data.habits.find((habit) => habit.id === 'gaming'))
      .toEqual({ ...restored, name: 'Мои игры' })
  })

  it('archives each supported daily tracker, preserves history and restores it with the same IDs', async () => {
    const history = await seedHistory()
    for (const id of ['english', 'water', 'gaming', 'social-media']) await service.setHabitArchived(id, true)
    expect((await results.getTodayHabits(past)).some(({ habit }) => habit.id === 'english')).toBe(false)
    expect(await results.getTodayAmountHabits(past)).toEqual([])
    expect(await durations.getTodayDurationHabits(past)).toEqual([])
    expect(await database.habitEntries.toArray()).toEqual(history)
    expect(await database.habits.count()).toBe(11)
    for (const id of ['english', 'water', 'gaming', 'social-media']) await service.setHabitArchived(id, false)
    expect((await results.getTodayHabits(past)).find(({ habit }) => habit.id === 'english')?.status).toBe('success')
    expect((await results.getTodayAmountHabits(past))[0]?.value).toBe(2200)
    expect((await durations.getTodayDurationHabits(past)).map((item) => item.minutes)).toEqual([90, 0])
    expect(await database.habitEntries.toArray()).toEqual(history)
  })

  it('keeps archived facts and notes available to calendar history and period statistics', async () => {
    const history = await seedHistory()
    for (const id of ['english', 'water', 'gaming']) await service.setHabitArchived(id, true)
    const calendar = await new CalendarService(database).getMonth(past)
    expect(calendar.entries).toEqual(expect.arrayContaining(history))
    const notes = new HabitNoteService(database)
    expect((await notes.getDayNotes(past)).map((row) => row.habit.id)).toEqual(['social-media'])
    const archived = (await notes.getDayNotes(past, true)).filter(({ habit }) => habit.archivedAt !== null)
    expect(archived.map((row) => row.habit.id)).toEqual(['english', 'water', 'gaming'])
    expect(archived.map((row) => row.entry.note)).toEqual(['Урок\nи повторение', 'После прогулки', 'С друзьями'])
    await expect(notes.setHabitEntryNote('english', past, 'Изменение')).rejects.toThrow('в архиве')
    const statistics = await new StatisticsService(database).getStatistics(getStatisticsPeriod('month', getLocalDate()), new Date())
    expect(statistics.booleans.find((item) => item.habit.id === 'english')).toMatchObject({ successCount: 1 })
    expect(statistics.amounts.find((item) => item.habit.id === 'water')).toMatchObject({ total: 6600 })
    expect(statistics.durations.find((item) => item.habit.id === 'gaming')).toMatchObject({ totalMinutes: 90 })
    expect(await database.habitEntries.toArray()).toEqual(history)
  })

  it('treats repeated archive and restore operations as no-ops', async () => {
    await service.setHabitArchived('english', true)
    const archived = await getHabit('english')
    vi.setSystemTime(new Date(2026, 9, 21, 12))
    await service.setHabitArchived('english', true)
    expect(await getHabit('english')).toEqual(archived)
    await service.setHabitArchived('english', false)
    const restored = await getHabit('english')
    vi.setSystemTime(new Date(2026, 9, 22, 12))
    await service.setHabitArchived('english', false)
    expect(await getHabit('english')).toEqual(restored)
    expect(restored.archivedAt).toBeNull()
  })

  it('preserves concurrent archival, existing order, units and identity when an old form is submitted', async () => {
    const previous = await getHabit('water')
    const staleInput = { ...amountInput, id: 'replacement', order: -1, unit: 'litres', archivedAt: null, createdAt: timestamp }
    await database.habits.update('water', { order: 90 })
    const secondConnection = new TaskTrackerDatabase(database.name)
    try {
      await secondConnection.open()
      const secondService = new HabitSettingsService(secondConnection)
      await Promise.all([secondService.setHabitArchived('water', true), service.updateHabit('water', staleInput)])
      expect(await getHabit('water')).toMatchObject({
        id: previous.id, type: 'amount', order: 90, unit: 'ml', createdAt: previous.createdAt,
        archivedAt: new Date().toISOString(), target: 2500,
      })
    } finally {
      secondConnection.close()
    }
  })

  it('preserves concurrent edits when restoring an archived habit', async () => {
    await service.setHabitArchived('english', true)
    await Promise.all([service.updateHabit('english', booleanInput), service.setHabitArchived('english', false)])
    expect(await getHabit('english')).toMatchObject({ name: booleanInput.name, description: booleanInput.description, archivedAt: null })
  })

  it('does not resurrect deleted records or change a habit type from a stale form', async () => {
    const original = await getHabit('english')
    await expect(service.updateHabit('english', amountInput)).rejects.toThrow('Тип привычки нельзя изменить')
    expect(await getHabit('english')).toEqual(original)
    await database.habits.delete('english')
    await expect(service.updateHabit('english', booleanInput)).rejects.toThrow('не найдена')
    await expect(service.setHabitArchived('english', true)).rejects.toThrow('не найдена')
    expect(await database.habits.get('english')).toBeUndefined()
  })

  it('survives reopening with edits and archival preserved', async () => {
    await service.updateHabit('water', amountInput)
    await service.setHabitArchived('water', true)
    const expected = await getHabit('water')
    const name = database.name
    database.close()
    database = new TaskTrackerDatabase(name)
    await database.open()
    expect(await database.habits.get('water')).toEqual(expected)
  })

  it('leaves both the definition and history unchanged when storage rejects a write', async () => {
    const history = await seedHistory()
    const previous = await getHabit('water')
    vi.spyOn(database.habits, 'put').mockRejectedValueOnce(new Error('Storage unavailable'))
    await expect(service.updateHabit('water', amountInput)).rejects.toThrow('Storage unavailable')
    expect(await getHabit('water')).toEqual(previous)
    expect(await database.habitEntries.toArray()).toEqual(history)
  })

  it('accepts text limits after trimming', async () => {
    await service.updateHabit('english', {
      ...booleanInput, name: ` ${'я'.repeat(MAX_HABIT_NAME_LENGTH)} `,
      description: ` ${'я'.repeat(MAX_HABIT_DESCRIPTION_LENGTH)} `,
    })
    expect((await getHabit('english')).name).toHaveLength(MAX_HABIT_NAME_LENGTH)
    expect((await getHabit('english')).description).toHaveLength(MAX_HABIT_DESCRIPTION_LENGTH)
  })

  it.each([
    null, undefined, [], {}, { ...booleanInput, name: '' }, { ...booleanInput, name: '  ' },
    { ...booleanInput, name: 42 }, { ...booleanInput, name: 'x'.repeat(MAX_HABIT_NAME_LENGTH + 1) },
    { ...booleanInput, description: null }, { ...booleanInput, description: 'x'.repeat(MAX_HABIT_DESCRIPTION_LENGTH + 1) },
    { ...booleanInput, type: 'unknown' },
  ])('rejects malformed runtime settings without changing data: %j', async (input) => {
    const previous = await getHabit('english')
    await expect(service.updateHabit('english', input as HabitSettingsInput)).rejects.toThrow()
    expect(await getHabit('english')).toEqual(previous)
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2500', null, undefined])(
    'rejects invalid amount target %s without changing history', async (target) => {
      const history = await seedHistory()
      const previous = await getHabit('water')
      await expect(service.updateHabit('water', { ...amountInput, target } as HabitSettingsInput)).rejects.toThrow('Дневная цель')
      expect(await getHabit('water')).toEqual(previous)
      expect(await database.habitEntries.toArray()).toEqual(history)
    },
  )

  it.each([1, Number.MAX_SAFE_INTEGER])('accepts safe positive target boundary %s', async (target) => {
    await service.updateHabit('water', { ...amountInput, target })
    expect(await getHabit('water')).toMatchObject({ target })
  })

  it.each([
    [], null, undefined, [null], [{ ...rangeFixture[0], maxMinutes: null }, rangeFixture[1]],
    [{ ...rangeFixture[0], minMinutes: -1 }, rangeFixture[1]],
    [{ ...rangeFixture[0], maxMinutes: NaN }, rangeFixture[1]],
    [rangeFixture[0], { ...rangeFixture[1], minMinutes: NaN }],
    [{ ...rangeFixture[0], maxMinutes: -1 }, rangeFixture[1]],
    [{ ...rangeFixture[0], maxMinutes: 60.5 }, rangeFixture[1]],
    [{ ...rangeFixture[0], maxMinutes: '' }, rangeFixture[1]],
    [rangeFixture[0], { ...rangeFixture[1], minMinutes: 60 }],
    [rangeFixture[0], { ...rangeFixture[1], minMinutes: 62 }],
    [rangeFixture[0], { ...rangeFixture[1], maxMinutes: 100 }],
    [...rangeFixture].reverse(),
    [rangeFixture[0], { ...rangeFixture[1], id: 'short' }],
    [{ ...rangeFixture[0], label: '' }, rangeFixture[1]],
    [{ ...rangeFixture[0], emoji: ' ' }, rangeFixture[1]],
    [{ ...rangeFixture[0], label: 'x'.repeat(MAX_RATING_LABEL_LENGTH + 1) }, rangeFixture[1]],
    [{ ...rangeFixture[0], emoji: 'x'.repeat(MAX_RATING_EMOJI_LENGTH + 1) }, rangeFixture[1]],
    [{ ...rangeFixture[0], maxMinutes: Number.MAX_SAFE_INTEGER }, { ...rangeFixture[1], minMinutes: Number.MAX_SAFE_INTEGER + 1 }],
  ].map((ranges) => ({ ranges })))('rejects invalid ranges without a partial update: $ranges', async ({ ranges }) => {
    const history = await seedHistory()
    const previous = await getHabit('gaming')
    await expect(service.updateHabit('gaming', { ...durationInput, ratingRanges: ranges } as HabitSettingsInput)).rejects.toThrow()
    expect(await getHabit('gaming')).toEqual(previous)
    expect(await database.habitEntries.toArray()).toEqual(history)
  })

  it('rejects invalid archive flags and IDs at runtime', async () => {
    const previous = await getHabit('english')
    await expect(service.setHabitArchived('english', 'true' as unknown as boolean)).rejects.toThrow('нужно ли архивировать')
    for (const id of ['', ' ', null, undefined]) {
      await expect(service.setHabitArchived(id as string, true)).rejects.toThrow('идентификатор')
      await expect(service.updateHabit(id as string, booleanInput)).rejects.toThrow('идентификатор')
    }
    expect(await getHabit('english')).toEqual(previous)
  })
})
