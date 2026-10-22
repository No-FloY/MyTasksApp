import type { Goal, GoalMilestone } from './goal'
import type { Habit } from './habit'
import type { HabitEntry } from './habit-entry'
import type { Task } from './task'

/** Backup compatibility is independent of the IndexedDB schema version. */
export const BACKUP_FORMAT_VERSION = 1

export interface BackupData {
  habits: Habit[]
  habitEntries: HabitEntry[]
  tasks: Task[]
  goals: Goal[]
  goalMilestones: GoalMilestone[]
}

export interface BackupSnapshot {
  app: 'zadachnik'
  formatVersion: typeof BACKUP_FORMAT_VERSION
  exportedAt: string
  data: BackupData
}
