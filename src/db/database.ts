import Dexie, { type Table } from 'dexie'
import type { LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import { createInitialHabits } from './seed'

export class TaskTrackerDatabase extends Dexie {
  habits!: Table<Habit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>

  constructor(name: string = 'zadachnik') {
    super(name)

    this.version(1).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
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
