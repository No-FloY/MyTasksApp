import type { LocalDate } from '../lib/local-date'

export type GoalStatus = 'active' | 'completed' | 'failed' | 'cancelled'
export type GoalProgressMode = 'auto' | 'manual'

export interface Goal {
  id: string
  title: string
  description: string
  deadline: LocalDate | null
  status: GoalStatus
  progressMode: GoalProgressMode
  manualProgress: number
  archived: boolean
  createdAt: string
  updatedAt: string
}

/** Identity, lifecycle and archive state are changed through dedicated operations. */
export interface GoalInput {
  title: string
  description?: string
  deadline?: string | null
  progressMode: GoalProgressMode
  manualProgress: number
}

interface GoalMilestoneBase {
  id: string
  goalId: string
  title: string
  order: number
  createdAt: string
  updatedAt: string
}

export type GoalMilestone = GoalMilestoneBase & (
  | { type: 'boolean'; completed: boolean }
  | { type: 'amount'; current: number; target: number }
)

export type MilestoneInput =
  | { type: 'boolean'; title: string; completed: boolean }
  | { type: 'amount'; title: string; current: number; target: number }
