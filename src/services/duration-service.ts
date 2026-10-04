import { db, type TaskTrackerDatabase } from '../db/database'
import { isLocalDate, type LocalDate } from '../lib/local-date'
import type { DurationHabit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import type { DurationRatingRange } from '../models/duration-rating'

export interface DurationHabitWithRating {
  habit: DurationHabit
  minutes: number | null
  rating: DurationRatingRange | null
}

export interface DurationInput {
  hours: string
  minutes: string
}

export function validateDuration(minutes: number): void {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error('Укажите время от 0 до 24 часов за день, с точностью до минуты.')
  }
}

export function validateRatingRanges(ranges: DurationRatingRange[]): void {
  if (!Array.isArray(ranges) || ranges.length === 0) throw new Error('Не настроены диапазоны оценок.')
  const ids = new Set<string>()
  let next = 0
  for (const [index, range] of ranges.entries()) {
    if (!range || typeof range.id !== 'string' || !range.id.trim() || ids.has(range.id)
      || typeof range.label !== 'string' || !range.label.trim()
      || typeof range.emoji !== 'string' || !range.emoji.trim()
      || !Number.isSafeInteger(range.minMinutes) || range.minMinutes !== next) {
      throw new Error('Диапазоны оценок должны идти без пропусков и пересечений.')
    }
    ids.add(range.id)
    if (range.maxMinutes === null) {
      if (index !== ranges.length - 1) throw new Error('Открытый диапазон должен быть последним.')
    } else {
      if (!Number.isSafeInteger(range.maxMinutes) || range.maxMinutes < next
        || range.maxMinutes >= Number.MAX_SAFE_INTEGER || index === ranges.length - 1) {
        throw new Error('Некорректная верхняя граница оценки.')
      }
      next = range.maxMinutes + 1
    }
  }
}

export function getDurationRating(minutes: number, ranges: DurationRatingRange[]): DurationRatingRange {
  validateDuration(minutes)
  validateRatingRanges(ranges)
  const rating = ranges.find((range) => minutes >= range.minMinutes
    && (range.maxMinutes === null || minutes <= range.maxMinutes))
  if (!rating) throw new Error('Для времени не найдена оценка.')
  return rating
}

export function parseDurationInput(hours: string, minutes: string): number {
  const hourText = hours.trim()
  const minuteText = minutes.trim()
  if ((!hourText && !minuteText) || (hourText && !/^\d+$/.test(hourText))
    || (minuteText && !/^\d+$/.test(minuteText))) {
    throw new Error('Введите целые неотрицательные часы и минуты. Для нуля укажите 0.')
  }
  const hourValue = Number(hourText || '0')
  const minuteValue = Number(minuteText || '0')
  if (!Number.isSafeInteger(hourValue) || hourValue > 24) throw new Error('Часы: целое число от 0 до 24.')
  if (!Number.isSafeInteger(minuteValue) || minuteValue > 59) throw new Error('Минуты: целое число от 0 до 59.')
  const total = hourValue * 60 + minuteValue
  validateDuration(total)
  return total
}

/** Averages are rounded only for display; stored values and calculations retain precision. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error('Некорректное время.')
  const rounded = Math.round(minutes)
  return `${Math.floor(rounded / 60)} ч ${rounded % 60} мин`
}

export function getDurationInput(minutes: number | null): DurationInput {
  if (minutes === null) return { hours: '', minutes: '' }
  validateDuration(minutes)
  return { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) }
}

export function readDurationMinutes(entry: HabitEntry | undefined): number | null {
  if (!entry) return null
  if (entry.type !== 'duration') throw new Error('Тип записи не соответствует привычке.')
  validateDuration(entry.minutes)
  return entry.minutes
}

export class DurationService {
  private readonly database: TaskTrackerDatabase

  constructor(database: TaskTrackerDatabase) {
    this.database = database
  }

  async getTodayDurationHabits(date: LocalDate): Promise<DurationHabitWithRating[]> {
    if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
    return this.database.transaction('r', this.database.habits, this.database.habitEntries, async () => {
      const habits = await this.database.habits.where('type').equals('duration').toArray()
      const entries = new Map((await this.database.habitEntries.where('date').equals(date).toArray())
        .map((entry) => [entry.habitId, entry]))
      return habits.filter((habit): habit is DurationHabit => habit.type === 'duration' && habit.archivedAt === null)
        .sort((a, b) => a.order - b.order)
        .map((habit) => {
          validateRatingRanges(habit.ratingRanges)
          const minutes = readDurationMinutes(entries.get(habit.id))
          return { habit, minutes, rating: minutes === null ? null : getDurationRating(minutes, habit.ratingRanges) }
        })
    })
  }

  async setHabitDuration(habitId: string, date: LocalDate, minutes: number): Promise<void> {
    if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
    validateDuration(minutes)
    await this.database.transaction('rw', this.database.habits, this.database.habitEntries, async () => {
      const habit = await this.database.habits.get(habitId)
      if (!habit || habit.type !== 'duration') throw new Error('Привычка не поддерживает ввод времени.')
      if (habit.archivedAt !== null) throw new Error('Привычка находится в архиве.')
      validateRatingRanges(habit.ratingRanges)
      const previous = await this.database.habitEntries.get([habitId, date])
      readDurationMinutes(previous)
      const now = new Date().toISOString()
      await this.database.habitEntries.put({
        habitId, date, type: 'duration', minutes,
        createdAt: previous?.createdAt ?? now, updatedAt: now,
      })
    })
  }
}

const service = new DurationService(db)
export const getTodayDurationHabits = (date: LocalDate) => service.getTodayDurationHabits(date)
export const setHabitDuration = (habitId: string, date: LocalDate, minutes: number) =>
  service.setHabitDuration(habitId, date, minutes)
