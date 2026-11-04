/** ISO weekdays: Monday = 1, Sunday = 7. Missing schedule means daily. */
export type HabitSchedule =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] }
  | { type: 'weekly'; weekday?: number }
