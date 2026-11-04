import Dexie, { type Table } from 'dexie'
import type { LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitEntry } from '../models/habit-entry'
import type { Task } from '../models/task'
import type { Goal, GoalMilestone } from '../models/goal'
import { createInitialHabits, createStageTenAdditionalHabits } from './seed'
import { getInitialDurationRanges } from './duration-defaults'
import { backfillHabitDefinitions, type LegacyHabit } from './habit-backfill'

export class TaskTrackerDatabase extends Dexie {
  habits!: Table<Habit, string>
  habitEntries!: Table<HabitEntry, [string, LocalDate]>
  tasks!: Table<Task, string>
  goals!: Table<Goal, string>
  goalMilestones!: Table<GoalMilestone, string>

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

    // New stores and an optional task index require no rewriting of legacy rows.
    // Existing tasks without goalId remain unlinked and all history is preserved.
    this.version(4).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
      tasks: 'id, date, status, goalId',
      goals: 'id, status, deadline',
      goalMilestones: 'id, goalId, [goalId+order]',
    })

    // Metadata backfill shares the upgrade transaction with the version change.
    // History and every other table stay untouched; reopening never reseeds.
    this.version(5).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
      tasks: 'id, date, status, goalId',
      goals: 'id, status, deadline',
      goalMilestones: 'id, goalId, [goalId+order]',
    }).upgrade(async (transaction) => {
      const habits = transaction.table<LegacyHabit>('habits')
      await habits.bulkPut(backfillHabitDefinitions(await habits.toArray(), new Date().toISOString()))
    })

    // Upgrade already released or locally tested v5 databases without rewriting rows.
    this.version(6).stores({
      habits: 'id, type, order',
      habitEntries: '[habitId+date], habitId, date, type',
      tasks: 'id, date, status, goalId',
      goals: 'id, status, deadline',
      goalMilestones: 'id, goalId, [goalId+order]',
    }).upgrade(async (transaction) => {
      const habits = transaction.table<Habit>('habits')
      const ids = new Set(await habits.toCollection().primaryKeys())
      const missing = createStageTenAdditionalHabits(new Date().toISOString()).filter((habit) => !ids.has(habit.id))
      if (missing.length > 0) await habits.bulkAdd(missing)
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
