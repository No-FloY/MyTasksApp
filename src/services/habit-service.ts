import { db, type TaskTrackerDatabase } from '../db/database'
import { isLocalDate, type LocalDate } from '../lib/local-date'
import type { BooleanHabit } from '../models/habit'
import type { BooleanHabitEntry, BooleanHabitStatus } from '../models/habit-entry'

export interface BooleanHabitWithStatus {
  habit: BooleanHabit
  status: BooleanHabitStatus
}

function validateDate(date: LocalDate): void {
  if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
}

function validateStatus(status: BooleanHabitStatus): void {
  if (status !== 'success' && status !== 'failure' && status !== 'no-data') {
    throw new Error('Некорректный результат привычки.')
  }
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

export function setBooleanHabitStatus(
  habitId: string,
  date: LocalDate,
  status: BooleanHabitStatus,
): Promise<void> {
  return habitService.setBooleanHabitStatus(habitId, date, status)
}
