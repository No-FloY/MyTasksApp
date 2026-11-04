import type { Habit } from '../models/habit'
import { getInitialDurationRanges } from './duration-defaults'

/** Real starting configuration; results are only created by the user's actions. */
export function createInitialHabits(now: string = new Date().toISOString()): Habit[] {
  const shared = { createdAt: now, updatedAt: now, archivedAt: null }

  return [
    {
      ...shared,
      id: 'abstinence',
      category: 'self_development',
      type: 'boolean',
      name: 'Воздержание',
      description: 'Следовать своему решению',
      order: 0,
    },
    {
      ...shared,
      id: 'english',
      category: 'self_development',
      type: 'boolean',
      name: 'Английский каждый день',
      description: 'Практика языка каждый день',
      order: 1,
    },
    {
      ...shared,
      id: 'reading',
      category: 'self_development',
      type: 'boolean',
      name: 'Чтение книги каждый день',
      description: 'Время для хорошей книги',
      order: 2,
    },
    {
      ...shared,
      id: 'early-rising',
      category: 'routine',
      type: 'boolean',
      name: 'Подъём до 8:00',
      description: 'Начать утро пораньше',
      order: 3,
    },
    {
      ...shared,
      id: 'no-chips',
      category: 'food_water',
      type: 'boolean',
      name: 'Без чипсов',
      description: 'День без чипсов',
      order: 4,
    },
    {
      ...shared,
      id: 'no-soda-or-juice',
      category: 'food_water',
      type: 'boolean',
      name: 'Без газировок и соков',
      description: 'Выбрать напитки без сахара',
      order: 5,
    },
    {
      ...shared,
      id: 'no-energy-drinks',
      category: 'food_water',
      type: 'boolean',
      name: 'Без энергетиков',
      description: 'День без энергетических напитков',
      order: 6,
    },
    {
      ...shared,
      id: 'no-fast-food',
      category: 'food_water',
      type: 'boolean',
      name: 'Без фастфуда',
      description: 'Позаботиться о своём питании',
      order: 7,
    },
    {
      ...shared,
      id: 'water',
      category: 'food_water',
      type: 'amount',
      name: 'Вода',
      description: '2000 мл в день',
      unit: 'ml',
      target: 2000,
      quickActions: [200, 400],
      manualMode: 'add',
      order: 8,
    },
    {
      ...shared,
      id: 'gaming',
      category: 'screen_time',
      type: 'duration',
      name: 'Время в играх',
      description: 'Фактическое время в минутах',
      unit: 'minutes',
      ratingRanges: getInitialDurationRanges('gaming'),
      order: 9,
    },
    {
      ...shared,
      id: 'social-media',
      category: 'screen_time',
      type: 'duration',
      name: 'Время в социальных сетях',
      description: 'Фактическое время в минутах',
      unit: 'minutes',
      ratingRanges: getInitialDurationRanges('social-media'),
      order: 10,
    },
    ...createStageTenHabits(now),
  ]
}

/** Only genuinely new definitions; missing old seed habits must stay deleted. */
export function createStageTenHabits(now: string): Habit[] {
  const shared = { createdAt: now, updatedAt: now, archivedAt: null }
  return [
    { ...shared, id: 'no-sweets', category: 'food_water', type: 'boolean', name: 'Без сладкого и шоколада',
      description: 'День без сладкого и шоколада', order: 11 },
    { ...shared, id: 'push-ups', category: 'training', type: 'amount', name: 'Отжимания',
      description: 'Фактическое число повторений за день', unit: 'reps', target: 100, quickActions: [10], manualMode: 'total', order: 12 },
    { ...shared, id: 'abs', category: 'training', type: 'amount', name: 'Пресс',
      description: 'Фактическое число повторений за день', unit: 'reps', target: 100, quickActions: [10], manualMode: 'total', order: 13 },
    { ...shared, id: 'squats', category: 'training', type: 'amount', name: 'Приседания',
      description: 'Фактическое число повторений за день', unit: 'reps', target: 100, quickActions: [10], manualMode: 'total', order: 14 },
    { ...shared, id: 'pull-ups', category: 'training', type: 'amount', name: 'Подтягивания',
      description: 'Фактическое число повторений за день', unit: 'reps', target: 15, quickActions: [1], manualMode: 'total', order: 15 },
    { ...shared, id: 'walk-10km', category: 'training', type: 'boolean', name: 'Пройти 10 км',
      description: 'Отметить, пройдено ли не менее 10 км за день', order: 16 },
    { ...shared, id: 'workout', category: 'training', type: 'boolean', name: 'Тренировка',
      description: 'Отметить факт тренировки самостоятельно', order: 17 },
    ...createStageTenAdditionalHabits(now),
  ]
}

/** Supplementary definitions are separate so an already migrated v5 keeps its settings. */
export function createStageTenAdditionalHabits(now: string): Habit[] {
  const shared = { createdAt: now, updatedAt: now, archivedAt: null }
  return [
    { ...shared, id: 'no-alcohol', category: 'food_water', type: 'boolean', name: 'Без алкоголя',
      description: 'Отметить, был ли день без алкоголя', order: 18 },
    { ...shared, id: 'breakfast', category: 'food_water', type: 'boolean', name: 'Завтрак',
      description: 'Был ли завтрак', order: 19 },
    { ...shared, id: 'lunch', category: 'food_water', type: 'boolean', name: 'Обед',
      description: 'Был ли обед', order: 20 },
    { ...shared, id: 'dinner', category: 'food_water', type: 'boolean', name: 'Ужин',
      description: 'Был ли ужин', order: 21 },
    { ...shared, id: 'cleaning', category: 'routine', type: 'boolean', name: 'Уборка',
      description: 'Один раз в неделю', schedule: { type: 'weekly' }, order: 22 },
  ]
}
