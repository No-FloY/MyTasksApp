import type { DurationRatingRange } from './duration-rating'

interface HabitBase {
  id: string
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
