import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { createInitialHabits } from '../db/seed'
import { getLocalDate } from '../lib/local-date'
import { BACKUP_FORMAT_VERSION, type BackupData, type BackupSnapshot } from '../models/backup'
import type { Goal } from '../models/goal'
import type { Task } from '../models/task'
import { BackupService, getBackupFilename, parseBackupJson } from './backup-service'

const createdAt = '2026-09-01T07:05:00.000Z'
const updatedAt = '2026-10-19T21:20:00.000Z'
const day = getLocalDate(new Date(2026, 9, 19))
const previousDay = getLocalDate(new Date(2026, 9, 18))
const times = { createdAt, updatedAt }

function emptyBackup(): BackupSnapshot {
  return {
    app: 'zadachnik', formatVersion: BACKUP_FORMAT_VERSION, exportedAt: updatedAt,
    data: { habits: [], habitEntries: [], tasks: [], goals: [], goalMilestones: [] },
  }
}

function fullBackup(): BackupSnapshot {
  const habits = createInitialHabits(createdAt)
  const water = habits.find((habit) => habit.id === 'water')
  const gaming = habits.find((habit) => habit.id === 'gaming')
  if (!water || water.type !== 'amount' || !gaming || gaming.type !== 'duration') throw new Error('Invalid fixture')
  water.name = 'Моя вода'
  water.target = 2500
  gaming.archivedAt = updatedAt
  gaming.ratingRanges = [
    { id: 'short', label: 'Немного', emoji: '🙂', minMinutes: 0, maxMinutes: 90 },
    { id: 'long', label: 'Много', emoji: '🙁', minMinutes: 91, maxMinutes: null },
  ]
  habits.push({ id: 'rating', category: 'study_work', type: 'rating', name: 'Моя оценка', description: '', order: 18, archivedAt: null, ...times })
  const baseGoal: Goal = {
    id: 'goal', title: 'Найти работу', description: 'Первая строка\nВторая строка',
    deadline: getLocalDate(new Date(2026, 11, 31)), status: 'active', progressMode: 'auto',
    manualProgress: 0, archived: false, ...times,
  }
  const baseTask: Task = {
    id: 'task', title: 'Отправить резюме', description: 'Моё описание',
    date: day, time: '23:59', priority: 'high', status: 'active', completedAt: null, ...times,
  }
  return {
    ...emptyBackup(),
    data: {
      habits,
      habitEntries: [
        { habitId: 'english', date: day, type: 'boolean', status: 'success', note: '  Сохранять текст\nбез нормализации  ', ...times },
        { habitId: 'english', date: previousDay, type: 'boolean', status: 'no-data', note: '', ...times },
        { habitId: 'reading', date: day, type: 'boolean', status: 'failure', ...times },
        { habitId: 'water', date: day, type: 'amount', value: 2700, note: 'Перевыполнение', ...times },
        { habitId: 'water', date: previousDay, type: 'amount', value: 0, ...times },
        { habitId: 'gaming', date: day, type: 'duration', minutes: 361, ...times },
        { habitId: 'social-media', date: day, type: 'duration', minutes: 0, ...times },
        { habitId: 'rating', date: day, type: 'rating', value: -0.5, ...times },
      ],
      tasks: [
        { ...baseTask, goalId: 'goal' },
        { ...baseTask, id: 'legacy-completed', status: 'completed', time: null, priority: 'low' },
        { ...baseTask, id: 'completed', status: 'completed', completedAt: updatedAt, goalId: 'manual' },
        { ...baseTask, id: 'failed', status: 'failed', goalId: null, priority: 'medium' },
        { ...baseTask, id: 'cancelled', status: 'cancelled' },
      ],
      goals: [
        baseGoal,
        { ...baseGoal, id: 'manual', progressMode: 'manual', manualProgress: 45.5, deadline: null, status: 'completed', archived: true },
      ],
      goalMilestones: [
        { id: 'step-1', goalId: 'goal', title: 'Резюме', order: 0, type: 'boolean', completed: true, ...times },
        { id: 'step-2', goalId: 'goal', title: 'Отклики', order: 1, type: 'amount', current: 30.5, target: 30, ...times },
        { id: 'step-3', goalId: 'manual', title: 'Подготовка', order: 0, type: 'boolean', completed: false, ...times },
        { id: 'step-4', goalId: 'manual', title: 'Встречи', order: 1, type: 'amount', current: 0, target: 0.5, ...times },
      ],
    },
  }
}

function changeRow(table: keyof BackupData, index: number, field: string, value: unknown): unknown {
  const snapshot = fullBackup()
  return {
    ...snapshot,
    data: { ...snapshot.data, [table]: snapshot.data[table].map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row) },
  }
}

function versionOneBackup() {
  const snapshot = fullBackup()
  const habits = snapshot.data.habits.filter((habit) => habit.order < 11 || habit.id === 'rating').map((habit) => {
    const legacy: Record<string, unknown> = { ...habit }
    delete legacy.category
    delete legacy.quickActions
    delete legacy.manualMode
    return legacy
  })
  return { ...snapshot, formatVersion: 1, data: { ...snapshot.data, habits } }
}

describe('backup runtime validation', () => {
  it('parses all supported entities without changing fields, ranges, dates or optional values', () => {
    const fixture = fullBackup()
    expect(parseBackupJson(JSON.stringify(fixture))).toStrictEqual(fixture)
  })

  it('accepts an empty snapshot and arbitrary JSON property order', () => {
    const backup = emptyBackup()
    const unordered = { data: { tasks: [], goals: [], habits: [], goalMilestones: [], habitEntries: [] }, exportedAt: backup.exportedAt, formatVersion: 1, app: 'zadachnik' }
    expect(parseBackupJson(JSON.stringify(unordered))).toStrictEqual(backup)
  })

  it('explicitly converts version 1 metadata while preserving all original fields and rows', () => {
    const legacy = versionOneBackup()
    const converted = parseBackupJson(JSON.stringify(legacy))
    expect(converted.formatVersion).toBe(3)
    expect(converted.exportedAt).toBe(legacy.exportedAt)
    expect(converted.data.habits).toHaveLength(12)
    expect(converted.data.habits.map((habit) => habit.id)).toEqual(legacy.data.habits.map((habit) => habit.id))
    expect(converted.data).toMatchObject({ ...legacy.data, habits: legacy.data.habits })
    expect(converted.data.habits.find((habit) => habit.id === 'water')).toMatchObject({
      category: 'food_water', quickActions: [200, 400], manualMode: 'add', target: 2500, name: 'Моя вода',
    })
    expect(converted.data.habits.find((habit) => habit.id === 'rating')).toEqual({
      ...legacy.data.habits.find((habit) => habit.id === 'rating'), category: 'self_development',
    })
    expect(parseBackupJson(JSON.stringify(converted))).toStrictEqual(converted)
  })

  it('keeps custom amount ids and their old manual-add behavior during version 1 conversion', () => {
    const legacy = versionOneBackup()
    const water = legacy.data.habits.find((habit) => habit.id === 'water')
    if (!water) throw new Error('Invalid fixture')
    legacy.data.habits = [{ ...water, id: 'custom-count', name: 'Свой счётчик', target: 53, unit: 'items' }]
    legacy.data.habitEntries = []
    expect(parseBackupJson(JSON.stringify(legacy)).data.habits).toEqual([{
      ...legacy.data.habits[0], category: 'self_development', quickActions: [200, 400], manualMode: 'add',
    }])
  })

  it('rejects new metadata inside a version 1 backup instead of silently dropping it', () => {
    const legacy = versionOneBackup()
    legacy.data.habits[0] = { ...legacy.data.habits[0], category: 'training' }
    expect(() => parseBackupJson(JSON.stringify(legacy))).toThrow('неподдерживаемое поле')
  })

  it('round-trips custom amount controls, including no quick buttons, without changing saved totals', () => {
    const fixture = fullBackup()
    const water = fixture.data.habits.find((habit) => habit.id === 'water')
    if (!water || water.type !== 'amount') throw new Error('Invalid fixture')
    water.category = 'study_work'
    water.manualMode = 'total'
    water.quickActions = []
    expect(parseBackupJson(JSON.stringify(fixture))).toStrictEqual(fixture)
  })

  it('round-trips weekly and selected-day schedules with their canonical entries', () => {
    const fixture = fullBackup()
    fixture.data.habits[0]!.schedule = { type: 'weekdays', days: [1, 3, 5] }
    fixture.data.habits[1]!.schedule = { type: 'weekly', weekday: 7 }
    fixture.data.habits[2]!.schedule = { type: 'daily' }
    fixture.data.habitEntries[1]!.date = getLocalDate(new Date(2026, 9, 12))
    fixture.data.habitEntries.push({ habitId: 'cleaning', date: day, type: 'boolean', status: 'success', ...times })
    const converted = parseBackupJson(JSON.stringify(fixture))
    expect(converted).toStrictEqual(fixture)
    expect(converted.data.habits.find((habit) => habit.id === 'cleaning')?.schedule).toEqual({ type: 'weekly' })
    expect(converted.data.habits[0]!.schedule).not.toBe(fixture.data.habits[0]!.schedule)
  })

  it('rejects a weekly result under a daily key instead of importing an invisible or duplicate weekly occurrence', () => {
    const fixture = fullBackup()
    fixture.data.habitEntries.push({ habitId: 'cleaning', date: previousDay, type: 'boolean', status: 'success', ...times })
    const original = structuredClone(fixture)
    expect(() => parseBackupJson(JSON.stringify(fixture))).toThrow('дату понедельника')
    expect(fixture).toStrictEqual(original)
    fixture.data.habitEntries.push({ habitId: 'cleaning', date: getLocalDate(new Date(2026, 9, 12)), type: 'boolean', status: 'failure', ...times })
    expect(() => parseBackupJson(JSON.stringify(fixture))).toThrow('дату понедельника')
  })

  it('imports v2 daily definitions without adding supplementary habits or interpreting their IDs as schedules', () => {
    const fixture = fullBackup()
    const habits = fixture.data.habits.filter((habit) => habit.order < 18)
    const converted = parseBackupJson(JSON.stringify({ ...fixture, formatVersion: 2, data: { ...fixture.data, habits, habitEntries: [] } }))
    expect(converted.data.habits).toStrictEqual(habits)
    expect(converted.data.habits).toHaveLength(18)
    expect(converted.data.habits.every((habit) => habit.schedule === undefined)).toBe(true)
    expect(converted.formatVersion).toBe(3)
  })

  it.each([
    null, [], 'weekly', {}, { type: 'unknown' }, { type: 'daily', weekday: 1 },
    { type: 'weekly', weekday: 0 }, { type: 'weekly', weekday: 8 }, { type: 'weekly', weekday: 2.5 },
    { type: 'weekly', weekday: '1' }, { type: 'weekly', days: [1] },
    { type: 'weekdays' }, { type: 'weekdays', days: [] }, { type: 'weekdays', days: [1, 1] },
    { type: 'weekdays', days: [0, 7] }, { type: 'weekdays', days: [1, 8] }, { type: 'weekdays', days: [1.5] },
    { type: 'weekdays', days: [1], weekday: 1 },
  ])('rejects invalid schedule %j before writing', (schedule) => {
    expect(() => parseBackupJson(JSON.stringify(changeRow('habits', 0, 'schedule', schedule)))).toThrow('schedule')
  })

  it('rejects schedule metadata in old formats rather than dropping it', () => {
    const fixture = fullBackup()
    expect(() => parseBackupJson(JSON.stringify({ ...fixture, formatVersion: 2 }))).toThrow('schedule')
  })

  it.each(['', '{', 'not json', '{"app":'])('rejects invalid JSON %j', (value) => {
    expect(() => parseBackupJson(value)).toThrow('JSON')
  })

  it.each([null, [], false, 1, 'backup'])('rejects a non-object snapshot %j', (value) => {
    expect(() => parseBackupJson(JSON.stringify(value))).toThrow('объект')
  })

  it.each([
    ['app', 'another-app'], ['app', undefined],
    ['formatVersion', undefined], ['formatVersion', '1'], ['formatVersion', 0], ['formatVersion', -1], ['formatVersion', 1.5],
    ['exportedAt', undefined], ['exportedAt', 'yesterday'], ['exportedAt', '2026-10-20'],
    ['exportedAt', '2026-02-30T10:00:00.000Z'], ['exportedAt', '2026-10-20T24:00:00.000Z'],
    ['exportedAt', '2026-10-20T10:00:00.000'], ['data', undefined], ['data', []], ['data', null],
    ['futureMetadata', true],
  ])('rejects invalid metadata %s=%j', (field, value) => {
    expect(() => parseBackupJson(JSON.stringify({ ...emptyBackup(), [field]: value }))).toThrow('Некорректная резервная копия')
  })

  it('explains newer backup versions without attempting to guess their structure', () => {
    expect(() => parseBackupJson(JSON.stringify({ app: 'zadachnik', formatVersion: 4, exportedAt: updatedAt, data: {} })))
      .toThrow('создана более новой версией приложения')
  })

  it.each(['habits', 'habitEntries', 'tasks', 'goals', 'goalMilestones'] as const)('requires the %s table', (table) => {
    const fixture = emptyBackup()
    expect(() => parseBackupJson(JSON.stringify({ ...fixture, data: { ...fixture.data, [table]: undefined } }))).toThrow(table)
    expect(() => parseBackupJson(JSON.stringify({ ...fixture, data: { ...fixture.data, [table]: {} } }))).toThrow(table)
  })

  it.each([
    ['habits', 0, 'id', ''], ['habits', 0, 'name', ' '], ['habits', 0, 'description', 1],
    ['habits', 0, 'type', 'unknown'], ['habits', 0, 'order', -1], ['habits', 0, 'order', 0.5],
    ['habits', 0, 'createdAt', undefined], ['habits', 0, 'updatedAt', '2026-10-19'],
    ['habits', 0, 'archivedAt', false], ['habits', 0, 'target', 2000],
    ['habits', 0, 'category', undefined], ['habits', 0, 'category', 'Еда и вода'], ['habits', 0, 'category', 'unknown'],
    ['habits', 0, 'manualMode', 'total'], ['habits', 0, 'quickActions', [10]],
    ['habits', 8, 'target', 0], ['habits', 8, 'target', -1], ['habits', 8, 'target', 1.5], ['habits', 8, 'target', Number.MAX_SAFE_INTEGER + 1],
    ['habits', 8, 'quickActions', undefined], ['habits', 8, 'quickActions', 200], ['habits', 8, 'quickActions', [0]],
    ['habits', 8, 'quickActions', [-1]], ['habits', 8, 'quickActions', [0.5]], ['habits', 8, 'quickActions', [200, 200]],
    ['habits', 8, 'quickActions', [Number.MAX_SAFE_INTEGER + 1]], ['habits', 8, 'manualMode', undefined], ['habits', 8, 'manualMode', 'replace'],
    ['habits', 8, 'unit', ''], ['habits', 9, 'unit', 'hours'],
    ['habitEntries', 0, 'habitId', 'missing'], ['habitEntries', 0, 'date', '2026-02-30'],
    ['habitEntries', 0, 'date', '2026-10-19T00:00:00.000Z'], ['habitEntries', 0, 'status', 'maybe'],
    ['habitEntries', 0, 'note', null], ['habitEntries', 0, 'note', 'x'.repeat(2001)],
    ['habitEntries', 0, 'minutes', 10],
    ['habitEntries', 3, 'value', -1], ['habitEntries', 3, 'value', 1.5], ['habitEntries', 3, 'value', Number.MAX_SAFE_INTEGER + 1],
    ['habitEntries', 5, 'minutes', -1], ['habitEntries', 5, 'minutes', 1441], ['habitEntries', 5, 'minutes', 0.1],
    ['habitEntries', 7, 'value', '1'],
    ['tasks', 0, 'id', null], ['tasks', 0, 'title', 'x'.repeat(201)], ['tasks', 0, 'description', 'x'.repeat(5001)],
    ['tasks', 0, 'date', '2026-02-29'], ['tasks', 0, 'time', '24:00'], ['tasks', 0, 'time', ''],
    ['tasks', 0, 'priority', 'urgent'], ['tasks', 0, 'status', 'overdue'], ['tasks', 0, 'completedAt', updatedAt],
    ['tasks', 0, 'goalId', 'missing'], ['tasks', 0, 'goalId', ''], ['tasks', 0, 'completedAt', undefined],
    ['goals', 0, 'title', ''], ['goals', 0, 'description', false], ['goals', 0, 'deadline', '2026-13-01'],
    ['goals', 0, 'status', 'overdue'], ['goals', 0, 'progressMode', 'estimated'],
    ['goals', 0, 'manualProgress', -1], ['goals', 0, 'manualProgress', 101], ['goals', 0, 'archived', 0],
    ['goalMilestones', 0, 'id', ' '], ['goalMilestones', 0, 'goalId', 'missing'],
    ['goalMilestones', 0, 'title', 'x'.repeat(201)], ['goalMilestones', 0, 'order', -1],
    ['goalMilestones', 0, 'type', 'duration'], ['goalMilestones', 0, 'completed', 'yes'],
    ['goalMilestones', 0, 'current', 1], ['goalMilestones', 1, 'current', -1],
    ['goalMilestones', 1, 'current', Number.MAX_SAFE_INTEGER + 1], ['goalMilestones', 1, 'target', 0],
  ] satisfies [keyof BackupData, number, string, unknown][])('rejects corrupt %s[%s].%s', (table, index, field, value) => {
    expect(() => parseBackupJson(JSON.stringify(changeRow(table, index, field, value)))).toThrow()
  })

  it('rejects an entry whose valid union type differs from its habit type', () => {
    const fixture = fullBackup()
    fixture.data.habitEntries = [{ habitId: 'water', type: 'duration', minutes: 30, date: day, ...times }]
    expect(() => parseBackupJson(JSON.stringify(fixture))).toThrow('тип записи не соответствует привычке')
  })

  it.each([
    [],
    [{ id: 'x', label: 'X', emoji: '🙂', minMinutes: 1, maxMinutes: null }],
    [{ id: 'x', label: 'X', emoji: '🙂', minMinutes: 0, maxMinutes: 20 }],
    [{ id: 'x', label: 'X', emoji: '🙂', minMinutes: 0, maxMinutes: 20 }, { id: 'y', label: 'Y', emoji: '🙁', minMinutes: 20, maxMinutes: null }],
    [{ id: 'x', label: 'X', emoji: '🙂', minMinutes: 0, maxMinutes: 20 }, { id: 'y', label: 'Y', emoji: '🙁', minMinutes: 22, maxMinutes: null }],
    [{ id: 'x', label: 'X', emoji: '🙂', minMinutes: 0, maxMinutes: 20 }, { id: 'x', label: 'Y', emoji: '🙁', minMinutes: 21, maxMinutes: null }],
    [{ id: 'x', label: 'X', emoji: '🙂', minMinutes: 0, maxMinutes: null }, { id: 'y', label: 'Y', emoji: '🙁', minMinutes: 0, maxMinutes: null }],
    [{ id: 'x', label: '', emoji: '🙂', minMinutes: 0, maxMinutes: null }],
    [{ id: 'x', label: 'X', emoji: '', minMinutes: 0, maxMinutes: null }],
  ].map((ranges) => ({ ranges })))('rejects invalid rating ranges %#', ({ ranges }) => {
    expect(() => parseBackupJson(JSON.stringify(changeRow('habits', 9, 'ratingRanges', ranges)))).toThrow('ratingRanges')
  })

  it.each(['habits', 'habitEntries', 'tasks', 'goals', 'goalMilestones'] as const)('rejects duplicate primary keys in %s', (table) => {
    const fixture = fullBackup()
    const duplicate = { ...fixture, data: { ...fixture.data, [table]: [...fixture.data[table], fixture.data[table][0]] } }
    expect(() => parseBackupJson(JSON.stringify(duplicate))).toThrow('повторяющийся идентификатор')
  })

  it('preserves valid timezone offsets, leap days and numeric boundary values', () => {
    const fixture = fullBackup()
    fixture.exportedAt = '2024-02-29T23:59:59+03:00'
    fixture.data.habitEntries = [
      { habitId: 'water', type: 'amount', value: Number.MAX_SAFE_INTEGER, date: day, ...times },
      { habitId: 'gaming', type: 'duration', minutes: 1440, date: day, ...times },
    ]
    expect(parseBackupJson(JSON.stringify(fixture))).toStrictEqual(fixture)
  })

  it('does not collide on delimiter-like characters in composite keys', () => {
    const fixture = fullBackup()
    const first = fixture.data.habits[0]
    if (!first) throw new Error('Invalid fixture')
    const id = 'a|b:"2026-10-19"'
    fixture.data.habits.push({ ...first, id })
    fixture.data.habitEntries.push({ habitId: id, type: 'boolean', status: 'success', date: day, ...times })
    expect(parseBackupJson(JSON.stringify(fixture))).toStrictEqual(fixture)
  })
})

describe('backup export and atomic replacement', () => {
  let database: TaskTrackerDatabase
  let service: BackupService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T00:30:00+03:00'))
    database = new TaskTrackerDatabase(`zadachnik-backup-test-${crypto.randomUUID()}`)
    service = new BackupService(database)
    await database.open()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await database.delete()
    vi.useRealTimers()
  })

  async function readData(): Promise<BackupData> {
    return {
      habits: await database.habits.toArray(),
      habitEntries: await database.habitEntries.toArray(),
      tasks: await database.tasks.toArray(),
      goals: await database.goals.toArray(),
      goalMilestones: await database.goalMilestones.toArray(),
    }
  }

  async function fillDatabase(data = fullBackup().data): Promise<void> {
    await database.transaction('rw', database.tables, async () => {
      await Promise.all(database.tables.map((table) => table.clear()))
      await database.habits.bulkAdd(data.habits)
      await database.habitEntries.bulkAdd(data.habitEntries)
      await database.tasks.bulkAdd(data.tasks)
      await database.goals.bulkAdd(data.goals)
      await database.goalMilestones.bulkAdd(data.goalMilestones)
    })
  }

  it('exports a new seeded database with every table, ISO metadata and a separate format version', async () => {
    const snapshot = await service.exportBackup()
    expect(snapshot).toMatchObject({
      app: 'zadachnik', formatVersion: 3, exportedAt: '2026-10-19T21:30:00.000Z',
      data: { habitEntries: [], tasks: [], goals: [], goalMilestones: [] },
    })
    expect(snapshot.data.habits).toHaveLength(23)
    expect(snapshot.data).toStrictEqual(await readData())
    expect(database.verno).toBe(6)
  })

  it('exports a genuinely empty database without adding seed data', async () => {
    await fillDatabase(emptyBackup().data)
    expect((await service.exportBackup()).data).toStrictEqual(emptyBackup().data)
  })

  it('takes all five export reads inside the same readonly transaction', async () => {
    const transactions: unknown[] = []
    for (const table of [database.habits, database.habitEntries, database.tasks, database.goals, database.goalMilestones]) {
      const original = table.toArray.bind(table)
      vi.spyOn(table, 'toArray').mockImplementation(() => {
        const transaction = Dexie.currentTransaction
        expect(transaction?.mode).toBe('readonly')
        expect(transaction?.storeNames.slice().sort()).toEqual(['goalMilestones', 'goals', 'habitEntries', 'habits', 'tasks'])
        transactions.push(transaction)
        return original()
      })
    }
    await service.exportBackup()
    expect(transactions).toHaveLength(5)
    expect(new Set(transactions).size).toBe(1)
  })

  it('round-trips every row exactly through JSON, replacement and reopening, preserving links and legacy optional fields', async () => {
    await fillDatabase()
    const original = await readData()
    const snapshot = await service.exportBackup()
    expect(snapshot.data).toStrictEqual(original)
    await fillDatabase(emptyBackup().data)
    await database.habits.bulkAdd(createInitialHabits())
    await database.tasks.add({
      id: 'discard-me', title: 'После backup', description: '', date: day, time: null,
      priority: 'low', status: 'active', completedAt: null, ...times,
    })
    await service.importBackup(parseBackupJson(JSON.stringify(snapshot)))
    expect(await readData()).toStrictEqual(original)
    expect(await database.tasks.get('discard-me')).toBeUndefined()
    expect(await database.tasks.get('legacy-completed')).not.toHaveProperty('goalId')
    expect(await database.tasks.get('legacy-completed')).toHaveProperty('completedAt', null)
    expect(await database.tasks.where('goalId').equals('goal').primaryKeys()).toEqual(['task'])
    expect(await database.goalMilestones.where('goalId').equals('goal').count()).toBe(2)
    database.close()
    await database.open()
    expect(await readData()).toStrictEqual(original)
  })

  it('supports repeated imports without duplicates or generated IDs', async () => {
    const snapshot = fullBackup()
    await service.importBackup(snapshot)
    const first = await readData()
    await service.importBackup(snapshot)
    expect(await readData()).toStrictEqual(first)
  })

  it('replaces a populated database with an empty snapshot and does not reseed after reopen', async () => {
    await fillDatabase()
    await service.importBackup(emptyBackup())
    database.close()
    await database.open()
    expect(await readData()).toStrictEqual(emptyBackup().data)
  })

  it('replaces from version 1 without adding missing old habits or the new definitions after reopening', async () => {
    const legacy = versionOneBackup()
    legacy.data.habits = legacy.data.habits.filter((habit) => habit.id !== 'no-chips')
    const converted = parseBackupJson(JSON.stringify(legacy))
    await service.importBackup(legacy)
    const sortByKey = (data: BackupData) => ({
      habits: [...data.habits].sort((a, b) => a.id.localeCompare(b.id)),
      habitEntries: [...data.habitEntries].sort((a, b) => a.habitId.localeCompare(b.habitId) || a.date.localeCompare(b.date)),
      tasks: [...data.tasks].sort((a, b) => a.id.localeCompare(b.id)),
      goals: [...data.goals].sort((a, b) => a.id.localeCompare(b.id)),
      goalMilestones: [...data.goalMilestones].sort((a, b) => a.id.localeCompare(b.id)),
    })
    expect(sortByKey((await service.exportBackup()).data)).toStrictEqual(sortByKey(converted.data))
    database.close()
    await database.open()
    expect(await database.habits.count()).toBe(11)
    expect(await database.habits.get('no-chips')).toBeUndefined()
    expect(await database.habits.get('push-ups')).toBeUndefined()
    expect(sortByKey((await service.exportBackup()).data)).toStrictEqual(sortByKey(converted.data))
  })

  it('imports an empty version 1 backup as an empty database across reopen', async () => {
    await service.importBackup({ ...emptyBackup(), formatVersion: 1 })
    database.close()
    await database.open()
    expect(await readData()).toStrictEqual(emptyBackup().data)
  })

  it.each([NaN, Infinity, -Infinity])('rejects non-JSON numeric value %s at the import service boundary before clear', async (value) => {
    const before = await readData()
    const clear = vi.spyOn(database.habits, 'clear')
    await expect(service.importBackup(changeRow('habitEntries', 7, 'value', value))).rejects.toThrow()
    expect(clear).not.toHaveBeenCalled()
    expect(await readData()).toStrictEqual(before)
  })

  it('revalidates a preview that was modified and leaves the whole database unchanged', async () => {
    await fillDatabase()
    const before = await readData()
    const preview = parseBackupJson(JSON.stringify(fullBackup()))
    preview.data.goals.length = 0
    await expect(service.importBackup(preview)).rejects.toThrow('цель не найдена')
    expect(await readData()).toStrictEqual(before)
  })

  it('detaches the validated snapshot before awaiting the transaction', async () => {
    const snapshot = fullBackup()
    const expected = structuredClone(snapshot)
    const pending = service.importBackup(snapshot)
    snapshot.data.habits.length = 0
    snapshot.data.tasks.length = 0
    await pending
    const actual = await service.exportBackup()
    expect(actual.data.habits).toHaveLength(expected.data.habits.length)
    expect(actual.data.tasks).toHaveLength(expected.data.tasks.length)
  })

  it.each(['after clear', 'after partial writes', 'during the last table'] as const)('rolls back all five tables on a failure %s', async (failurePoint) => {
    await fillDatabase()
    const before = await readData()
    const incoming = fullBackup()
    const firstHabit = incoming.data.habits[0]
    if (!firstHabit) throw new Error('Invalid fixture')
    firstHabit.name = 'Данные из другой копии'
    incoming.data.tasks = []
    const failure = new Error('Injected storage failure')
    let writes = 0
    const hook = () => {
      writes += 1
      if (writes === 2) throw failure
    }
    if (failurePoint === 'after clear') {
      vi.spyOn(database.habits, 'bulkAdd').mockRejectedValueOnce(failure)
    } else if (failurePoint === 'after partial writes') {
      vi.spyOn(database.goals, 'bulkAdd').mockRejectedValueOnce(failure)
    } else {
      database.goalMilestones.hook('creating', hook)
    }
    try {
      await expect(service.importBackup(incoming)).rejects.toThrow('Injected storage failure')
    } finally {
      if (failurePoint === 'during the last table') database.goalMilestones.hook('creating').unsubscribe(hook)
    }
    expect(await readData()).toStrictEqual(before)
    database.close()
    await database.open()
    expect(await readData()).toStrictEqual(before)
  })

  it('refuses to export malformed stored data as a seemingly restorable backup', async () => {
    const water = await database.habits.get('water')
    if (!water || water.type !== 'amount') throw new Error('Invalid fixture')
    await database.habits.put({ ...water, target: 0 })
    await expect(service.exportBackup()).rejects.toThrow('target')
  })

  it('uses the local calendar date in the filename even before the UTC day changes', () => {
    expect(getBackupFilename()).toBe('zadachnik-backup-2026-10-20.json')
    expect(getBackupFilename(new Date(2024, 1, 29, 0, 15))).toBe('zadachnik-backup-2024-02-29.json')
    expect(() => getBackupFilename(new Date(NaN))).toThrow('дата')
  })
})
