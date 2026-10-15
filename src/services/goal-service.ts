import { db, type TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { Goal, GoalInput, GoalMilestone, GoalStatus, MilestoneInput } from '../models/goal'
import type { Task } from '../models/task'
import { sortTasks } from './task-service'

export const MAX_GOAL_TITLE_LENGTH = 200
export const MAX_GOAL_DESCRIPTION_LENGTH = 5000
export const MAX_MILESTONE_TITLE_LENGTH = 200

export type GoalValidationErrors = Partial<Record<keyof GoalInput, string>>
export type MilestoneValidationErrors = Partial<Record<'title' | 'type' | 'completed' | 'current' | 'target', string>>

export function getGoalValidationErrors(input: GoalInput): GoalValidationErrors {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { title: 'Введите данные цели.' }
  }
  const errors: GoalValidationErrors = {}
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    errors.title = 'Введите название цели.'
  } else if (input.title.trim().length > MAX_GOAL_TITLE_LENGTH) {
    errors.title = `Название не должно превышать ${MAX_GOAL_TITLE_LENGTH} символов.`
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    errors.description = 'Описание должно быть текстом.'
  } else if ((input.description?.trim().length ?? 0) > MAX_GOAL_DESCRIPTION_LENGTH) {
    errors.description = `Описание не должно превышать ${MAX_GOAL_DESCRIPTION_LENGTH} символов.`
  }
  if (input.deadline !== undefined && input.deadline !== null && input.deadline !== ''
    && (typeof input.deadline !== 'string' || !isLocalDate(input.deadline))) {
    errors.deadline = 'Введите корректную календарную дату.'
  }
  if (input.progressMode !== 'auto' && input.progressMode !== 'manual') {
    errors.progressMode = 'Выберите режим прогресса.'
  }
  if (!Number.isFinite(input.manualProgress) || input.manualProgress < 0 || input.manualProgress > 100) {
    errors.manualProgress = 'Прогресс должен быть числом от 0 до 100.'
  }
  return errors
}

function isAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
}

export function getMilestoneValidationErrors(input: MilestoneInput): MilestoneValidationErrors {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { title: 'Введите данные этапа.' }
  }
  const errors: MilestoneValidationErrors = {}
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    errors.title = 'Введите название этапа.'
  } else if (input.title.trim().length > MAX_MILESTONE_TITLE_LENGTH) {
    errors.title = `Название не должно превышать ${MAX_MILESTONE_TITLE_LENGTH} символов.`
  }
  if (input.type === 'boolean') {
    if (typeof input.completed !== 'boolean') errors.completed = 'Выберите состояние этапа.'
  } else if (input.type === 'amount') {
    if (!isAmount(input.current)) errors.current = 'Укажите неотрицательное число в пределах безопасной точности.'
    if (!isAmount(input.target) || input.target === 0) errors.target = 'Целевое значение должно быть больше нуля и в пределах безопасной точности.'
  } else {
    errors.type = 'Выберите тип этапа.'
  }
  return errors
}

function validateId(id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0) throw new Error('Некорректный идентификатор.')
}

function validateDate(date: string): asserts date is LocalDate {
  if (typeof date !== 'string' || !isLocalDate(date)) throw new Error('Некорректная календарная дата.')
}

function normalizeGoalInput(input: GoalInput): Pick<Goal, 'title' | 'description' | 'deadline' | 'progressMode' | 'manualProgress'> {
  const error = Object.values(getGoalValidationErrors(input))[0]
  if (error) throw new Error(error)
  const deadline = input.deadline || null
  if (deadline !== null) validateDate(deadline)
  return {
    title: input.title.trim(), description: input.description?.trim() ?? '', deadline,
    progressMode: input.progressMode, manualProgress: input.manualProgress,
  }
}

function normalizeMilestoneInput(input: MilestoneInput): MilestoneInput {
  const error = Object.values(getMilestoneValidationErrors(input))[0]
  if (error) throw new Error(error)
  const title = input.title.trim()
  return input.type === 'boolean'
    ? { title, type: 'boolean', completed: input.completed }
    : { title, type: 'amount', current: input.current, target: input.target }
}

export function isMilestoneCompleted(milestone: GoalMilestone): boolean {
  const error = Object.values(getMilestoneValidationErrors(milestone))[0]
  if (error) throw new Error(error)
  return milestone.type === 'boolean' ? milestone.completed : milestone.current >= milestone.target
}

/** Status is explicit and independent of progress; completed goals retain their actual results. */
export function calculateGoalProgress(goal: Goal, milestones: readonly GoalMilestone[]): number {
  if (goal.progressMode === 'manual') {
    if (!Number.isFinite(goal.manualProgress) || goal.manualProgress < 0 || goal.manualProgress > 100) {
      throw new Error('Прогресс должен быть числом от 0 до 100.')
    }
    return goal.manualProgress
  }
  if (goal.progressMode !== 'auto') throw new Error('Выберите режим прогресса.')
  const ownMilestones = milestones.filter((milestone) => milestone.goalId === goal.id)
  if (ownMilestones.length === 0) return 0
  const total = ownMilestones.reduce((sum, milestone) => {
    const completed = isMilestoneCompleted(milestone)
    return sum + (completed ? 1 : milestone.type === 'amount' ? milestone.current / milestone.target : 0)
  }, 0)
  return Math.min(100, total / ownMilestones.length * 100)
}

export function isGoalOverdue(goal: Goal, today: LocalDate = getLocalDate()): boolean {
  validateDate(today)
  if (goal.deadline === null) return false
  validateDate(goal.deadline)
  return goal.status === 'active' && goal.deadline < today
}

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0
const sortGoals = (goals: Goal[]) => goals.sort((first, second) => compareText(second.createdAt, first.createdAt) || compareText(first.id, second.id))
const sortMilestones = (milestones: GoalMilestone[]) => milestones.sort((first, second) => first.order - second.order || compareText(first.id, second.id))

export interface GoalDetails {
  goal: Goal
  milestones: GoalMilestone[]
  tasks: Task[]
}

export interface GoalWithProgress {
  goal: Goal
  progress: number
  completedMilestones: number
  totalMilestones: number
}

export class GoalService {
  private readonly database: TaskTrackerDatabase

  constructor(database: TaskTrackerDatabase) {
    this.database = database
  }

  async getGoals(): Promise<Goal[]> {
    return sortGoals(await this.database.goals.toArray())
  }

  async getGoalsWithProgress(): Promise<GoalWithProgress[]> {
    return this.database.transaction('r', this.database.goals, this.database.goalMilestones, async () => {
      const goals = await this.getGoals()
      const allMilestones = await this.database.goalMilestones.toArray()
      const grouped = new Map<string, GoalMilestone[]>()
      for (const milestone of allMilestones) {
        const group = grouped.get(milestone.goalId) ?? []
        group.push(milestone)
        grouped.set(milestone.goalId, group)
      }
      return goals.map((goal) => {
        const milestones = grouped.get(goal.id) ?? []
        return {
          goal, progress: calculateGoalProgress(goal, milestones),
          totalMilestones: milestones.length,
          completedMilestones: milestones.filter(isMilestoneCompleted).length,
        }
      })
    })
  }

  async getGoalDetails(id: string): Promise<GoalDetails | null> {
    validateId(id)
    return this.database.transaction('r', this.database.goals, this.database.goalMilestones, this.database.tasks, async () => {
      const goal = await this.database.goals.get(id)
      if (!goal) return null
      const milestones = await this.database.goalMilestones.where('goalId').equals(id).toArray()
      const tasks = await this.database.tasks.where('goalId').equals(id).toArray()
      return { goal, milestones: sortMilestones(milestones), tasks: sortTasks(tasks) }
    })
  }

  async createGoal(input: GoalInput): Promise<Goal> {
    const fields = normalizeGoalInput(input)
    const now = new Date().toISOString()
    const goal: Goal = {
      ...fields, id: crypto.randomUUID(), status: 'active', archived: false,
      createdAt: now, updatedAt: now,
    }
    await this.database.goals.add(goal)
    return goal
  }

  async updateGoal(id: string, input: GoalInput): Promise<Goal> {
    const fields = normalizeGoalInput(input)
    return this.mutateGoal(id, (goal) => ({ ...goal, ...fields, updatedAt: new Date().toISOString() }))
  }

  async setGoalStatus(id: string, status: GoalStatus): Promise<Goal> {
    if (!['active', 'completed', 'failed', 'cancelled'].includes(status)) throw new Error('Выберите статус цели.')
    return this.mutateGoal(id, (goal) => goal.status === status ? goal : { ...goal, status, updatedAt: new Date().toISOString() })
  }

  async setGoalArchived(id: string, archived: boolean): Promise<Goal> {
    if (typeof archived !== 'boolean') throw new Error('Некорректное состояние архива.')
    return this.mutateGoal(id, (goal) => goal.archived === archived ? goal : { ...goal, archived, updatedAt: new Date().toISOString() })
  }

  async deleteGoal(id: string): Promise<void> {
    validateId(id)
    await this.database.transaction('rw', this.database.goals, this.database.goalMilestones, this.database.tasks, async () => {
      const now = new Date().toISOString()
      await this.database.tasks.where('goalId').equals(id).modify((task) => {
        delete task.goalId
        task.updatedAt = now
      })
      await this.database.goalMilestones.where('goalId').equals(id).delete()
      await this.database.goals.delete(id)
    })
  }

  async addMilestone(goalId: string, input: MilestoneInput): Promise<GoalMilestone> {
    validateId(goalId)
    const fields = normalizeMilestoneInput(input)
    return this.database.transaction('rw', this.database.goals, this.database.goalMilestones, async () => {
      const goal = await this.requireGoal(goalId)
      const last = await this.database.goalMilestones.where('[goalId+order]')
        .between([goalId, 0], [goalId, Number.MAX_SAFE_INTEGER], true, true).last()
      const order = last ? last.order + 1 : 0
      if (!Number.isSafeInteger(order)) throw new Error('Невозможно добавить ещё один этап.')
      const now = new Date().toISOString()
      const milestone: GoalMilestone = { ...fields, id: crypto.randomUUID(), goalId, order, createdAt: now, updatedAt: now }
      await this.database.goalMilestones.add(milestone)
      await this.database.goals.put({ ...goal, updatedAt: now })
      return milestone
    })
  }

  async updateMilestone(id: string, input: MilestoneInput): Promise<GoalMilestone> {
    const fields = normalizeMilestoneInput(input)
    return this.mutateMilestone(id, (milestone) => {
      // Completion has a dedicated operation so a stale title editor cannot undo a toggle.
      const content = fields.type === 'boolean' && milestone.type === 'boolean'
        ? { ...fields, completed: milestone.completed } : fields
      return {
        ...content, id: milestone.id, goalId: milestone.goalId, order: milestone.order,
        createdAt: milestone.createdAt, updatedAt: new Date().toISOString(),
      }
    })
  }

  async setMilestoneCompleted(id: string, completed: boolean): Promise<GoalMilestone> {
    if (typeof completed !== 'boolean') throw new Error('Выберите состояние этапа.')
    return this.mutateMilestone(id, (milestone) => {
      if (milestone.type !== 'boolean') throw new Error('Для числового этапа измените текущее значение.')
      return milestone.completed === completed ? milestone : { ...milestone, completed, updatedAt: new Date().toISOString() }
    })
  }

  async deleteMilestone(id: string): Promise<void> {
    validateId(id)
    await this.database.transaction('rw', this.database.goals, this.database.goalMilestones, async () => {
      const milestone = await this.database.goalMilestones.get(id)
      if (!milestone) return
      const goal = await this.requireGoal(milestone.goalId)
      await this.database.goalMilestones.delete(id)
      await this.database.goals.put({ ...goal, updatedAt: new Date().toISOString() })
    })
  }

  async linkTask(goalId: string, taskId: string): Promise<Task> {
    validateId(goalId)
    validateId(taskId)
    return this.database.transaction('rw', this.database.goals, this.database.tasks, async () => {
      const goal = await this.requireGoal(goalId)
      const task = await this.requireTask(taskId)
      if (task.goalId === goalId) return task
      if (task.goalId) throw new Error('Задача уже связана с другой целью. Сначала отвяжите её.')
      const now = new Date().toISOString()
      const next = { ...task, goalId, updatedAt: now }
      await this.database.tasks.put(next)
      await this.database.goals.put({ ...goal, updatedAt: now })
      return next
    })
  }

  async unlinkTask(goalId: string, taskId: string): Promise<Task> {
    validateId(goalId)
    validateId(taskId)
    return this.database.transaction('rw', this.database.goals, this.database.tasks, async () => {
      const goal = await this.requireGoal(goalId)
      const task = await this.requireTask(taskId)
      if (task.goalId !== goalId) return task
      const now = new Date().toISOString()
      const next = { ...task, updatedAt: now }
      delete next.goalId
      await this.database.tasks.put(next)
      await this.database.goals.put({ ...goal, updatedAt: now })
      return next
    })
  }

  private async requireGoal(id: string): Promise<Goal> {
    const goal = await this.database.goals.get(id)
    if (!goal) throw new Error('Цель не найдена. Возможно, она была удалена.')
    return goal
  }

  private async requireTask(id: string): Promise<Task> {
    const task = await this.database.tasks.get(id)
    if (!task) throw new Error('Задача не найдена. Возможно, она была удалена.')
    return task
  }

  private async mutateGoal(id: string, update: (goal: Goal) => Goal): Promise<Goal> {
    validateId(id)
    return this.database.transaction('rw', this.database.goals, async () => {
      const previous = await this.requireGoal(id)
      const next = update(previous)
      if (next !== previous) await this.database.goals.put(next)
      return next
    })
  }

  private async mutateMilestone(id: string, update: (milestone: GoalMilestone) => GoalMilestone): Promise<GoalMilestone> {
    validateId(id)
    return this.database.transaction('rw', this.database.goals, this.database.goalMilestones, async () => {
      const previous = await this.database.goalMilestones.get(id)
      if (!previous) throw new Error('Этап не найден. Возможно, он был удалён.')
      const goal = await this.requireGoal(previous.goalId)
      const next = update(previous)
      if (next !== previous) {
        await this.database.goalMilestones.put(next)
        await this.database.goals.put({ ...goal, updatedAt: next.updatedAt })
      }
      return next
    })
  }
}

export const goalService = new GoalService(db)
