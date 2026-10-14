import { db, type TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { Task, TaskInput, TaskPriority, TaskStatus } from '../models/task'

export const MAX_TASK_TITLE_LENGTH = 200
export const MAX_TASK_DESCRIPTION_LENGTH = 5000

export type TaskValidationErrors = Partial<Record<keyof TaskInput, string>>

export function getTaskValidationErrors(input: TaskInput): TaskValidationErrors {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { title: 'Введите данные задачи.' }
  }
  const errors: TaskValidationErrors = {}
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    errors.title = 'Введите название задачи.'
  } else if (input.title.trim().length > MAX_TASK_TITLE_LENGTH) {
    errors.title = `Название не должно превышать ${MAX_TASK_TITLE_LENGTH} символов.`
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    errors.description = 'Описание должно быть текстом.'
  } else if ((input.description?.trim().length ?? 0) > MAX_TASK_DESCRIPTION_LENGTH) {
    errors.description = `Описание не должно превышать ${MAX_TASK_DESCRIPTION_LENGTH} символов.`
  }
  if (typeof input.date !== 'string' || !isLocalDate(input.date)) {
    errors.date = 'Введите корректную календарную дату.'
  }
  if (input.time !== undefined && input.time !== null && input.time !== ''
    && (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))) {
    errors.time = 'Введите время в формате ЧЧ:ММ от 00:00 до 23:59.'
  }
  if (input.priority !== 'low' && input.priority !== 'medium' && input.priority !== 'high') {
    errors.priority = 'Выберите приоритет задачи.'
  }
  return errors
}

function validateDate(date: string): asserts date is LocalDate {
  if (typeof date !== 'string' || !isLocalDate(date)) throw new Error('Некорректная календарная дата.')
}

function validateId(id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0) throw new Error('Некорректный идентификатор задачи.')
}

function normalizeTaskInput(input: TaskInput): Pick<Task, 'title' | 'description' | 'date' | 'time' | 'priority'> {
  const errors = getTaskValidationErrors(input)
  const firstError = Object.values(errors)[0]
  if (firstError) throw new Error(firstError)
  validateDate(input.date)
  return {
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    date: input.date,
    time: input.time || null,
    priority: input.priority,
  }
}

const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0

/** Active tasks: date, timed before untimed, time, priority, creation, then ID. */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((first, second) => {
    if (first.status !== second.status) return first.status === 'active' ? -1 : 1
    if (first.status === 'completed') {
      return compareText(second.completedAt ?? '', first.completedAt ?? '') || compareText(first.id, second.id)
    }
    return compareText(first.date, second.date)
      || compareText(first.time ?? '24:00', second.time ?? '24:00')
      || priorityOrder[first.priority] - priorityOrder[second.priority]
      || compareText(first.createdAt, second.createdAt)
      || compareText(first.id, second.id)
  })
}

export function isTaskOverdue(task: Task, today: LocalDate = getLocalDate()): boolean {
  validateDate(today)
  validateDate(task.date)
  return task.status === 'active' && task.date < today
}

export interface TaskGroups {
  overdue: Task[]
  today: Task[]
  upcoming: Task[]
  completed: Task[]
}

export function groupTasks(tasks: readonly Task[], today: LocalDate = getLocalDate()): TaskGroups {
  validateDate(today)
  const groups: TaskGroups = { overdue: [], today: [], upcoming: [], completed: [] }
  for (const task of sortTasks(tasks)) {
    validateDate(task.date)
    if (task.status === 'completed') groups.completed.push(task)
    else if (isTaskOverdue(task, today)) groups.overdue.push(task)
    else if (task.date === today) groups.today.push(task)
    else groups.upcoming.push(task)
  }
  return groups
}

export class TaskService {
  private readonly database: TaskTrackerDatabase

  constructor(database: TaskTrackerDatabase) {
    this.database = database
  }

  async createTask(input: TaskInput): Promise<Task> {
    const fields = normalizeTaskInput(input)
    const now = new Date().toISOString()
    const task: Task = {
      ...fields, id: crypto.randomUUID(), status: 'active',
      createdAt: now, updatedAt: now, completedAt: null,
    }
    await this.database.tasks.add(task)
    return task
  }

  async updateTask(id: string, input: TaskInput): Promise<Task> {
    const fields = normalizeTaskInput(input)
    return this.mutateTask(id, (task) => ({ ...task, ...fields, updatedAt: new Date().toISOString() }))
  }

  async deleteTask(id: string): Promise<void> {
    validateId(id)
    await this.database.tasks.delete(id)
  }

  async getTask(id: string): Promise<Task | undefined> {
    validateId(id)
    return this.database.tasks.get(id)
  }

  async getTasksForDate(date: string): Promise<Task[]> {
    validateDate(date)
    return sortTasks(await this.database.tasks.where('date').equals(date).toArray())
  }

  async getTasksForDateRange(startDate: string, endDate: string): Promise<Task[]> {
    validateDate(startDate)
    validateDate(endDate)
    if (startDate > endDate) throw new Error('Начало периода не может быть позже конца.')
    return sortTasks(await this.database.tasks.where('date').between(startDate, endDate, true, true).toArray())
  }

  async getAllTasks(): Promise<Task[]> {
    return sortTasks(await this.database.tasks.toArray())
  }

  async completeTask(id: string): Promise<Task> {
    return this.setStatus(id, 'completed')
  }

  async reopenTask(id: string): Promise<Task> {
    return this.setStatus(id, 'active')
  }

  private async setStatus(id: string, status: TaskStatus): Promise<Task> {
    return this.mutateTask(id, (task) => {
      if (task.status === status) return task
      const now = new Date().toISOString()
      return { ...task, status, updatedAt: now, completedAt: status === 'completed' ? now : null }
    })
  }

  private async mutateTask(id: string, update: (task: Task) => Task): Promise<Task> {
    validateId(id)
    // Read the latest row and write in one transaction: editing cannot overwrite a
    // concurrent completion, and deleting a row cannot cause it to be resurrected.
    return this.database.transaction('rw', this.database.tasks, async () => {
      const previous = await this.database.tasks.get(id)
      if (!previous) throw new Error('Задача не найдена. Возможно, она была удалена.')
      const next = update(previous)
      if (next !== previous) await this.database.tasks.put(next)
      return next
    })
  }
}

export const taskService = new TaskService(db)
export const createTask = (input: TaskInput) => taskService.createTask(input)
export const updateTask = (id: string, input: TaskInput) => taskService.updateTask(id, input)
export const deleteTask = (id: string) => taskService.deleteTask(id)
export const getTask = (id: string) => taskService.getTask(id)
export const getTasksForDate = (date: string) => taskService.getTasksForDate(date)
export const getTasksForDateRange = (startDate: string, endDate: string) => taskService.getTasksForDateRange(startDate, endDate)
export const getAllTasks = () => taskService.getAllTasks()
export const completeTask = (id: string) => taskService.completeTask(id)
export const reopenTask = (id: string) => taskService.reopenTask(id)
