import type { LocalDate } from '../lib/local-date'

export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskStatus = 'active' | 'completed'

export interface Task {
  id: string
  title: string
  description: string
  date: LocalDate
  time: string | null
  priority: TaskPriority
  status: TaskStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

/** Editable fields only: identity and completion are owned by the service. */
export interface TaskInput {
  title: string
  description?: string
  date: string
  time?: string | null
  priority: TaskPriority
}
