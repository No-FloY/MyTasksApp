import type { Habit } from '../models/habit'

/** Real starting configuration; results are only created by the user's actions. */
export function createInitialHabits(now: string = new Date().toISOString()): Habit[] {
  const shared = { createdAt: now, updatedAt: now, archivedAt: null }

  return [
    {
      ...shared,
      id: 'abstinence',
      type: 'boolean',
      name: 'Воздержание',
      description: 'Следовать своему решению',
      order: 0,
    },
    {
      ...shared,
      id: 'english',
      type: 'boolean',
      name: 'Английский каждый день',
      description: 'Практика языка каждый день',
      order: 1,
    },
    {
      ...shared,
      id: 'reading',
      type: 'boolean',
      name: 'Чтение книги каждый день',
      description: 'Время для хорошей книги',
      order: 2,
    },
    {
      ...shared,
      id: 'early-rising',
      type: 'boolean',
      name: 'Подъём до 8:00',
      description: 'Начать утро пораньше',
      order: 3,
    },
    {
      ...shared,
      id: 'no-chips',
      type: 'boolean',
      name: 'Без чипсов',
      description: 'День без чипсов',
      order: 4,
    },
    {
      ...shared,
      id: 'no-soda-or-juice',
      type: 'boolean',
      name: 'Без газировок и соков',
      description: 'Выбрать напитки без сахара',
      order: 5,
    },
    {
      ...shared,
      id: 'no-energy-drinks',
      type: 'boolean',
      name: 'Без энергетиков',
      description: 'День без энергетических напитков',
      order: 6,
    },
    {
      ...shared,
      id: 'no-fast-food',
      type: 'boolean',
      name: 'Без фастфуда',
      description: 'Позаботиться о своём питании',
      order: 7,
    },
    {
      ...shared,
      id: 'water',
      type: 'amount',
      name: 'Вода',
      description: '2000 мл в день',
      unit: 'ml',
      target: 2000,
      order: 8,
    },
    {
      ...shared,
      id: 'gaming',
      type: 'duration',
      name: 'Время в играх',
      description: 'Фактическое время в минутах',
      unit: 'minutes',
      order: 9,
    },
    {
      ...shared,
      id: 'social-media',
      type: 'duration',
      name: 'Время в социальных сетях',
      description: 'Фактическое время в минутах',
      unit: 'minutes',
      order: 10,
    },
  ]
}
