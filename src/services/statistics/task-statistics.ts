import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { Task } from '../../models/task'
import { getTaskOutcome } from '../task-service'

export interface TaskStatistics {
  /** All tasks with a deadline in the selected inclusive local-date range. */
  tasksDue: number
  /** Known completed outcomes, failures and currently overdue tasks only. */
  relevantTasks: number
  completedOnTime: number
  completedLate: number
  completedUnknown: number
  activePending: number
  overdue: number
  failed: number
  cancelled: number
  onTimeRate: number | null
  deviationRate: number | null
}

/** Counts outcomes by deadline, not by creation or completion date. */
export function calculateTaskStatistics(
  tasks: readonly Task[],
  startDate: LocalDate,
  endDate: LocalDate,
  now: Date,
): TaskStatistics {
  if (!isLocalDate(startDate) || !isLocalDate(endDate)) throw new Error('Некорректная календарная дата.')
  if (startDate > endDate) throw new Error('Начало периода не может быть позже конца.')
  if (!Number.isFinite(now.getTime())) throw new Error('Некорректная дата.')

  const result: TaskStatistics = {
    tasksDue: 0, relevantTasks: 0, completedOnTime: 0, completedLate: 0,
    completedUnknown: 0, activePending: 0, overdue: 0, failed: 0, cancelled: 0,
    onTimeRate: null, deviationRate: null,
  }

  for (const task of tasks) {
    if (!isLocalDate(task.date)) throw new Error('Некорректная календарная дата задачи.')
    if (task.date < startDate || task.date > endDate) continue
    result.tasksDue += 1

    switch (getTaskOutcome(task, now)) {
      case 'completed_on_time':
        result.completedOnTime += 1
        break
      case 'completed_late':
        result.completedLate += 1
        break
      case 'completed_unknown':
        result.completedUnknown += 1
        break
      case 'planned':
        result.activePending += 1
        break
      case 'overdue':
        result.overdue += 1
        break
      case 'failed':
        result.failed += 1
        break
      case 'cancelled':
        result.cancelled += 1
        break
    }
  }

  // Pending tasks have no outcome yet; cancelled and unknown completions are
  // explicitly excluded rather than being interpreted as success or failure.
  result.relevantTasks = result.completedOnTime + result.completedLate + result.failed + result.overdue
  if (result.relevantTasks > 0) {
    result.onTimeRate = result.completedOnTime / result.relevantTasks * 100
    result.deviationRate = (result.completedLate + result.failed + result.overdue) / result.relevantTasks * 100
  }
  return result
}
