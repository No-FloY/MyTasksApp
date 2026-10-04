/** Bounds are inclusive; null is the unbounded upper end of the final range. */
export interface DurationRatingRange {
  id: string
  label: string
  emoji: string
  minMinutes: number
  maxMinutes: number | null
}
