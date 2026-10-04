import { db, type TaskTrackerDatabase } from '../db/database'
import { assertEditableDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import { validateDuration } from './duration-service'

export const MAX_HABIT_NOTE_LENGTH = 2000

export interface HabitEntryWithNote {
  habit: Habit
  entry: HabitEntry
}

function validateEntry(habit: Habit, entry: HabitEntry): void {
  if (habit.type !== entry.type) throw new Error('Тип записи не соответствует привычке.')
  switch (entry.type) {
    case 'boolean':
      if (!['success', 'failure', 'no-data'].includes(entry.status)) {
        throw new Error('Сохранённый результат привычки некорректен.')
      }
      break
    case 'amount':
      if (!Number.isSafeInteger(entry.value) || entry.value < 0) {
        throw new Error('Сохранённое количество некорректно.')
      }
      break
    case 'duration':
      validateDuration(entry.minutes)
      break
    case 'rating':
      if (!Number.isFinite(entry.value)) throw new Error('Сохранённая оценка некорректна.')
      break
  }
}

export class HabitNoteService {
  private readonly database: TaskTrackerDatabase

  constructor(database: TaskTrackerDatabase) {
    this.database = database
  }

  async getDayNotes(date: LocalDate): Promise<HabitEntryWithNote[]> {
    if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
    return this.database.transaction('r', this.database.habits, this.database.habitEntries, async () => {
      const habits = await this.database.habits.orderBy('order').toArray()
      const entries = new Map((await this.database.habitEntries.where('date').equals(date).toArray())
        .map((entry) => [entry.habitId, entry]))
      return habits.filter((habit) => habit.archivedAt === null).flatMap((habit) => {
        const entry = entries.get(habit.id)
        if (!entry) return []
        validateEntry(habit, entry)
        return [{ habit, entry }]
      })
    })
  }

  async setHabitEntryNote(habitId: string, date: LocalDate, note: string): Promise<void> {
    assertEditableDate(date)
    if (typeof note !== 'string') throw new Error('Заметка должна быть текстом.')
    const text = note.trim()
    if (text.length > MAX_HABIT_NOTE_LENGTH) {
      throw new Error(`Заметка не должна превышать ${MAX_HABIT_NOTE_LENGTH} символов.`)
    }
    await this.database.transaction('rw', this.database.habits, this.database.habitEntries, async () => {
      assertEditableDate(date)
      const habit = await this.database.habits.get(habitId)
      if (!habit) throw new Error('Привычка не найдена.')
      if (habit.archivedAt !== null) throw new Error('Привычка находится в архиве.')
      const previous = await this.database.habitEntries.get([habitId, date])
      if (!previous) throw new Error('Сначала сохраните результат привычки за выбранный день.')
      validateEntry(habit, previous)
      const entry: HabitEntry = { ...previous, updatedAt: new Date().toISOString() }
      if (text) entry.note = text
      else delete entry.note
      await this.database.habitEntries.put(entry)
    })
  }
}

const habitNoteService = new HabitNoteService(db)
export const getDayHabitNotes = (date: LocalDate) => habitNoteService.getDayNotes(date)
export const setHabitEntryNote = (habitId: string, date: LocalDate, note: string) =>
  habitNoteService.setHabitEntryNote(habitId, date, note)
