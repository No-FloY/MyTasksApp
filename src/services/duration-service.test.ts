import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { getInitialDurationRanges } from '../db/duration-defaults'
import { getLocalDate, type LocalDate } from '../lib/local-date'
import type { DurationRatingRange } from '../models/duration-rating'
import {
  DurationService,
  formatDuration,
  getDurationInput,
  getDurationRating,
  parseDurationInput,
  validateRatingRanges,
} from './duration-service'
import { HabitService } from './habit-service'

const today = getLocalDate(new Date(2026, 9, 3))
const tomorrow = getLocalDate(new Date(2026, 9, 4))
const originalTimestamp = '2026-10-01T10:00:00.000Z'
const customRanges: DurationRatingRange[] = [
  { id: 'short', label: 'Короткая сессия', emoji: '🌱', minMinutes: 0, maxMinutes: 30 },
  { id: 'long', label: 'Долгая сессия', emoji: '🌳', minMinutes: 31, maxMinutes: null },
]

describe('duration rating boundaries', () => {
  it.each([
    [0, 'excellent'], [119, 'excellent'], [120, 'excellent'], [121, 'good'],
    [239, 'good'], [240, 'good'], [241, 'neutral'],
    [328, 'neutral'], [329, 'neutral'], [330, 'poor'],
    [359, 'poor'], [360, 'poor'], [361, 'very-poor'], [1440, 'very-poor'],
  ])('rates gaming at %s minutes as %s', (minutes, expected) => {
    const ranges = getInitialDurationRanges('gaming')
    expect(getDurationRating(Number(minutes), ranges).id).toBe(expected)
  })

  it.each([
    [0, 'excellent'], [59, 'excellent'], [60, 'excellent'], [61, 'good'],
    [89, 'good'], [90, 'good'], [91, 'poor'], [1440, 'poor'],
  ])('rates social media at %s minutes as %s', (minutes, expected) => {
    expect(getDurationRating(Number(minutes), getInitialDurationRanges('social-media')).id).toBe(expected)
  })

  it('returns the configured category, text and emoji for arbitrary ranges', () => {
    expect(getDurationRating(30, customRanges)).toEqual(customRanges[0])
    expect(getDurationRating(31, customRanges)).toEqual(customRanges[1])
    expect(getDurationRating(215, customRanges)).toMatchObject({ id: 'long', label: 'Долгая сессия', emoji: '🌳' })
    expect(getDurationRating(0, [{ id: 'all', label: 'Любое время', emoji: '⏱️', minMinutes: 0, maxMinutes: null }]).id).toBe('all')
  })

  it('returns independent defaults, so changing one configuration cannot mutate future seeds', () => {
    const changed = getInitialDurationRanges('gaming')
    const firstRange = changed[0]
    if (!firstRange) throw new Error('Missing default range')
    firstRange.maxMinutes = 60
    firstRange.label = 'Моя оценка'
    expect(getInitialDurationRanges('gaming')[0]).toMatchObject({ maxMinutes: 120, label: 'Отлично' })
  })

  it.each([-1, 1.5, 1441, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects impossible daily duration %s', (minutes) => {
      expect(() => getDurationRating(minutes, customRanges)).toThrow('от 0 до 24 часов')
    },
  )

  const range = (minMinutes: number, maxMinutes: number | null, id = 'first'): DurationRatingRange => ({
    id, label: 'Оценка', emoji: '🙂', minMinutes, maxMinutes,
  })
  const invalidRanges: { name: string; ranges: DurationRatingRange[] }[] = [
    { name: 'empty configuration', ranges: [] },
    { name: 'missing zero', ranges: [range(1, null)] },
    { name: 'gap', ranges: [range(0, 30), range(32, null, 'second')] },
    { name: 'overlap', ranges: [range(0, 30), range(30, null, 'second')] },
    { name: 'duplicate ids', ranges: [range(0, 30), range(31, null)] },
    { name: 'non-final open range', ranges: [range(0, null), range(1, null, 'second')] },
    { name: 'missing final open range', ranges: [range(0, 1440)] },
    { name: 'backward upper bound', ranges: [range(0, -1), range(0, null, 'second')] },
    { name: 'fractional upper bound', ranges: [range(0, 1.5), range(2, null, 'second')] },
    { name: 'infinite upper bound', ranges: [range(0, Infinity), range(1, null, 'second')] },
    { name: 'empty id', ranges: [{ ...range(0, null), id: ' ' }] },
    { name: 'empty label', ranges: [{ ...range(0, null), label: ' ' }] },
    { name: 'empty emoji', ranges: [{ ...range(0, null), emoji: '' }] },
  ]
  it.each(invalidRanges)('rejects $name instead of assigning an ambiguous rating', ({ ranges }) => {
    expect(() => validateRatingRanges(ranges)).toThrow()
    expect(() => getDurationRating(30, ranges)).toThrow()
  })
})

describe('hours and minutes input', () => {
  it.each([
    ['2', '35', 155], ['0', '0', 0], ['0', '', 0], ['', '0', 0],
    ['2', '', 120], ['', '35', 35], [' 2 ', ' 05 ', 125],
    ['23', '59', 1439], ['24', '0', 1440], ['00', '00', 0],
  ])('parses hours %s and minutes %s into %s minutes', (hours, minutes, total) => {
    expect(parseDurationInput(String(hours), String(minutes))).toBe(total)
  })

  it.each([
    ['', ''], [' ', ' '], ['-1', '0'], ['0', '-1'], ['1.5', '0'], ['0', '1.5'],
    ['1e1', '0'], ['0', '1e1'], ['0x10', '0'], ['NaN', '0'], ['0', 'Infinity'],
    ['+1', '0'], ['25', '0'], ['0', '60'], ['24', '1'], ['9007199254740992', '0'],
  ])('rejects invalid hours %s and minutes %s', (hours, minutes) => {
    expect(() => parseDurationInput(hours, minutes)).toThrow()
  })

  it('distinguishes absent input from explicitly recorded zero and restores editable fields', () => {
    expect(getDurationInput(null)).toEqual({ hours: '', minutes: '' })
    expect(getDurationInput(0)).toEqual({ hours: '0', minutes: '0' })
    expect(getDurationInput(155)).toEqual({ hours: '2', minutes: '35' })
    expect(getDurationInput(1440)).toEqual({ hours: '24', minutes: '0' })
    expect(formatDuration(155)).toBe('2 ч 35 мин')
    expect(formatDuration(59.5)).toBe('1 ч 0 мин')
  })
})

describe('duration persistence', () => {
  let database: TaskTrackerDatabase
  let service: DurationService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 4, 12))
    database = new TaskTrackerDatabase(`zadachnik-duration-test-${crypto.randomUUID()}`)
    service = new DurationService(database)
    await database.open()
  })

  afterEach(async () => {
    await database.delete()
    vi.useRealTimers()
  })

  it('rejects a future day without storing any minutes', async () => {
    await expect(service.setHabitDuration('gaming', getLocalDate(new Date(2026, 9, 5)), 0)).rejects.toThrow('Будущий день')
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('preserves additional fields when replacing a past duration', async () => {
    const entry = {
      habitId: 'gaming', date: today, type: 'duration' as const, minutes: 120,
      createdAt: originalTimestamp, updatedAt: originalTimestamp, note: 'Выходной',
    }
    await database.habitEntries.put(entry)
    await service.setHabitDuration('gaming', today, 0)
    expect(await database.habitEntries.get(['gaming', today])).toMatchObject({
      minutes: 0, createdAt: originalTimestamp, note: entry.note,
    })
  })

  it('does not treat a missing record as zero, and stores explicit zero as actual duration', async () => {
    const initial = await service.getTodayDurationHabits(today)
    expect(initial.map((row) => row.habit.id)).toEqual(['gaming', 'social-media'])
    expect(initial.every((row) => row.minutes === null && row.rating === null)).toBe(true)
    expect(await database.habitEntries.count()).toBe(0)
    await service.setHabitDuration('gaming', today, 0)
    expect((await service.getTodayDurationHabits(today))[0]).toMatchObject({
      minutes: 0, rating: { id: 'excellent', emoji: '😄', label: 'Отлично' },
    })
    const entry = await database.habitEntries.get(['gaming', today])
    expect(entry).toMatchObject({ type: 'duration', minutes: 0 })
    expect(entry).not.toHaveProperty('rating')
    expect(entry).not.toHaveProperty('emoji')
    expect(entry).not.toHaveProperty('status')
  })

  it('replaces a saved duration while preserving its creation time and one daily record', async () => {
    await database.habitEntries.put({
      habitId: 'gaming', date: today, type: 'duration', minutes: 215,
      createdAt: originalTimestamp, updatedAt: originalTimestamp,
    })
    await service.setHabitDuration('gaming', today, 35)
    const entry = await database.habitEntries.get(['gaming', today])
    expect(entry).toMatchObject({ minutes: 35, createdAt: originalTimestamp })
    expect(entry?.updatedAt).not.toBe(originalTimestamp)
    expect(await database.habitEntries.count()).toBe(1)
    expect((await service.getTodayDurationHabits(today))[0]).toMatchObject({ minutes: 35, rating: { id: 'excellent' } })
  })

  it('restores duration and computes its rating after reopening IndexedDB', async () => {
    await service.setHabitDuration('gaming', today, parseDurationInput('2', '35'))
    await service.setHabitDuration('social-media', today, 0)
    const name = database.name
    database.close()
    database = new TaskTrackerDatabase(name)
    service = new DurationService(database)
    await database.open()
    const rows = await service.getTodayDurationHabits(today)
    expect(rows[0]).toMatchObject({ minutes: 155, rating: { id: 'good' } })
    expect(rows[1]).toMatchObject({ minutes: 0, rating: { id: 'excellent' } })
    expect(await database.habitEntries.count()).toBe(2)
    expect(await database.habits.count()).toBe(11)
  })

  it('keeps each habit and local date independent', async () => {
    await service.setHabitDuration('gaming', today, 215)
    await service.setHabitDuration('gaming', tomorrow, 0)
    await service.setHabitDuration('social-media', today, 75)
    expect((await service.getTodayDurationHabits(today)).map((row) => row.minutes)).toEqual([215, 75])
    expect((await service.getTodayDurationHabits(tomorrow)).map((row) => row.minutes)).toEqual([0, null])
    expect(await database.habitEntries.count()).toBe(3)
  })

  it('recomputes past ratings using changed configuration without altering actual duration', async () => {
    await service.setHabitDuration('gaming', today, 215)
    const entry = await database.habitEntries.get(['gaming', today])
    expect((await service.getTodayDurationHabits(today))[0]?.rating?.id).toBe('good')
    const habit = await database.habits.get('gaming')
    if (!habit || habit.type !== 'duration') throw new Error('Missing duration seed')
    await database.habits.put({ ...habit, ratingRanges: customRanges })
    expect((await service.getTodayDurationHabits(today))[0]).toMatchObject({
      minutes: 215, rating: { id: 'long', label: 'Долгая сессия', emoji: '🌳' },
    })
    expect(await database.habitEntries.get(['gaming', today])).toEqual(entry)
  })

  it('does not corrupt boolean habits or water entries', async () => {
    const habitService = new HabitService(database)
    await habitService.setBooleanHabitStatus('english', today, 'success')
    await habitService.addHabitAmount('water', today, 2400)
    const before = await database.habitEntries.toArray()
    await service.setHabitDuration('gaming', today, 155)
    await service.setHabitDuration('social-media', today, 75)
    for (const entry of before) {
      expect(await database.habitEntries.get([entry.habitId, entry.date])).toEqual(entry)
    }
    expect((await habitService.getTodayHabits(today))).toHaveLength(8)
    expect((await habitService.getTodayAmountHabits(today))[0]).toMatchObject({ value: 2400, status: 'success' })
  })

  it('keeps archived history but hides its tracker and rejects further updates', async () => {
    await service.setHabitDuration('gaming', today, 155)
    await database.habits.update('gaming', { archivedAt: originalTimestamp })
    expect((await service.getTodayDurationHabits(today)).map((row) => row.habit.id)).toEqual(['social-media'])
    await expect(service.setHabitDuration('gaming', today, 0)).rejects.toThrow('в архиве')
    expect(await database.habitEntries.get(['gaming', today])).toMatchObject({ minutes: 155 })
  })

  it.each(['missing', 'english', 'water'])(
    'rejects missing or incompatible habit %s', async (habitId) => {
      await expect(service.setHabitDuration(habitId, today, 155)).rejects.toThrow('не поддерживает')
      expect(await database.habitEntries.count()).toBe(0)
    },
  )

  it('rejects invalid local calendar dates', async () => {
    const invalid = '2026-02-30' as LocalDate
    await expect(service.getTodayDurationHabits(invalid)).rejects.toThrow('Некорректная календарная дата')
    await expect(service.setHabitDuration('gaming', invalid, 155)).rejects.toThrow('Некорректная календарная дата')
    expect(await database.habitEntries.count()).toBe(0)
  })

  it.each([-1, 1.5, 1441, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid duration %s without changing an existing record', async (minutes) => {
      await service.setHabitDuration('gaming', today, 155)
      const original = await database.habitEntries.get(['gaming', today])
      await expect(service.setHabitDuration('gaming', today, minutes)).rejects.toThrow('от 0 до 24 часов')
      expect(await database.habitEntries.get(['gaming', today])).toEqual(original)
    },
  )

  it('rejects a conflicting entry type without overwriting the entry', async () => {
    await database.habitEntries.put({
      habitId: 'gaming', date: today, type: 'boolean', status: 'success',
      createdAt: originalTimestamp, updatedAt: originalTimestamp,
    })
    const original = await database.habitEntries.get(['gaming', today])
    await expect(service.getTodayDurationHabits(today)).rejects.toThrow('Тип записи')
    await expect(service.setHabitDuration('gaming', today, 155)).rejects.toThrow('Тип записи')
    expect(await database.habitEntries.get(['gaming', today])).toEqual(original)
  })

  it('rejects corrupt stored duration without overwriting it', async () => {
    await database.habitEntries.put({
      habitId: 'gaming', date: today, type: 'duration', minutes: -1,
      createdAt: originalTimestamp, updatedAt: originalTimestamp,
    })
    const original = await database.habitEntries.get(['gaming', today])
    await expect(service.getTodayDurationHabits(today)).rejects.toThrow('от 0 до 24 часов')
    await expect(service.setHabitDuration('gaming', today, 155)).rejects.toThrow('от 0 до 24 часов')
    expect(await database.habitEntries.get(['gaming', today])).toEqual(original)
  })

  it('rejects invalid rating configuration before writing new duration', async () => {
    await service.setHabitDuration('gaming', today, 155)
    const original = await database.habitEntries.get(['gaming', today])
    const habit = await database.habits.get('gaming')
    if (!habit || habit.type !== 'duration') throw new Error('Missing duration seed')
    await database.habits.put({ ...habit, ratingRanges: [] })
    await expect(service.getTodayDurationHabits(today)).rejects.toThrow('Не настроены диапазоны')
    await expect(service.setHabitDuration('gaming', today, 0)).rejects.toThrow('Не настроены диапазоны')
    expect(await database.habitEntries.get(['gaming', today])).toEqual(original)
  })
})
