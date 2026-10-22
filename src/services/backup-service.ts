import { db, type TaskTrackerDatabase } from '../db/database'
import { getLocalDate } from '../lib/local-date'
import { BACKUP_FORMAT_VERSION, type BackupSnapshot } from '../models/backup'
import { validateBackupSnapshot } from './backup-validation'

export function parseBackupJson(text: string): BackupSnapshot {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Файл не содержит корректный JSON. Выберите резервную копию приложения.')
  }
  return validateBackupSnapshot(value)
}

export function getBackupFilename(date: Date = new Date()): string {
  return `zadachnik-backup-${getLocalDate(date)}.json`
}

export class BackupService {
  private readonly database: TaskTrackerDatabase

  constructor(database: TaskTrackerDatabase) {
    this.database = database
  }

  async exportBackup(): Promise<BackupSnapshot> {
    const { habits, habitEntries, tasks, goals, goalMilestones } = this.database
    return this.database.transaction('r', [habits, habitEntries, tasks, goals, goalMilestones], async () => {
      const [habitRows, entryRows, taskRows, goalRows, milestoneRows] = await Promise.all([
        habits.toArray(), habitEntries.toArray(), tasks.toArray(), goals.toArray(), goalMilestones.toArray(),
      ])
      return validateBackupSnapshot({
        app: 'zadachnik',
        formatVersion: BACKUP_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        data: { habits: habitRows, habitEntries: entryRows, tasks: taskRows, goals: goalRows, goalMilestones: milestoneRows },
      })
    })
  }

  async importBackup(value: unknown): Promise<void> {
    // Preview validation is not permission to write: revalidate at the service
    // boundary and detach the snapshot so callers cannot mutate pending writes.
    const { data } = validateBackupSnapshot(value)
    const { habits, habitEntries, tasks, goals, goalMilestones } = this.database
    await this.database.transaction('rw', [habits, habitEntries, tasks, goals, goalMilestones], async () => {
      await Promise.all([habits.clear(), habitEntries.clear(), tasks.clear(), goals.clear(), goalMilestones.clear()])
      await habits.bulkAdd(data.habits)
      await habitEntries.bulkAdd(data.habitEntries)
      await tasks.bulkAdd(data.tasks)
      await goals.bulkAdd(data.goals)
      await goalMilestones.bulkAdd(data.goalMilestones)
    })
  }
}

const service = new BackupService(db)
export const exportBackup = () => service.exportBackup()
export const importBackup = (snapshot: unknown) => service.importBackup(snapshot)
