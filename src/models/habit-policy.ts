import type { Habit, HabitType } from './habit'

export const MISSING_DATA_POLICIES = ['manual', 'assume_not_done', 'assume_not_occurred'] as const
export type MissingDataPolicy = typeof MISSING_DATA_POLICIES[number]
export const BOOLEAN_HABIT_MODES = ['achievement', 'avoidance', 'observation'] as const
export type BooleanHabitMode = typeof BOOLEAN_HABIT_MODES[number]

const avoidanceIds = new Set(['no-alcohol', 'no-sweets', 'no-chips', 'no-energy-drinks', 'no-fast-food', 'no-soda-or-juice'])
const completionIds = new Set(['english', 'reading', 'workout', 'walk-10km', 'push-ups', 'abs', 'squats', 'pull-ups', 'cleaning'])

/** Stable IDs, never display names, define system defaults. Saved user choices take precedence. */
export function getDefaultHabitPolicy(id: string, type: HabitType): { missingDataPolicy: MissingDataPolicy; booleanMode?: BooleanHabitMode } {
  if (type === 'boolean') {
    if (id === 'coffee') return { missingDataPolicy: 'assume_not_occurred', booleanMode: 'observation' }
    if (avoidanceIds.has(id)) return { missingDataPolicy: 'assume_not_occurred', booleanMode: 'avoidance' }
    return { missingDataPolicy: completionIds.has(id) ? 'assume_not_done' : 'manual', booleanMode: 'achievement' }
  }
  return { missingDataPolicy: type === 'amount' && completionIds.has(id) ? 'assume_not_done' : 'manual' }
}

export function getMissingDataPolicy(habit: Pick<Habit, 'missingDataPolicy'>): MissingDataPolicy {
  return habit.missingDataPolicy ?? 'manual'
}

export function getBooleanHabitMode(habit: Habit): BooleanHabitMode {
  if (habit.type !== 'boolean') return 'achievement'
  // Coffee is an observation even if an older/custom snapshot omitted its metadata.
  if (habit.id === 'coffee') return 'observation'
  return habit.booleanMode ?? (avoidanceIds.has(habit.id) ? 'avoidance' : 'achievement')
}

export function isObservationalHabit(habit: Habit): boolean {
  return habit.type === 'boolean' && getBooleanHabitMode(habit) === 'observation'
}
