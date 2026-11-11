import type { Table } from 'dexie'
import type { Habit } from '../models/habit'
import { enrichLegacyHabit, type LegacyHabit } from './habit-backfill'
import { createInitialHabits } from './seed'

/**
 * Current system definitions share their source with first-run seed. Existing IDs
 * belong to the user: retain names, lifecycle, timestamps, schedules and settings.
 * Missing definitions start now; backfill never manufactures historical results.
 */
export function backfillCurrentSystemHabits(habits: readonly LegacyHabit[], now: string): Habit[] {
  const defaults = createInitialHabits(now)
  const byId = new Map(defaults.map((habit) => [habit.id, habit]))
  const result = habits.map((habit) => {
    const normalized = enrichLegacyHabit(habit)
    const initial = byId.get(habit.id)
    if (normalized.type === 'duration' && normalized.ratingRanges === undefined && initial?.type === 'duration') {
      return { ...normalized, ratingRanges: initial.ratingRanges }
    }
    // An omitted schedule already means daily, so it is not a missing field.
    return normalized
  })
  const ids = new Set(habits.map((habit) => habit.id))
  for (const habit of defaults) if (!ids.has(habit.id)) result.push(habit)
  return result
}

/** Call inside the caller's read/write or schema-upgrade transaction. */
export async function ensureCurrentSystemData(habits: Table<Habit, string>, now: string = new Date().toISOString()): Promise<void> {
  const current = await habits.toArray()
  const before = new Map(current.map((habit) => [habit.id, JSON.stringify(habit)]))
  const changed = backfillCurrentSystemHabits(current, now).filter((habit) => before.get(habit.id) !== JSON.stringify(habit))
  if (changed.length > 0) await habits.bulkPut(changed)
}
