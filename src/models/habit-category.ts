export const HABIT_CATEGORIES = [
  { id: 'food_water', label: 'Еда и вода' },
  { id: 'training', label: 'Тренировка' },
  { id: 'routine', label: 'Быт и режим' },
  { id: 'study_work', label: 'Учёба и работа' },
  { id: 'screen_time', label: 'Экранное время' },
  { id: 'self_development', label: 'Саморазвитие' },
] as const

export type HabitCategory = typeof HABIT_CATEGORIES[number]['id']

const legacyCategories: Readonly<Record<string, HabitCategory>> = {
  water: 'food_water',
  'no-chips': 'food_water',
  'no-soda-or-juice': 'food_water',
  'no-energy-drinks': 'food_water',
  'no-fast-food': 'food_water',
  'no-sweets': 'food_water',
  'no-alcohol': 'food_water',
  breakfast: 'food_water',
  lunch: 'food_water',
  dinner: 'food_water',
  'push-ups': 'training',
  abs: 'training',
  squats: 'training',
  'pull-ups': 'training',
  'walk-10km': 'training',
  workout: 'training',
  'early-rising': 'routine',
  cleaning: 'routine',
  gaming: 'screen_time',
  'social-media': 'screen_time',
  abstinence: 'self_development',
  english: 'self_development',
  reading: 'self_development',
}

export function isHabitCategory(value: unknown): value is HabitCategory {
  return HABIT_CATEGORIES.some((category) => category.id === value)
}

/** Stable IDs supply defaults only; saved user categories always take priority. */
export function getHabitCategory(habitOrId: string | { id: string; category?: unknown }): HabitCategory {
  if (typeof habitOrId !== 'string' && isHabitCategory(habitOrId.category)) return habitOrId.category
  const id = typeof habitOrId === 'string' ? habitOrId : habitOrId.id
  return Object.hasOwn(legacyCategories, id) ? legacyCategories[id]! : 'self_development'
}
