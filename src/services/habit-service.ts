import { db, type TaskTrackerDatabase } from '../db/database'
import { isLocalDate, type LocalDate } from '../lib/local-date'
import type { AmountHabit, BooleanHabit } from '../models/habit'
import type { BooleanHabitEntry, BooleanHabitStatus, HabitEntry } from '../models/habit-entry'

export interface BooleanHabitWithStatus {
  habit: BooleanHabit
  status: BooleanHabitStatus
}

export interface AmountHabitWithProgress {
  habit: AmountHabit
  value: number
  status: 'no-data' | 'in-progress' | 'success'
  progress: number
}

function validateDate(date: LocalDate): void {
  if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
}

function validateStatus(status: BooleanHabitStatus): void {
  if (status !== 'success' && status !== 'failure' && status !== 'no-data') {
    throw new Error('Некорректный результат привычки.')
  }
}

function validateAmountTarget(target: number): void {
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error('У привычки некорректная дневная цель.')
  }
}

function validateAmountDelta(delta: number): void {
  if (!Number.isSafeInteger(delta) || delta <= 0) {
    throw new Error('Введите положительное целое количество без дробной части. Число не должно быть слишком большим.')
  }
}

function readAmountValue(entry: HabitEntry | undefined): number {
  if (!entry) return 0
  if (entry.type !== 'amount') throw new Error('Тип сохранённой записи не соответствует привычке.')
  if (!Number.isSafeInteger(entry.value) || entry.value < 0) {
    throw new Error('Сохранённое количество некорректно. Изменения не внесены.')
  }
  return entry.value
}

export function parseAmountInput(input: string): number {
  const text = input.trim()
  if (!/^\d+$/.test(text)) {
    throw new Error('Введите положительное целое количество без дробной части.')
  }
  const value = Number(text)
  validateAmountDelta(value)
  return value
}

export class HabitService {
  private readonly database: TaskTrackerDatabase

  constructor(database: TaskTrackerDatabase) {
    this.database = database
  }

  async getTodayHabits(date: LocalDate): Promise<BooleanHabitWithStatus[]> {
    validateDate(date)

    return this.database.transaction(
      'r',
      this.database.habits,
      this.database.habitEntries,
      async () => {
        const habits = await this.database.habits.where('type').equals('boolean').toArray()
        const entries = await this.database.habitEntries.where('date').equals(date).toArray()
        const statuses = new Map(
          entries
            .filter((entry): entry is BooleanHabitEntry => entry.type === 'boolean')
            .map((entry) => [entry.habitId, entry.status]),
        )

        return habits
          .filter((habit): habit is BooleanHabit => habit.type === 'boolean' && habit.archivedAt === null)
          .sort((first, second) => first.order - second.order)
          .map((habit) => ({ habit, status: statuses.get(habit.id) ?? 'no-data' }))
      },
    )
  }

  async getTodayAmountHabits(date: LocalDate): Promise<AmountHabitWithProgress[]> {
    validateDate(date)

    return this.database.transaction(
      'r',
      this.database.habits,
      this.database.habitEntries,
      async () => {
        const habits = await this.database.habits.where('type').equals('amount').toArray()
        const entries = new Map(
          (await this.database.habitEntries.where('date').equals(date).toArray())
            .map((entry) => [entry.habitId, entry]),
        )

        return habits
          .filter((habit): habit is AmountHabit => habit.type === 'amount' && habit.archivedAt === null)
          .sort((first, second) => first.order - second.order)
          .map((habit) => {
            validateAmountTarget(habit.target)
            const value = readAmountValue(entries.get(habit.id))
            return {
              habit,
              value,
              status: value >= habit.target ? 'success' : value > 0 ? 'in-progress' : 'no-data',
              progress: Math.min(100, (value / habit.target) * 100),
            }
          })
      },
    )
  }

  async addHabitAmount(habitId: string, date: LocalDate, delta: number): Promise<void> {
    validateDate(date)
    validateAmountDelta(delta)

    // Keep the read and increment in one transaction so simultaneous additions are retained.
    await this.database.transaction(
      'rw',
      this.database.habits,
      this.database.habitEntries,
      async () => {
        const habit = await this.database.habits.get(habitId)
        if (!habit) throw new Error('Привычка не найдена.')
        if (habit.type !== 'amount') throw new Error('Эта привычка не поддерживает количественный ввод.')
        if (habit.archivedAt !== null) throw new Error('Привычка находится в архиве.')
        validateAmountTarget(habit.target)

        const previous = await this.database.habitEntries.get([habitId, date])
        const value = readAmountValue(previous) + delta
        if (!Number.isSafeInteger(value)) throw new Error('Итоговое количество слишком большое. Изменения не внесены.')
        const now = new Date().toISOString()

        await this.database.habitEntries.put({
          habitId,
          date,
          type: 'amount',
          value,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        })
      },
    )
  }

  async setBooleanHabitStatus(
    habitId: string,
    date: LocalDate,
    status: BooleanHabitStatus,
  ): Promise<void> {
    validateDate(date)
    validateStatus(status)

    await this.database.transaction(
      'rw',
      this.database.habits,
      this.database.habitEntries,
      async () => {
        const habit = await this.database.habits.get(habitId)
        if (!habit) throw new Error('Привычка не найдена.')
        if (habit.type !== 'boolean') throw new Error('Эта привычка не поддерживает отметки да/нет.')
        if (habit.archivedAt !== null) throw new Error('Привычка находится в архиве.')

        const previous = await this.database.habitEntries.get([habitId, date])
        const now = new Date().toISOString()

        await this.database.habitEntries.put({
          habitId,
          date,
          type: 'boolean',
          status,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        })
      },
    )
  }
}

const habitService = new HabitService(db)

export function getTodayHabits(date: LocalDate): Promise<BooleanHabitWithStatus[]> {
  return habitService.getTodayHabits(date)
}

export function getTodayAmountHabits(date: LocalDate): Promise<AmountHabitWithProgress[]> {
  return habitService.getTodayAmountHabits(date)
}

export function addHabitAmount(habitId: string, date: LocalDate, delta: number): Promise<void> {
  return habitService.addHabitAmount(habitId, date, delta)
}

export function setBooleanHabitStatus(
  habitId: string,
  date: LocalDate,
  status: BooleanHabitStatus,
): Promise<void> {
  return habitService.setBooleanHabitStatus(habitId, date, status)
}
