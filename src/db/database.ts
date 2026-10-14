import Dexie, { type Table } from 'dexie'
import type { LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import type { Task } from '../models/task'
import { createInitialHabits } from './seed'
import { getInitialDurationRanges } from './duration-defaults'

export class TaskTrackerDatabase extends Dexie {
  habits!: Table<Habit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>
  tasks!: Table<Task, string>

  constructor(name: string = 'zadachnik') {
    super(name)

    this.version(1).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
    })

    this.version(2).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
    }).upgrade(async (transaction) => {
      await transaction.table<Habit>('habits').where('id').anyOf('gaming', 'social-media')
        .modify((habit) => {
          if (habit.type === 'duration' && habit.ratingRanges === undefined) {
            habit.ratingRanges = getInitialDurationRanges(habit.id)
          }
        })
    })

    // Adding a store leaves all existing habit definitions and history untouched.
    this.version(3).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
      tasks: 'id, date, status',
    })

    // populate runs once, in the creation transaction. Reopening never resets data.
    this.on('populate', async (transaction) => {
      await transaction.table<Habit>('habits').bulkAdd(createInitialHabits())
    })
  }
}

export const db = new TaskTrackerDatabase()

export async function initializeDatabase(): Promise<void> {
  if (typeof globalThis.indexedDB === 'undefined') {
    throw new Error('Этот браузер не поддерживает IndexedDB.')
  }
  await db.open()
}
