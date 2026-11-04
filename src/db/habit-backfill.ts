import type { AmountHabit, BooleanHabit, DurationHabit, Habit, RatingHabit } from '../models/habit'
import { getHabitCategory, type HabitCategory } from '../models/habit-category'
import { createStageTenHabits } from './seed'

/** Shape stored before schema v5, also accepting already enriched definitions. */
export type LegacyHabit = { category?: HabitCategory } & (
  | Omit<BooleanHabit, 'category'>
  | (Omit<AmountHabit, 'category' | 'quickActions' | 'manualMode'> & Partial<Pick<AmountHabit, 'quickActions' | 'manualMode'>>)
  | Omit<DurationHabit, 'category'>
  | Omit<RatingHabit, 'category'>
)

/** Add metadata without changing identity, content, lifecycle or historical facts. */
export function enrichLegacyHabit(habit: LegacyHabit): Habit {
  const category = getHabitCategory(habit)
  if (habit.type !== 'amount') return { ...habit, category }
  const exercise = ['push-ups', 'abs', 'squats', 'pull-ups'].includes(habit.id)
  const quickActions = habit.quickActions ?? (exercise ? [habit.id === 'pull-ups' ? 1 : 10] : [200, 400])
  return { ...habit, category, quickActions: [...quickActions], manualMode: habit.manualMode ?? (exercise ? 'total' : 'add') }
}

/** The schema upgrade adds Stage 10 definitions once; backup conversion must not call this. */
export function backfillHabitDefinitions(habits: readonly LegacyHabit[], now: string): Habit[] {
  const result = habits.map(enrichLegacyHabit)
  const ids = new Set(habits.map((habit) => habit.id))
  for (const habit of createStageTenHabits(now)) {
    if (!ids.has(habit.id)) result.push(habit)
  }
  return result
}
