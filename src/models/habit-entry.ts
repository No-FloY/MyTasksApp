import type { LocalDate } from '../lib/local-date'

export type BooleanHabitStatus = 'success' | 'failure' | 'no-data'

interface HabitEntryBase {
  habitId: string
  date: LocalDate
  createdAt: string
  updatedAt: string
}

export interface BooleanHabitEntry extends HabitEntryBase {
  type: 'boolean'
  status: BooleanHabitStatus
}

export interface AmountHabitEntry extends HabitEntryBase {
  type: 'amount'
  value: number
}

export interface DurationHabitEntry extends HabitEntryBase {
  type: 'duration'
  minutes: number
}

export interface RatingHabitEntry extends HabitEntryBase {
  type: 'rating'
  value: number
}

export type HabitEntry =
  | BooleanHabitEntry
  | AmountHabitEntry
  | DurationHabitEntry
  | RatingHabitEntry
