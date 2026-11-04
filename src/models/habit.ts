import type { DurationRatingRange } from './duration-rating'
import type { HabitCategory } from './habit-category'
import type { HabitSchedule } from './habit-schedule'

interface HabitBase {
  id: string
  category: HabitCategory
  schedule?: HabitSchedule
  name: string
  description: string
  order: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface BooleanHabit extends HabitBase {
  type: 'boolean'
}

export interface AmountHabit extends HabitBase {
  type: 'amount'
  unit: string
  target: number
  quickActions: number[]
  manualMode: 'add' | 'total'
}

export interface DurationHabit extends HabitBase {
  type: 'duration'
  unit: 'minutes'
  ratingRanges: DurationRatingRange[]
}

export interface RatingHabit extends HabitBase {
  type: 'rating'
}

export type Habit = BooleanHabit | AmountHabit | DurationHabit | RatingHabit
export type HabitType = Habit['type']
