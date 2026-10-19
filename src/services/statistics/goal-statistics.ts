import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { Goal, GoalMilestone } from '../../models/goal'
import { calculateGoalProgress, isGoalOverdue } from '../goal-service'

export interface GoalStatistics {
  /** Current, nonarchived goals; these are not historical period totals. */
  totalGoals: number
  archivedGoals: number
  activeGoals: number
  completedGoals: number
  failedGoals: number
  cancelledGoals: number
  overdueGoals: number
  /** Current average of active goals, null when there are no active goals. */
  averageProgress: number | null
}

/**
 * Goals have no progress snapshots, so this summary deliberately has no period
 * parameter. Each goal has equal weight, using its existing progress rules.
 */
export function calculateGoalStatistics(
  goals: readonly Goal[],
  milestones: readonly GoalMilestone[],
  today: LocalDate,
): GoalStatistics {
  if (!isLocalDate(today)) throw new Error('Некорректная календарная дата.')

  const milestonesByGoal = new Map<string, GoalMilestone[]>()
  for (const milestone of milestones) {
    const group = milestonesByGoal.get(milestone.goalId) ?? []
    group.push(milestone)
    milestonesByGoal.set(milestone.goalId, group)
  }

  const result: GoalStatistics = {
    totalGoals: 0, archivedGoals: 0, activeGoals: 0, completedGoals: 0,
    failedGoals: 0, cancelledGoals: 0, overdueGoals: 0, averageProgress: null,
  }
  let activeProgress = 0

  for (const goal of goals) {
    if (goal.archived) {
      result.archivedGoals += 1
      continue
    }

    result.totalGoals += 1
    switch (goal.status) {
      case 'active':
        result.activeGoals += 1
        activeProgress += calculateGoalProgress(goal, milestonesByGoal.get(goal.id) ?? [])
        if (isGoalOverdue(goal, today)) result.overdueGoals += 1
        break
      case 'completed':
        result.completedGoals += 1
        break
      case 'failed':
        result.failedGoals += 1
        break
      case 'cancelled':
        result.cancelledGoals += 1
        break
    }
  }

  result.averageProgress = result.activeGoals === 0 ? null : activeProgress / result.activeGoals
  return result
}
