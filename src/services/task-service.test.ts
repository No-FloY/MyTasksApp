import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { Task, TaskInput } from '../models/task'
import {
  getTaskValidationErrors, groupTasks, isTaskOverdue,
  MAX_TASK_DESCRIPTION_LENGTH, MAX_TASK_TITLE_LENGTH, sortTasks, TaskService,
} from './task-service'

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

const today = date('2026-10-04')
const yesterday = date('2026-10-03')
const tomorrow = date('2026-10-05')
const createdAt = '2026-10-01T10:00:00.000Z'
const input: TaskInput = { title: 'Оплатить интернет', date: today, priority: 'medium' }

function fixture(id: string, fields: Partial<Task> = {}): Task {
  return {
    id, title: id, description: '', date: today, time: null,
    priority: 'medium', status: 'active', createdAt, updatedAt: createdAt, completedAt: null,
    ...fields,
  }
}

describe('TaskService persistence and validation', () => {
  let database: TaskTrackerDatabase
  let service: TaskService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 4, 12))
    database = new TaskTrackerDatabase(`zadachnik-task-test-${crypto.randomUUID()}`)
    service = new TaskService(database)
    await database.open()
  })

  afterEach(async () => {
    await database.delete()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('creates a task with a unique id, defaults and timestamps, without touching habit data', async () => {
    const habits = await database.habits.toArray()
    const first = await service.createTask(input)
    const second = await service.createTask(input)
    expect(first).toEqual({
      id: expect.any(String), ...input, description: '', time: null, status: 'active',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null,
    })
    expect(first.id).not.toBe(second.id)
    expect(await service.getTask(first.id)).toEqual(first)
    expect(await database.habits.toArray()).toEqual(habits)
    expect(await database.habitEntries.count()).toBe(0)
  })

  it('trims the title and description while retaining multiline text and optional time', async () => {
    const task = await service.createTask({
      ...input, title: ' \n Оплатить интернет \t ',
      description: '  Первый шаг\n  Второй шаг  ', time: '18:30', priority: 'high',
    })
    expect(task).toMatchObject({
      title: 'Оплатить интернет', description: 'Первый шаг\n  Второй шаг', time: '18:30', priority: 'high',
    })
  })

  it.each([undefined, null, ''])('normalizes absent time %s to null', async (time) => {
    const draft: TaskInput = { ...input }
    if (time !== undefined) draft.time = time
    expect((await service.createTask(draft)).time).toBeNull()
  })

  it.each(['00:00', '09:05', '23:59'])('accepts valid boundary time %s', async (time) => {
    expect((await service.createTask({ ...input, time })).time).toBe(time)
  })

  it.each([
    ['empty title', { title: '' }, 'title'],
    ['whitespace title', { title: ' \n\t ' }, 'title'],
    ['non-text title', { title: 123 }, 'title'],
    ['long title', { title: 'я'.repeat(MAX_TASK_TITLE_LENGTH + 1) }, 'title'],
    ['non-text description', { description: 123 }, 'description'],
    ['null description', { description: null }, 'description'],
    ['long description', { description: 'я'.repeat(MAX_TASK_DESCRIPTION_LENGTH + 1) }, 'description'],
    ['impossible date', { date: '2026-02-30' }, 'date'],
    ['non-leap day', { date: '2026-02-29' }, 'date'],
    ['timestamp as date', { date: '2026-10-04T00:00:00Z' }, 'date'],
    ['short date', { date: '2026-1-04' }, 'date'],
    ['non-text date', { date: 123 }, 'date'],
    ['24 hour time', { time: '24:00' }, 'time'],
    ['overflow minutes', { time: '18:60' }, 'time'],
    ['short time', { time: '9:30' }, 'time'],
    ['seconds in time', { time: '09:30:00' }, 'time'],
    ['whitespace time', { time: ' 09:30 ' }, 'time'],
    ['non-text time', { time: 930 }, 'time'],
    ['unknown priority', { priority: 'urgent' }, 'priority'],
    ['localized priority', { priority: 'Высокий' }, 'priority'],
    ['missing priority', { priority: undefined }, 'priority'],
  ])('rejects %s at the business boundary without a partial write', async (_name, changes, field) => {
    const invalid = { ...input, ...changes } as TaskInput
    expect(getTaskValidationErrors(invalid)).toHaveProperty(field)
    await expect(service.createTask(invalid)).rejects.toThrow()
    expect(await database.tasks.count()).toBe(0)
  })

  it.each([null, undefined, [], 'task'])('rejects malformed runtime input %s', async (value) => {
    const invalid = value as unknown as TaskInput
    expect(getTaskValidationErrors(invalid)).toHaveProperty('title')
    await expect(service.createTask(invalid)).rejects.toThrow('Введите данные задачи')
    expect(await database.tasks.count()).toBe(0)
  })

  it('accepts title and description limits after trimming and returns all field errors', async () => {
    const title = 'я'.repeat(MAX_TASK_TITLE_LENGTH)
    const description = 'я'.repeat(MAX_TASK_DESCRIPTION_LENGTH)
    const task = await service.createTask({ ...input, title: ` ${title} `, description: ` ${description} ` })
    expect(task).toMatchObject({ title, description })
    expect(getTaskValidationErrors({ title: '', description: `${description}я`, date: '', time: '90:10', priority: 'wrong' } as unknown as TaskInput))
      .toEqual({ title: expect.any(String), description: expect.any(String), date: expect.any(String), time: expect.any(String), priority: expect.any(String) })
  })

  it.each([yesterday, today, tomorrow, date('2028-02-29')])('allows create and edit on calendar date %s', async (day) => {
    const task = await service.createTask({ ...input, date: day })
    expect(task.date).toBe(day)
    expect((await service.updateTask(task.id, { ...input, title: 'Изменено', date: day })).date).toBe(day)
  })

  it('updates the original row, all editable fields and updatedAt, preserving identity and createdAt', async () => {
    const task = await service.createTask(input)
    vi.setSystemTime(new Date(2026, 9, 4, 13))
    const fields: TaskInput = { title: 'Новая задача', description: 'Первая строка\nВторая строка', date: tomorrow, time: '12:45', priority: 'low' }
    const changed = await service.updateTask(task.id, fields)
    expect(changed).toEqual({ ...task, ...fields, updatedAt: new Date().toISOString() })
    expect(changed.updatedAt).not.toBe(task.updatedAt)
    expect(await database.tasks.count()).toBe(1)
    expect(await service.getTasksForDate(today)).toEqual([])
    expect(await service.getTasksForDate(tomorrow)).toEqual([changed])
  })

  it('ignores identity/status fields supplied at runtime and clears optional fields through normal editing', async () => {
    const task = await service.createTask({ ...input, description: 'Удалить', time: '10:00', id: 'injected', status: 'completed' } as TaskInput)
    expect(task.status).toBe('active')
    expect(task.id).not.toBe('injected')
    const changed = await service.updateTask(task.id, {
      ...input, id: 'new-id', createdAt: 'changed', status: 'completed', completedAt: 'changed',
    } as TaskInput)
    expect(changed).toMatchObject({ id: task.id, createdAt: task.createdAt, status: 'active', completedAt: null, time: null, description: '' })
  })

  it('does not change an existing task when editing fails validation', async () => {
    const task = await service.createTask(input)
    await expect(service.updateTask(task.id, { ...input, title: '  ', date: '2026-02-30' })).rejects.toThrow()
    expect(await service.getTask(task.id)).toEqual(task)
  })

  it('completes a task, retains completedAt on repeat completion, and preserves completion during editing', async () => {
    const task = await service.createTask(input)
    vi.setSystemTime(new Date(2026, 9, 4, 13))
    const completed = await service.completeTask(task.id)
    expect(completed).toEqual({ ...task, status: 'completed', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    vi.setSystemTime(new Date(2026, 9, 4, 14))
    expect(await service.completeTask(task.id)).toEqual(completed)
    const changed = await service.updateTask(task.id, { ...input, title: 'Готовая задача' })
    expect(changed).toMatchObject({ status: 'completed', completedAt: completed.completedAt, title: 'Готовая задача' })
    expect(await service.getAllTasks()).toEqual([changed])
  })

  it('reopens a task, clears completedAt and leaves repeat reopening unchanged', async () => {
    const task = await service.createTask(input)
    await service.completeTask(task.id)
    vi.setSystemTime(new Date(2026, 9, 4, 13))
    const reopened = await service.reopenTask(task.id)
    expect(reopened).toEqual({ ...task, status: 'active', completedAt: null, updatedAt: new Date().toISOString() })
    vi.setSystemTime(new Date(2026, 9, 4, 14))
    expect(await service.reopenTask(task.id)).toEqual(reopened)
    const completed = await service.completeTask(task.id)
    expect(completed.completedAt).toBe(new Date().toISOString())
  })

  it('persists edited data and completion across database reopening', async () => {
    const task = await service.createTask({ ...input, time: '18:30', description: 'Сохранить' })
    const completed = await service.completeTask(task.id)
    const name = database.name
    database.close()
    database = new TaskTrackerDatabase(name)
    service = new TaskService(database)
    await database.open()
    expect(await service.getTask(task.id)).toEqual(completed)
    await service.reopenTask(task.id)
    database.close()
    await database.open()
    expect(await service.getTask(task.id)).toMatchObject({ status: 'active', completedAt: null, description: 'Сохранить', time: '18:30' })
  })

  it('deletes only the selected task, allows repeated delete and does not recreate a deleted task on mutation', async () => {
    const first = await service.createTask(input)
    const second = await service.createTask(input)
    await service.deleteTask(first.id)
    await service.deleteTask(first.id)
    expect(await service.getTask(first.id)).toBeUndefined()
    expect(await service.getAllTasks()).toEqual([second])
    await expect(service.updateTask(first.id, input)).rejects.toThrow('не найдена')
    await expect(service.completeTask(first.id)).rejects.toThrow('не найдена')
    await expect(service.reopenTask(first.id)).rejects.toThrow('не найдена')
    expect(await database.tasks.count()).toBe(1)
  })

  it('validates runtime ids before sending them to IndexedDB', async () => {
    for (const id of ['', '  ', null, 123]) {
      await expect(service.getTask(id as string)).rejects.toThrow('идентификатор')
      await expect(service.deleteTask(id as string)).rejects.toThrow('идентификатор')
      await expect(service.updateTask(id as string, input)).rejects.toThrow('идентификатор')
      await expect(service.completeTask(id as string)).rejects.toThrow('идентификатор')
      await expect(service.reopenTask(id as string)).rejects.toThrow('идентификатор')
    }
  })

  it('retains both concurrent edits and completion from another connection', async () => {
    const task = await service.createTask(input)
    const other = new TaskTrackerDatabase(database.name)
    try {
      await other.open()
      await Promise.all([
        service.updateTask(task.id, { ...input, title: 'Из другой вкладки', time: '10:00' }),
        new TaskService(other).completeTask(task.id),
      ])
      expect(await service.getTask(task.id)).toMatchObject({ title: 'Из другой вкладки', time: '10:00', status: 'completed', completedAt: expect.any(String) })
      await Promise.all([
        new TaskService(other).reopenTask(task.id),
        service.updateTask(task.id, { ...input, title: 'Вновь активна', description: 'Сохранено' }),
      ])
      expect(await service.getTask(task.id)).toMatchObject({ title: 'Вновь активна', description: 'Сохранено', status: 'active', completedAt: null })
    } finally {
      other.close()
    }
  })

  it.each(['edit', 'complete', 'reopen'] as const)('does not resurrect a row deleted concurrently with %s', async (operation) => {
    const task = await service.createTask(input)
    const other = new TaskTrackerDatabase(database.name)
    try {
      await other.open()
      const otherService = new TaskService(other)
      await Promise.allSettled([
        otherService.deleteTask(task.id),
        operation === 'edit' ? service.updateTask(task.id, input)
          : operation === 'complete' ? service.completeTask(task.id) : service.reopenTask(task.id),
      ])
      expect(await service.getTask(task.id)).toBeUndefined()
    } finally {
      other.close()
    }
  })

  it('selects tasks by the date index and returns active and completed rows in the same stable order', async () => {
    const records = [fixture('untimed'), fixture('early', { time: '08:00' }), fixture('past', { date: yesterday }), fixture('future', { date: tomorrow }), fixture('done', { status: 'completed', completedAt: createdAt })]
    await database.tasks.bulkAdd(records)
    expect((await service.getTasksForDate(today)).map((task) => task.id)).toEqual(['early', 'untimed', 'done'])
    expect(await service.getTasksForDate('2026-10-06')).toEqual([])
    expect((await service.getAllTasks()).map((task) => task.id)).toEqual(['past', 'early', 'untimed', 'future', 'done'])
  })

  it('selects an inclusive indexed date range and permits a single-day range', async () => {
    await database.tasks.bulkAdd([
      fixture('before', { date: date('2026-09-30') }), fixture('start', { date: yesterday }),
      fixture('inside'), fixture('end', { date: tomorrow }), fixture('after', { date: date('2026-11-01') }),
    ])
    expect((await service.getTasksForDateRange(yesterday, tomorrow)).map((task) => task.id)).toEqual(['start', 'inside', 'end'])
    expect((await service.getTasksForDateRange(today, today)).map((task) => task.id)).toEqual(['inside'])
    expect(await service.getTasksForDateRange('2027-01-01', '2027-12-31')).toEqual([])
    await expect(service.getTasksForDateRange(tomorrow, yesterday)).rejects.toThrow('Начало периода')
  })

  it('rejects invalid dates in all query methods', async () => {
    await expect(service.getTasksForDate('2026-02-30')).rejects.toThrow('календарная дата')
    await expect(service.getTasksForDateRange('bad', today)).rejects.toThrow('календарная дата')
    await expect(service.getTasksForDateRange(today, 'bad')).rejects.toThrow('календарная дата')
  })

  it.each([
    ['Europe/Moscow', '2026-10-03T22:30:00Z', today, yesterday],
    ['America/Los_Angeles', '2026-10-04T01:30:00Z', yesterday, date('2026-10-02')],
  ])('uses the local calendar date and overdue boundary in %s', async (timezone, now, localToday, localYesterday) => {
    vi.stubEnv('TZ', timezone)
    vi.setSystemTime(new Date(now))
    const task = await service.createTask({ ...input, date: getLocalDate() })
    const late = await service.createTask({ ...input, date: localYesterday })
    expect(task.date).toBe(localToday)
    expect(task.createdAt).toBe(new Date(now).toISOString())
    expect(isTaskOverdue(task)).toBe(false)
    expect(isTaskOverdue(late)).toBe(true)
    expect(groupTasks([task, late]).today).toEqual([task])
    expect(await service.getTasksForDate(localToday)).toEqual([task])
  })

  it('keeps DST and year-boundary dates unchanged rather than deriving task days from timestamps', async () => {
    vi.stubEnv('TZ', 'America/New_York')
    for (const day of ['2026-03-08', '2026-11-01', '2026-12-31', '2027-01-01']) {
      const task = await service.createTask({ ...input, date: day, time: '01:30' })
      expect((await service.getTasksForDate(day))[0]).toEqual(task)
    }
    expect((await service.getTasksForDateRange('2026-12-31', '2027-01-01')).map((task) => task.date)).toEqual(['2026-12-31', '2027-01-01'])
  })
})

describe('task sorting and derived groups', () => {
  it('sorts dates before all other fields and keeps timed tasks before untimed ones', () => {
    const tasks = [
      fixture('untimed-high', { priority: 'high' }), fixture('late-low', { time: '23:59', priority: 'low' }),
      fixture('early-medium', { time: '00:00' }), fixture('past-untimed', { date: yesterday }),
      fixture('future-early', { date: tomorrow, time: '00:00' }),
    ]
    const original = [...tasks]
    expect(sortTasks(tasks).map((task) => task.id)).toEqual(['past-untimed', 'early-medium', 'late-low', 'untimed-high', 'future-early'])
    expect(tasks).toEqual(original)
  })

  it('sorts equal time by priority, then creation, then id consistently', () => {
    const tasks = [
      fixture('low', { priority: 'low' }), fixture('medium'), fixture('high-b', { priority: 'high' }),
      fixture('high-a', { priority: 'high' }), fixture('high-newer', { priority: 'high', createdAt: '2026-10-02T10:00:00.000Z' }),
    ]
    const expected = ['high-a', 'high-b', 'high-newer', 'medium', 'low']
    expect(sortTasks(tasks).map((task) => task.id)).toEqual(expected)
    expect(sortTasks([...tasks].reverse()).map((task) => task.id)).toEqual(expected)
    expect(sortTasks(tasks.map((task) => ({ ...task, time: '12:00' }))).map((task) => task.id)).toEqual(expected)
  })

  it('shows completed tasks after active ones, most recently completed first with id tie-break', () => {
    const tasks = [
      fixture('done-old', { status: 'completed', date: yesterday, completedAt: createdAt }),
      fixture('done-b', { status: 'completed', completedAt: '2026-10-02T10:00:00.000Z' }),
      fixture('active', { date: tomorrow }),
      fixture('done-a', { status: 'completed', completedAt: '2026-10-02T10:00:00.000Z' }),
    ]
    expect(sortTasks(tasks).map((task) => task.id)).toEqual(['active', 'done-a', 'done-b', 'done-old'])
  })

  it('derives overdue only from an active status and an earlier local day, not the time', () => {
    expect(isTaskOverdue(fixture('past', { date: yesterday }), today)).toBe(true)
    expect(isTaskOverdue(fixture('today', { time: '00:00' }), today)).toBe(false)
    expect(isTaskOverdue(fixture('future', { date: tomorrow }), today)).toBe(false)
    expect(isTaskOverdue(fixture('done', { date: yesterday, status: 'completed', completedAt: createdAt }), today)).toBe(false)
  })

  it('puts each task in exactly one sorted group and retains completed tasks for any date', () => {
    const tasks = [
      fixture('today-untimed'), fixture('tomorrow', { date: tomorrow }), fixture('past', { date: yesterday }),
      fixture('today-timed', { time: '12:00' }), fixture('done', { date: yesterday, status: 'completed', completedAt: createdAt }),
    ]
    const groups = groupTasks(tasks, today)
    expect(groups.overdue.map((task) => task.id)).toEqual(['past'])
    expect(groups.today.map((task) => task.id)).toEqual(['today-timed', 'today-untimed'])
    expect(groups.upcoming.map((task) => task.id)).toEqual(['tomorrow'])
    expect(groups.completed.map((task) => task.id)).toEqual(['done'])
    expect(Object.values(groups).flat()).toHaveLength(tasks.length)
    expect(groupTasks([], today)).toEqual({ overdue: [], today: [], upcoming: [], completed: [] })
    expect(tasks.every((task) => !('overdue' in task))).toBe(true)
  })

  it('rejects invalid dates rather than silently misclassifying tasks', () => {
    expect(() => isTaskOverdue(fixture('bad', { date: '2026-02-30' as LocalDate }), today)).toThrow('календарная дата')
    expect(() => isTaskOverdue(fixture('valid'), 'bad' as LocalDate)).toThrow('календарная дата')
    expect(() => groupTasks([], 'bad' as LocalDate)).toThrow('календарная дата')
  })
})
