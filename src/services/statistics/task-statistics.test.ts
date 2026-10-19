import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { Task } from '../../models/task'
import { calculateTaskStatistics } from './task-statistics'

const timestamp = '2026-10-01T09:00:00.000Z'

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

function task(fields: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(), title: 'Задача', description: '', date: date('2026-10-15'),
    time: null, priority: 'medium', status: 'active', completedAt: null,
    createdAt: timestamp, updatedAt: timestamp, ...fields,
  }
}

const monthStart = date('2026-10-01')
const monthEnd = date('2026-10-31')

afterEach(() => vi.unstubAllEnvs())

describe('task statistics by local deadline', () => {
  it('returns null rates and zero counts for an empty period', () => {
    expect(calculateTaskStatistics([], monthStart, monthEnd, new Date(2026, 9, 16))).toEqual({
      tasksDue: 0, relevantTasks: 0, completedOnTime: 0, completedLate: 0,
      completedUnknown: 0, activePending: 0, overdue: 0, failed: 0, cancelled: 0,
      onTimeRate: null, deviationRate: null,
    })
  })

  it('counts each outcome separately and excludes pending, cancelled and unknown from rates', () => {
    const tasks = [
      task({ status: 'completed', completedAt: new Date(2026, 9, 15, 18).toISOString() }),
      task({ status: 'completed', completedAt: new Date(2026, 9, 16, 0).toISOString() }),
      task({ status: 'failed' }), task(), task({ status: 'cancelled' }),
      task({ date: date('2026-10-25') }), task({ status: 'completed', completedAt: null }),
    ]
    const before = structuredClone(tasks)
    expect(calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 9, 16, 12))).toEqual({
      tasksDue: 7, relevantTasks: 4, completedOnTime: 1, completedLate: 1,
      completedUnknown: 1, activePending: 1, overdue: 1, failed: 1, cancelled: 1,
      onTimeRate: 25, deviationRate: 75,
    })
    expect(tasks).toEqual(before)
  })

  it('selects deadlines inclusively rather than filtering completion or creation timestamps', () => {
    const tasks = [
      task({ date: monthStart, status: 'completed', createdAt: '2026-09-01T12:00:00Z', completedAt: '2026-09-30T12:00:00Z' }),
      task({ date: monthEnd, status: 'completed', completedAt: '2026-11-01T12:00:00Z' }),
      task({ date: date('2026-09-30'), status: 'completed', completedAt: '2026-10-01T12:00:00Z' }),
      task({ date: date('2026-11-01'), status: 'completed', completedAt: '2026-10-31T12:00:00Z' }),
    ]
    expect(calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 10, 2))).toMatchObject({
      tasksDue: 2, relevantTasks: 2, completedOnTime: 1, completedLate: 1,
      onTimeRate: 50, deviationRate: 50,
    })
  })

  it('allows the full local day when a task has no deadline time', () => {
    const tasks = [
      task({ status: 'completed', completedAt: new Date(2026, 9, 15, 23, 59, 59, 999).toISOString() }),
      task({ status: 'completed', completedAt: new Date(2026, 9, 16, 0).toISOString() }),
    ]
    expect(calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 9, 16))).toMatchObject({
      completedOnTime: 1, completedLate: 1,
    })
  })

  it('honors a timed deadline including the exact deadline instant', () => {
    const tasks = [
      task({ time: '14:30', status: 'completed', completedAt: new Date(2026, 9, 15, 14, 30).toISOString() }),
      task({ time: '14:30', status: 'completed', completedAt: new Date(2026, 9, 15, 14, 30, 0, 1).toISOString() }),
    ]
    expect(calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 9, 16))).toMatchObject({
      completedOnTime: 1, completedLate: 1,
    })
  })

  it('counts active timed tasks as overdue only after the deadline passes', () => {
    const tasks = [task({ time: '14:30' }), task()]
    expect(calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 9, 15, 14, 30))).toMatchObject({
      activePending: 2, overdue: 0, relevantTasks: 0, onTimeRate: null, deviationRate: null,
    })
    expect(calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 9, 15, 14, 30, 0, 1))).toMatchObject({
      activePending: 1, overdue: 1, relevantTasks: 1, onTimeRate: 0, deviationRate: 100,
    })
  })

  it('waits until local midnight to mark an untimed active task overdue', () => {
    const tasks = [task()]
    expect(calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 9, 15, 23, 59, 59, 999)).overdue).toBe(0)
    expect(calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 9, 16)).overdue).toBe(1)
  })

  it.each([null, '', 'invalid', '2026-13-40T12:00:00Z'])('reports a completion with timestamp %s as unknown', (completedAt) => {
    expect(calculateTaskStatistics([task({ status: 'completed', completedAt })], monthStart, monthEnd, new Date(2026, 9, 16))).toMatchObject({
      tasksDue: 1, relevantTasks: 0, completedUnknown: 1, completedOnTime: 0,
      completedLate: 0, overdue: 0, failed: 0, onTimeRate: null, deviationRate: null,
    })
  })

  it('returns null rates when every task is cancelled or still pending', () => {
    const tasks = [task({ status: 'cancelled' }), task({ date: date('2026-10-30') })]
    expect(calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 9, 16))).toMatchObject({
      tasksDue: 2, relevantTasks: 0, cancelled: 1, activePending: 1, onTimeRate: null, deviationRate: null,
    })
  })

  it('retains fractional rates and does not count cancelled tasks in the denominator', () => {
    const tasks = [
      task({ status: 'completed', completedAt: new Date(2026, 9, 15, 20).toISOString() }),
      task({ status: 'failed' }), task(), task({ status: 'cancelled' }),
    ]
    const result = calculateTaskStatistics(tasks, monthStart, monthEnd, new Date(2026, 9, 16))
    expect(result.relevantTasks).toBe(3)
    expect(result.onTimeRate).toBeCloseTo(100 / 3)
    expect(result.deviationRate).toBeCloseTo(200 / 3)
  })

  it.each([
    ['Europe/Moscow', '2026-10-15T22:30:00Z', 0, 1],
    ['America/Los_Angeles', '2026-10-16T01:30:00Z', 1, 0],
  ])('compares the local calendar deadline with timestamps around midnight in %s', (timezone, completedAt, onTime, late) => {
    vi.stubEnv('TZ', timezone)
    expect(calculateTaskStatistics([task({ status: 'completed', completedAt })], monthStart, monthEnd, new Date(2026, 9, 17))).toMatchObject({
      completedOnTime: onTime, completedLate: late,
    })
  })

  it.each([
    ['2026-03-08', '2026-03-09T03:59:59.999Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01', '2026-11-02T04:59:59.999Z', '2026-11-02T05:00:00Z'],
  ])('uses the actual end of a DST transition day %s', (deadline, onTime, late) => {
    vi.stubEnv('TZ', 'America/New_York')
    const tasks = [
      task({ date: date(deadline), status: 'completed', completedAt: onTime }),
      task({ date: date(deadline), status: 'completed', completedAt: late }),
    ]
    expect(calculateTaskStatistics(tasks, date(deadline), date(deadline), new Date(late))).toMatchObject({
      tasksDue: 2, completedOnTime: 1, completedLate: 1,
    })
  })

  it('validates period boundaries and current time even for empty data', () => {
    const now = new Date(2026, 9, 16)
    expect(() => calculateTaskStatistics([], monthEnd, monthStart, now)).toThrow('Начало периода')
    expect(() => calculateTaskStatistics([], '2026-02-30' as LocalDate, monthEnd, now)).toThrow('календарная дата')
    expect(() => calculateTaskStatistics([], monthStart, monthEnd, new Date('invalid'))).toThrow('Некорректная дата')
    expect(() => calculateTaskStatistics([task({ date: 'invalid' as LocalDate })], monthStart, monthEnd, now)).toThrow('календарная дата')
  })
})
