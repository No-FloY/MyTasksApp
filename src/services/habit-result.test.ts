import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { BooleanHabit, Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import { getDefaultHabitPolicy } from '../models/habit-policy'
import { createInitialHabits } from '../db/seed'
import { resolveHabitResult } from './habit-result'

function date(value: string): LocalDate { if (!isLocalDate(value)) throw new Error('Invalid test date'); return value }
const today = date('2026-11-10')
const yesterday = date('2026-11-09')
const timestamp = '2026-11-01T09:00:00.000Z'
const habits = createInitialHabits(timestamp)
function habit(id: string): Habit {
  const result = habits.find((item) => item.id === id)
  if (!result) throw new Error(`Missing test habit ${id}`)
  return { ...result, ...getDefaultHabitPolicy(result.id, result.type) }
}
afterEach(() => vi.unstubAllEnvs())

describe('computed missing-day policy', () => {
  it.each(['english', 'reading', 'workout', 'walk-10km'])('%s is inferred not done only after the local day ends', (id) => {
    expect(resolveHabitResult(habit(id), undefined, today, today)).toMatchObject({ status: 'no-data', source: 'no-data' })
    expect(resolveHabitResult(habit(id), undefined, yesterday, today)).toMatchObject({ status: 'failure', source: 'inferred' })
  })
  it.each(['no-alcohol', 'no-sweets', 'no-chips', 'no-soda-or-juice', 'no-energy-drinks', 'no-fast-food'])('%s infers no event', (id) => {
    expect(resolveHabitResult(habit(id), undefined, yesterday, today)).toMatchObject({ status: 'success', source: 'inferred' })
  })
  it('coffee infers did not drink without using avoidance semantics', () => {
    expect(resolveHabitResult(habit('coffee'), undefined, yesterday, today)).toMatchObject({ status: 'failure', source: 'inferred' })
    expect(resolveHabitResult(habit('coffee'), undefined, today, today)).toMatchObject({ status: 'no-data', source: 'no-data' })
  })
  it.each(['push-ups', 'abs', 'squats', 'pull-ups'])('%s infers a computed zero without a physical entry', (id) => {
    const result = resolveHabitResult(habit(id), undefined, yesterday, today)
    expect(result).toEqual({ type: 'amount', value: 0, source: 'inferred' })
    expect(result).not.toHaveProperty('createdAt')
    expect(resolveHabitResult(habit(id), undefined, today, today)).toMatchObject({ value: null, source: 'no-data' })
  })
  it.each(['water', 'gaming', 'social-media', 'breakfast', 'lunch', 'dinner', 'early-rising'])('%s stays manual', (id) => {
    const result = resolveHabitResult(habit(id), undefined, yesterday, today)
    expect(result.source).toBe('no-data')
    expect(result.type === 'boolean' ? result.status : result.type === 'duration' ? result.minutes : result.value).toBe(result.type === 'boolean' ? 'no-data' : null)
  })
  it.each(['success', 'failure', 'no-data'] as const)('explicit %s overrides automatic policy and retains its own source', (status) => {
    const entry: HabitEntry = { habitId: 'coffee', type: 'boolean', date: yesterday, status, createdAt: timestamp, updatedAt: timestamp }
    const original = structuredClone(entry)
    expect(resolveHabitResult(habit('coffee'), entry, yesterday, today)).toEqual({ type: 'boolean', status, source: 'explicit' })
    expect(entry).toStrictEqual(original)
  })
  it('does not infer before creation, on or after archival, or outside the configured weekdays', () => {
    const custom: Habit = { ...habit('english'), createdAt: '2026-11-08T21:30:00.000Z' }
    expect(resolveHabitResult(custom, undefined, date('2026-11-08'), today).source).toBe('no-data')
    expect(resolveHabitResult(custom, undefined, yesterday, today).source).toBe('inferred')
    expect(resolveHabitResult({ ...custom, archivedAt: '2026-11-09T12:00:00Z' }, undefined, yesterday, today).source).toBe('no-data')
    expect(resolveHabitResult({ ...custom, schedule: { type: 'weekdays', days: [2] } }, undefined, yesterday, today).source).toBe('no-data')
  })
  it('keeps manual policy and unknown user habits without metadata manual', () => {
    expect(resolveHabitResult({ ...habit('english'), missingDataPolicy: 'manual' }, undefined, yesterday, today).source).toBe('no-data')
    const custom = { ...habit('english'), id: 'custom' }
    delete custom.missingDataPolicy
    expect(resolveHabitResult(custom, undefined, yesterday, today).source).toBe('no-data')
  })
  it('waits for a complete tracked week and respects explicit no-data and manual override', () => {
    const weekly = habit('cleaning')
    expect(resolveHabitResult(weekly, undefined, yesterday, today).source).toBe('no-data')
    expect(resolveHabitResult(weekly, undefined, date('2026-11-02'), today)).toMatchObject({ status: 'failure', source: 'inferred' })
    expect(resolveHabitResult({ ...weekly, missingDataPolicy: 'manual' }, undefined, date('2026-11-02'), today).source).toBe('no-data')
    expect(resolveHabitResult({ ...weekly, createdAt: '2026-11-03T09:00:00Z' }, undefined, date('2026-11-02'), today).source).toBe('no-data')
  })
  it('uses the local midnight rather than UTC or 24-hour intervals across DST', () => {
    const coffee = habit('coffee') as BooleanHabit
    const before = getLocalDate(new Date('2026-11-09T20:59:59Z'))
    const after = getLocalDate(new Date('2026-11-09T21:00:00Z'))
    expect(resolveHabitResult(coffee, undefined, yesterday, before).source).toBe('no-data')
    expect(resolveHabitResult(coffee, undefined, yesterday, after).source).toBe('inferred')
    vi.stubEnv('TZ', 'America/New_York')
    const dstDay = date('2026-11-01')
    expect(resolveHabitResult({ ...coffee, createdAt: '2026-10-01T09:00:00Z' }, undefined, dstDay,
      getLocalDate(new Date('2026-11-02T04:59:59Z'))).source).toBe('no-data')
    expect(resolveHabitResult({ ...coffee, createdAt: '2026-10-01T09:00:00Z' }, undefined, dstDay,
      getLocalDate(new Date('2026-11-02T05:00:00Z'))).source).toBe('inferred')
  })
})
