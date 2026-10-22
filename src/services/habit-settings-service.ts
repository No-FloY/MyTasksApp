import { db, type TaskTrackerDatabase } from '../db/database'
import type { DurationRatingRange } from '../models/duration-rating'
import type { Habit } from '../models/habit'
import { validateRatingRanges } from './duration-service'

export const MAX_HABIT_NAME_LENGTH = 200
export const MAX_HABIT_DESCRIPTION_LENGTH = 5000
export const MAX_RATING_LABEL_LENGTH = 100
export const MAX_RATING_EMOJI_LENGTH = 32

interface HabitSettingsBase {
  name: string
  description: string
}

export type HabitSettingsInput =
  | (HabitSettingsBase & { type: 'boolean' | 'rating' })
  | (HabitSettingsBase & { type: 'amount'; target: number })
  | (HabitSettingsBase & { type: 'duration'; ratingRanges: DurationRatingRange[] })

function validateId(id: string): void {
  if (typeof id !== 'string' || !id.trim()) throw new Error('Некорректный идентификатор привычки.')
}

function normalizeRanges(ranges: DurationRatingRange[]): DurationRatingRange[] {
  validateRatingRanges(ranges)
  return ranges.map((range) => {
    if (range.label.trim().length > MAX_RATING_LABEL_LENGTH
      || range.emoji.trim().length > MAX_RATING_EMOJI_LENGTH) {
      throw new Error(`Подпись оценки — до ${MAX_RATING_LABEL_LENGTH} символов, смайлик — до ${MAX_RATING_EMOJI_LENGTH}.`)
    }
    return {
      id: range.id,
      label: range.label.trim(),
      emoji: range.emoji.trim(),
      minMinutes: range.minMinutes,
      maxMinutes: range.maxMinutes,
    }
  })
}

function normalizeInput(input: HabitSettingsInput): HabitSettingsInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Введите настройки привычки.')
  }
  if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('Введите название привычки.')
  if (input.name.trim().length > MAX_HABIT_NAME_LENGTH) {
    throw new Error(`Название не должно превышать ${MAX_HABIT_NAME_LENGTH} символов.`)
  }
  if (typeof input.description !== 'string') throw new Error('Описание должно быть текстом.')
  if (input.description.trim().length > MAX_HABIT_DESCRIPTION_LENGTH) {
    throw new Error(`Описание не должно превышать ${MAX_HABIT_DESCRIPTION_LENGTH} символов.`)
  }
  const fields = { name: input.name.trim(), description: input.description.trim() }
  switch (input.type) {
    case 'boolean':
    case 'rating':
      return { ...fields, type: input.type }
    case 'amount':
      if (!Number.isSafeInteger(input.target) || input.target <= 0) {
        throw new Error('Дневная цель должна быть положительным целым числом, не слишком большим.')
      }
      return { ...fields, type: input.type, target: input.target }
    case 'duration':
      return { ...fields, type: input.type, ratingRanges: normalizeRanges(input.ratingRanges) }
    default:
      throw new Error('Неизвестный тип привычки.')
  }
}

/** Settings change only Habit definitions. Historical entries are never rewritten. */
export class HabitSettingsService {
  constructor(private readonly database: TaskTrackerDatabase) {}

  async getHabits(): Promise<Habit[]> {
    return this.database.habits.orderBy('order').toArray()
  }

  async updateHabit(id: string, input: HabitSettingsInput): Promise<void> {
    validateId(id)
    const fields = normalizeInput(input)
    await this.database.transaction('rw', this.database.habits, async () => {
      const previous = await this.database.habits.get(id)
      if (!previous) throw new Error('Привычка не найдена. Возможно, данные были восстановлены из другой копии.')
      if (previous.type !== fields.type) throw new Error('Тип привычки нельзя изменить.')
      // Read the current row inside the transaction: a stale form must not undo
      // archival, ordering, or identity fields changed by another operation.
      const shared = { name: fields.name, description: fields.description, updatedAt: new Date().toISOString() }
      let next: Habit
      if (previous.type === 'amount' && fields.type === 'amount') {
        next = { ...previous, ...shared, target: fields.target }
      } else if (previous.type === 'duration' && fields.type === 'duration') {
        next = { ...previous, ...shared, ratingRanges: fields.ratingRanges }
      } else {
        next = { ...previous, ...shared }
      }
      await this.database.habits.put(next)
    })
  }

  async setHabitArchived(id: string, archived: boolean): Promise<void> {
    validateId(id)
    if (typeof archived !== 'boolean') throw new Error('Укажите, нужно ли архивировать привычку.')
    await this.database.transaction('rw', this.database.habits, async () => {
      const previous = await this.database.habits.get(id)
      if (!previous) throw new Error('Привычка не найдена. Возможно, данные были восстановлены из другой копии.')
      if ((previous.archivedAt !== null) === archived) return
      const now = new Date().toISOString()
      await this.database.habits.put({ ...previous, archivedAt: archived ? now : null, updatedAt: now })
    })
  }
}

const habitSettingsService = new HabitSettingsService(db)
export const getSettingsHabits = (): Promise<Habit[]> => habitSettingsService.getHabits()
export const updateHabitSettings = (id: string, input: HabitSettingsInput): Promise<void> =>
  habitSettingsService.updateHabit(id, input)
export const setHabitArchived = (id: string, archived: boolean): Promise<void> =>
  habitSettingsService.setHabitArchived(id, archived)
