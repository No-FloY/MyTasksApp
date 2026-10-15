import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../db/database'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { Goal, GoalInput, GoalMilestone, GoalStatus, MilestoneInput } from '../models/goal'
import { TaskService } from './task-service'
import {
  calculateGoalProgress, getGoalValidationErrors, getMilestoneValidationErrors, GoalService,
  isGoalOverdue, isMilestoneCompleted, MAX_GOAL_DESCRIPTION_LENGTH, MAX_GOAL_TITLE_LENGTH,
  MAX_MILESTONE_TITLE_LENGTH,
} from './goal-service'

const timestamp = '2026-10-15T09:00:00.000Z'
const input: GoalInput = { title: 'Найти работу', progressMode: 'auto', manualProgress: 0 }
const booleanInput: MilestoneInput = { title: 'Резюме', type: 'boolean', completed: false }

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

function goalFixture(fields: Partial<Goal> = {}): Goal {
  return {
    ...input, id: 'goal', description: '', deadline: null, status: 'active', archived: false,
    createdAt: timestamp, updatedAt: timestamp, ...fields,
  }
}

function milestoneFixture(fields: MilestoneInput = booleanInput, goalId = 'goal'): GoalMilestone {
  return { ...fields, id: crypto.randomUUID(), goalId, order: 0, createdAt: timestamp, updatedAt: timestamp }
}

describe('goal progress and local deadlines', () => {
  it('uses zero for automatic progress with no milestones, including completed goals', () => {
    expect(calculateGoalProgress(goalFixture(), [])).toBe(0)
    expect(calculateGoalProgress(goalFixture({ status: 'completed' }), [])).toBe(0)
  })

  it('averages boolean and capped amount ratios with equal weights without rounding', () => {
    const milestones = [
      milestoneFixture({ ...booleanInput, completed: true }),
      milestoneFixture({ type: 'amount', title: 'Отклики', current: 17, target: 30 }),
      milestoneFixture({ type: 'amount', title: 'Встречи', current: 2, target: 5 }),
      milestoneFixture(),
    ]
    const before = structuredClone(milestones)
    expect(calculateGoalProgress(goalFixture(), milestones)).toBeCloseTo((1 + 17 / 30 + 2 / 5) / 4 * 100)
    expect(milestones).toEqual(before)
  })

  it.each([
    [0, 30, 0, false], [15, 30, 50, false], [30, 30, 100, true],
    [45, 30, 100, true], [0.5, 2, 25, false], [Number.MAX_SAFE_INTEGER, 1, 100, true],
  ])('calculates amount %s / %s without changing stored current', (current, target, expected, completed) => {
    const milestone = milestoneFixture({ type: 'amount', title: 'Числовой этап', current, target })
    expect(calculateGoalProgress(goalFixture(), [milestone])).toBe(expected)
    expect(isMilestoneCompleted(milestone)).toBe(completed)
    expect(milestone).toMatchObject({ current, target })
  })

  it('caps each milestone separately and ignores milestones belonging to another goal', () => {
    const milestones = [
      milestoneFixture({ type: 'amount', title: 'Перевыполнен', current: 1000, target: 10 }),
      milestoneFixture(), milestoneFixture({ ...booleanInput, completed: true }, 'other-goal'),
    ]
    expect(calculateGoalProgress(goalFixture(), milestones)).toBe(50)
  })

  it.each([0, 45.5, 100])('retains manual progress %s regardless of milestones', (manualProgress) => {
    expect(calculateGoalProgress(goalFixture({ progressMode: 'manual', manualProgress }), [milestoneFixture()])).toBe(manualProgress)
    expect(calculateGoalProgress(goalFixture({ progressMode: 'manual', manualProgress }), [])).toBe(manualProgress)
  })

  it.each(['active', 'completed', 'failed', 'cancelled'] as const)('keeps actual progress independent from status %s', (status) => {
    expect(calculateGoalProgress(goalFixture({ status }), [milestoneFixture(), milestoneFixture({ ...booleanInput, completed: true })])).toBe(50)
    expect(calculateGoalProgress(goalFixture({ status, progressMode: 'manual', manualProgress: 42 }), [])).toBe(42)
  })

  it('does not produce NaN or Infinity for invalid persisted values', () => {
    expect(() => calculateGoalProgress(goalFixture({ progressMode: 'manual', manualProgress: NaN }), [])).toThrow()
    expect(() => calculateGoalProgress(goalFixture(), [milestoneFixture({ type: 'amount', title: 'Сломан', current: 0, target: 0 })])).toThrow()
    expect(() => isMilestoneCompleted(milestoneFixture({ type: 'amount', title: 'Сломан', current: Infinity, target: 1 }))).toThrow()
  })

  it('derives overdue only for active goals before today; absent, today and future deadlines are not overdue', () => {
    const today = date('2026-10-15')
    expect(isGoalOverdue(goalFixture(), today)).toBe(false)
    expect(isGoalOverdue(goalFixture({ deadline: date('2026-10-14') }), today)).toBe(true)
    expect(isGoalOverdue(goalFixture({ deadline: today }), today)).toBe(false)
    expect(isGoalOverdue(goalFixture({ deadline: date('2026-10-16') }), today)).toBe(false)
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(isGoalOverdue(goalFixture({ status, deadline: date('2026-10-14') }), today)).toBe(false)
    }
  })

  it('rejects malformed dates rather than silently misclassifying a deadline', () => {
    expect(() => isGoalOverdue(goalFixture(), 'invalid' as LocalDate)).toThrow('календарная дата')
    expect(() => isGoalOverdue(goalFixture({ deadline: '2026-02-30' as LocalDate }))).toThrow('календарная дата')
  })
})

describe('GoalService persistence, validation and task relations', () => {
  let database: TaskTrackerDatabase
  let service: GoalService
  let taskService: TaskService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(timestamp))
    database = new TaskTrackerDatabase(`zadachnik-goal-test-${crypto.randomUUID()}`)
    service = new GoalService(database)
    taskService = new TaskService(database)
    await database.open()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await database.delete()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  async function createTask() {
    return taskService.createTask({ title: 'Отправить резюме', date: '2026-10-15', priority: 'high' })
  }

  async function withOtherConnection(work: (other: GoalService, tasks: TaskService) => Promise<void>) {
    const other = new TaskTrackerDatabase(database.name)
    try {
      await other.open()
      await work(new GoalService(other), new TaskService(other))
    } finally {
      other.close()
    }
  }

  it('creates unique goals with defaults and preserves habit data', async () => {
    const habits = await database.habits.toArray()
    const first = await service.createGoal(input)
    const second = await service.createGoal(input)
    expect(first).toEqual({ ...goalFixture(), id: expect.any(String) })
    expect(first.id).not.toBe(second.id)
    expect(await service.getGoalDetails(first.id)).toEqual({ goal: first, milestones: [], tasks: [] })
    expect(await database.habits.toArray()).toEqual(habits)
    expect(await database.habitEntries.count()).toBe(0)
    expect(await database.tasks.count()).toBe(0)
  })

  it('trims titles/descriptions, retains newlines, stores local deadline and ignores protected fields', async () => {
    const goal = await service.createGoal({
      ...input, title: '  Найти работу  ', description: '  План\n  Второй шаг  ', deadline: '2026-12-31',
      id: 'injected', status: 'completed', archived: true,
    } as GoalInput)
    expect(goal).toMatchObject({ title: input.title, description: 'План\n  Второй шаг', deadline: '2026-12-31', status: 'active', archived: false })
    expect(goal.id).not.toBe('injected')
    expect(await service.updateGoal(goal.id, { ...input, id: 'changed', status: 'failed', archived: true } as GoalInput))
      .toMatchObject({ id: goal.id, status: 'active', archived: false, deadline: null, description: '', createdAt: goal.createdAt })
  })

  it.each([
    ['empty title', { title: ' \n ' }, 'title'], ['non-string title', { title: 42 }, 'title'],
    ['long title', { title: 'я'.repeat(MAX_GOAL_TITLE_LENGTH + 1) }, 'title'],
    ['non-string description', { description: null }, 'description'],
    ['long description', { description: 'я'.repeat(MAX_GOAL_DESCRIPTION_LENGTH + 1) }, 'description'],
    ['impossible date', { deadline: '2026-02-30' }, 'deadline'], ['UTC timestamp', { deadline: timestamp }, 'deadline'],
    ['non-string date', { deadline: 20261015 }, 'deadline'], ['unknown mode', { progressMode: 'other' }, 'progressMode'],
    ['negative manual', { manualProgress: -1 }, 'manualProgress'], ['large manual', { manualProgress: 101 }, 'manualProgress'],
    ['nan manual', { manualProgress: NaN }, 'manualProgress'], ['infinite manual', { manualProgress: Infinity }, 'manualProgress'],
    ['non-numeric manual', { manualProgress: '50' }, 'manualProgress'],
  ])('rejects %s at create and update without partial writes', async (_label, changes, field) => {
    const invalid = { ...input, ...changes } as GoalInput
    expect(getGoalValidationErrors(invalid)).toHaveProperty(field)
    await expect(service.createGoal(invalid)).rejects.toThrow()
    expect(await service.getGoals()).toEqual([])
    const goal = await service.createGoal(input)
    await expect(service.updateGoal(goal.id, invalid)).rejects.toThrow()
    expect((await service.getGoalDetails(goal.id))?.goal).toEqual(goal)
  })

  it.each([null, undefined, [], 'goal'])('rejects malformed runtime goal input %s', async (value) => {
    await expect(service.createGoal(value as unknown as GoalInput)).rejects.toThrow('Введите данные цели')
    expect(await service.getGoals()).toEqual([])
  })

  it('accepts exact input lengths and optional deadline values', async () => {
    const goal = await service.createGoal({ ...input, title: 'я'.repeat(MAX_GOAL_TITLE_LENGTH), description: 'я'.repeat(MAX_GOAL_DESCRIPTION_LENGTH) })
    for (const deadline of [null, '', undefined]) {
      const fields: GoalInput = { ...input }
      if (deadline !== undefined) fields.deadline = deadline
      expect((await service.updateGoal(goal.id, fields)).deadline).toBeNull()
    }
  })

  it('supports all lifecycle statuses, archives without deleting data, and preserves actual progress', async () => {
    const goal = await service.createGoal({ ...input, progressMode: 'manual', manualProgress: 35 })
    const milestone = await service.addMilestone(goal.id, booleanInput)
    for (const status of ['completed', 'failed', 'cancelled', 'active'] as const) {
      vi.setSystemTime(new Date(2026, 9, 15, 14))
      const changed = await service.setGoalStatus(goal.id, status)
      expect(changed.status).toBe(status)
      expect(calculateGoalProgress(changed, [milestone])).toBe(35)
      vi.setSystemTime(new Date(2026, 9, 15, 15))
      expect(await service.setGoalStatus(goal.id, status)).toEqual(changed)
    }
    const archived = await service.setGoalArchived(goal.id, true)
    expect(await service.getGoals()).toEqual([archived])
    expect((await service.getGoalDetails(goal.id))?.milestones).toEqual([milestone])
    expect(await service.setGoalArchived(goal.id, true)).toEqual(archived)
    expect((await service.setGoalArchived(goal.id, false)).archived).toBe(false)
    await expect(service.setGoalStatus(goal.id, 'overdue' as GoalStatus)).rejects.toThrow()
    await expect(service.setGoalArchived(goal.id, 'yes' as unknown as boolean)).rejects.toThrow()
  })

  it('supports boolean toggling and amount editing, retains order and removes incompatible fields on type changes', async () => {
    const goal = await service.createGoal(input)
    const first = await service.addMilestone(goal.id, booleanInput)
    const second = await service.addMilestone(goal.id, { title: 'Отклики', type: 'amount', current: 17, target: 30 })
    const third = await service.addMilestone(goal.id, booleanInput)
    expect([first.order, second.order, third.order]).toEqual([0, 1, 2])
    expect(isMilestoneCompleted(await service.setMilestoneCompleted(first.id, true))).toBe(true)
    expect(isMilestoneCompleted(await service.setMilestoneCompleted(first.id, false))).toBe(false)
    const changed = await service.updateMilestone(second.id, { type: 'amount', title: ' Отклики отправлены ', current: 45, target: 30 })
    expect(changed).toMatchObject({ title: 'Отклики отправлены', current: 45, order: 1, createdAt: second.createdAt })
    expect(isMilestoneCompleted(changed)).toBe(true)
    await expect(service.setMilestoneCompleted(second.id, true)).rejects.toThrow('числового')
    const converted = await service.updateMilestone(first.id, { type: 'amount', title: 'Резюме', current: 0.5, target: 2 })
    expect(converted).not.toHaveProperty('completed')
    const back = await service.updateMilestone(first.id, { ...booleanInput, completed: true })
    expect(back).not.toHaveProperty('current')
    expect(back).not.toHaveProperty('target')
    expect(isMilestoneCompleted(back)).toBe(true)
    await service.deleteMilestone(second.id)
    const appended = await service.addMilestone(goal.id, booleanInput)
    expect((await service.getGoalDetails(goal.id))?.milestones.map(({ id, order }) => ({ id, order })))
      .toEqual([{ id: first.id, order: 0 }, { id: third.id, order: 2 }, { id: appended.id, order: 3 }])
  })

  it.each([
    { title: '' }, { title: 'я'.repeat(MAX_MILESTONE_TITLE_LENGTH + 1) }, { type: 'other' },
    { completed: 1 }, { type: 'amount', current: -1, target: 1 }, { type: 'amount', current: 0, target: 0 },
    { type: 'amount', current: NaN, target: 1 }, { type: 'amount', current: 0, target: Infinity },
    { type: 'amount', current: Infinity, target: 1 }, { type: 'amount', current: 0, target: -1 },
    { type: 'amount', current: '1', target: 2 }, { type: 'amount', current: Number.MAX_SAFE_INTEGER + 1, target: 1 },
  ])('rejects invalid milestone %j and preserves existing content', async (changes) => {
    const goal = await service.createGoal(input)
    const milestone = await service.addMilestone(goal.id, booleanInput)
    const invalid = { ...booleanInput, ...changes } as MilestoneInput
    expect(Object.keys(getMilestoneValidationErrors(invalid)).length).toBeGreaterThan(0)
    await expect(service.addMilestone(goal.id, invalid)).rejects.toThrow()
    await expect(service.updateMilestone(milestone.id, invalid)).rejects.toThrow()
    expect((await service.getGoalDetails(goal.id))?.milestones).toEqual([milestone])
  })

  it.each([null, undefined, [], 'milestone'])('rejects malformed milestone input %s', async (value) => {
    const goal = await service.createGoal(input)
    await expect(service.addMilestone(goal.id, value as unknown as MilestoneInput)).rejects.toThrow('Введите данные этапа')
  })

  it('derives list totals, returns 0 after deleting the last milestone and never stores aggregates', async () => {
    const goal = await service.createGoal(input)
    const other = await service.createGoal({ ...input, progressMode: 'manual', manualProgress: 42 })
    const milestone = await service.addMilestone(goal.id, { ...booleanInput, completed: true })
    const rows = await service.getGoalsWithProgress()
    expect(rows.find((row) => row.goal.id === goal.id)).toMatchObject({ progress: 100, completedMilestones: 1, totalMilestones: 1 })
    expect(rows.find((row) => row.goal.id === other.id)).toMatchObject({ progress: 42, completedMilestones: 0, totalMilestones: 0 })
    expect((await service.getGoalDetails(goal.id))?.goal).not.toHaveProperty('progress')
    await service.deleteMilestone(milestone.id)
    await service.deleteMilestone(milestone.id)
    expect((await service.getGoalsWithProgress()).find((row) => row.goal.id === goal.id)).toMatchObject({ progress: 0, completedMilestones: 0, totalMilestones: 0 })
  })

  it('links existing tasks without copies, preserves task edits/status, unlinks and rejects a conflicting goal', async () => {
    const goal = await service.createGoal(input)
    const otherGoal = await service.createGoal(input)
    const task = await createTask()
    const linked = await service.linkTask(goal.id, task.id)
    expect(await service.linkTask(goal.id, task.id)).toEqual(linked)
    await expect(service.linkTask(otherGoal.id, task.id)).rejects.toThrow('другой целью')
    await taskService.completeTask(task.id)
    const edited = await taskService.updateTask(task.id, { title: 'Новое резюме', date: '2026-10-16', priority: 'low' })
    expect((await service.getGoalDetails(goal.id))?.tasks).toEqual([edited])
    expect(edited).toMatchObject({ goalId: goal.id, status: 'completed' })
    expect(await database.tasks.count()).toBe(1)
    expect(await service.unlinkTask(otherGoal.id, task.id)).toEqual(edited)
    const unlinked = await service.unlinkTask(goal.id, task.id)
    expect(unlinked).not.toHaveProperty('goalId')
    expect(unlinked).toMatchObject({ title: edited.title, status: 'completed', completedAt: edited.completedAt, createdAt: task.createdAt })
    expect((await service.getGoalDetails(goal.id))?.tasks).toEqual([])
    expect((await service.linkTask(otherGoal.id, task.id)).goalId).toBe(otherGoal.id)
  })

  it('deletes only the selected goal/milestones and clears links while preserving tasks and unrelated goals', async () => {
    const goal = await service.createGoal(input)
    const other = await service.createGoal(input)
    await service.addMilestone(goal.id, booleanInput)
    const otherMilestone = await service.addMilestone(other.id, booleanInput)
    const task = await createTask()
    const otherTask = await createTask()
    await taskService.completeTask(task.id)
    await service.linkTask(goal.id, task.id)
    await service.linkTask(other.id, otherTask.id)
    const before = await taskService.getTask(task.id)
    vi.setSystemTime(new Date(2026, 9, 15, 13))
    await service.deleteGoal(goal.id)
    await service.deleteGoal(goal.id)
    expect(await service.getGoalDetails(goal.id)).toBeNull()
    expect(await database.goalMilestones.toArray()).toEqual([otherMilestone])
    expect(await database.tasks.count()).toBe(2)
    const after = await taskService.getTask(task.id)
    expect(after).toEqual({ ...before, goalId: undefined, updatedAt: new Date().toISOString() })
    expect(after).not.toHaveProperty('goalId')
    expect((await service.getGoalDetails(other.id))?.tasks[0]?.id).toBe(otherTask.id)
  })

  it('rolls back task unlinking and milestone deletion if final goal deletion fails', async () => {
    const goal = await service.createGoal(input)
    await service.addMilestone(goal.id, booleanInput)
    const task = await createTask()
    await service.linkTask(goal.id, task.id)
    const before = await service.getGoalDetails(goal.id)
    vi.spyOn(database.goals, 'delete').mockRejectedValueOnce(new Error('Storage error'))
    await expect(service.deleteGoal(goal.id)).rejects.toThrow('Storage error')
    expect(await service.getGoalDetails(goal.id)).toEqual(before)
  })

  it('rejects missing records and invalid identifiers without orphaning or resurrecting rows', async () => {
    const goal = await service.createGoal(input)
    const milestone = await service.addMilestone(goal.id, booleanInput)
    const task = await createTask()
    await expect(service.linkTask(goal.id, 'missing')).rejects.toThrow('Задача не найдена')
    await expect(service.linkTask('missing', task.id)).rejects.toThrow('Цель не найдена')
    await expect(service.unlinkTask(goal.id, 'missing')).rejects.toThrow('Задача не найдена')
    await service.deleteGoal(goal.id)
    await expect(service.updateGoal(goal.id, input)).rejects.toThrow('Цель не найдена')
    await expect(service.setGoalStatus(goal.id, 'active')).rejects.toThrow('Цель не найдена')
    await expect(service.setGoalArchived(goal.id, true)).rejects.toThrow('Цель не найдена')
    await expect(service.addMilestone(goal.id, booleanInput)).rejects.toThrow('Цель не найдена')
    await expect(service.updateMilestone(milestone.id, booleanInput)).rejects.toThrow('Этап не найден')
    await expect(service.setMilestoneCompleted(milestone.id, true)).rejects.toThrow('Этап не найден')
    for (const id of ['', '  ', null, 42]) {
      await expect(service.getGoalDetails(id as string)).rejects.toThrow('идентификатор')
      await expect(service.deleteGoal(id as string)).rejects.toThrow('идентификатор')
      await expect(service.addMilestone(id as string, booleanInput)).rejects.toThrow('идентификатор')
      await expect(service.deleteMilestone(id as string)).rejects.toThrow('идентификатор')
      await expect(service.linkTask('valid', id as string)).rejects.toThrow('идентификатор')
      await expect(service.unlinkTask(id as string, task.id)).rejects.toThrow('идентификатор')
    }
    expect(await service.getGoals()).toEqual([])
    expect(await database.goalMilestones.count()).toBe(0)
    expect(await taskService.getTask(task.id)).toEqual(task)
  })

  it('preserves both concurrent goal editing and lifecycle changes from another connection', async () => {
    const goal = await service.createGoal(input)
    await withOtherConnection(async (other) => {
      await Promise.all([
        service.updateGoal(goal.id, { ...input, title: 'Сохранено', deadline: '2026-12-31' }),
        other.setGoalStatus(goal.id, 'completed'), other.setGoalArchived(goal.id, true),
      ])
    })
    expect((await service.getGoalDetails(goal.id))?.goal).toMatchObject({ title: 'Сохранено', deadline: '2026-12-31', status: 'completed', archived: true })
  })

  it('assigns unique append orders concurrently and preserves completion against a stale title editor', async () => {
    const goal = await service.createGoal(input)
    await withOtherConnection(async (other) => {
      const milestones = await Promise.all([
        service.addMilestone(goal.id, booleanInput), other.addMilestone(goal.id, booleanInput),
        service.addMilestone(goal.id, booleanInput), other.addMilestone(goal.id, booleanInput),
      ])
      expect(milestones.map(({ order }) => order).sort()).toEqual([0, 1, 2, 3])
      await Promise.all([
        other.setMilestoneCompleted(milestones[0].id, true),
        service.updateMilestone(milestones[0].id, { ...booleanInput, title: 'Изменено', completed: false }),
      ])
      expect((await service.getGoalDetails(goal.id))?.milestones[0]).toMatchObject({ title: 'Изменено', completed: true })
    })
  })

  it('preserves concurrent task editing/completion while linking', async () => {
    const goal = await service.createGoal(input)
    const task = await createTask()
    await withOtherConnection(async (other, tasks) => {
      await Promise.all([
        other.linkTask(goal.id, task.id), tasks.completeTask(task.id),
        taskService.updateTask(task.id, { title: 'С другой вкладки', date: '2026-10-16', priority: 'medium' }),
      ])
    })
    expect(await taskService.getTask(task.id)).toMatchObject({ goalId: goal.id, status: 'completed', title: 'С другой вкладки' })
  })

  it.each(['edit', 'add', 'link', 'milestone'] as const)('deleting a goal concurrently with %s leaves no dangling relations or resurrection', async (operation) => {
    const goal = await service.createGoal(input)
    const milestone = await service.addMilestone(goal.id, booleanInput)
    const task = await createTask()
    await withOtherConnection(async (other) => {
      await Promise.allSettled([
        other.deleteGoal(goal.id),
        operation === 'edit' ? service.updateGoal(goal.id, input)
          : operation === 'add' ? service.addMilestone(goal.id, booleanInput)
            : operation === 'link' ? service.linkTask(goal.id, task.id)
              : service.setMilestoneCompleted(milestone.id, true),
      ])
    })
    expect(await service.getGoalDetails(goal.id)).toBeNull()
    expect(await database.goalMilestones.count()).toBe(0)
    expect(await taskService.getTask(task.id)).not.toHaveProperty('goalId')
    expect(await database.tasks.count()).toBe(1)
  })

  it('cannot resurrect a task deleted while linking or a milestone deleted while editing', async () => {
    const goal = await service.createGoal(input)
    const milestone = await service.addMilestone(goal.id, booleanInput)
    const task = await createTask()
    await withOtherConnection(async (other, tasks) => {
      await Promise.allSettled([tasks.deleteTask(task.id), service.linkTask(goal.id, task.id)])
      await Promise.allSettled([other.deleteMilestone(milestone.id), service.updateMilestone(milestone.id, booleanInput)])
    })
    expect(await database.tasks.count()).toBe(0)
    expect((await service.getGoalDetails(goal.id))?.milestones).toEqual([])
  })

  it('allows only one of two concurrent conflicting task links', async () => {
    const goal = await service.createGoal(input)
    const otherGoal = await service.createGoal(input)
    const task = await createTask()
    await withOtherConnection(async (other) => {
      const results = await Promise.allSettled([service.linkTask(goal.id, task.id), other.linkTask(otherGoal.id, task.id)])
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    })
    expect([goal.id, otherGoal.id]).toContain((await taskService.getTask(task.id))?.goalId)
    expect(await database.tasks.count()).toBe(1)
  })

  it('persists goal state, milestone order/values and linked tasks across reopening', async () => {
    const goal = await service.createGoal({ ...input, deadline: '2026-12-31' })
    await service.addMilestone(goal.id, { ...booleanInput, completed: true })
    await service.addMilestone(goal.id, { type: 'amount', title: 'Отклики', current: 35, target: 30 })
    await service.setGoalStatus(goal.id, 'completed')
    await service.setGoalArchived(goal.id, true)
    await service.linkTask(goal.id, (await createTask()).id)
    const details = await service.getGoalDetails(goal.id)
    const name = database.name
    database.close()
    database = new TaskTrackerDatabase(name)
    await database.open()
    expect(await new GoalService(database).getGoalDetails(goal.id)).toEqual(details)
  })

  it.each([
    ['Europe/Moscow', '2026-10-14T22:30:00Z', '2026-10-15', '2026-10-14'],
    ['America/Los_Angeles', '2026-10-15T01:30:00Z', '2026-10-14', '2026-10-13'],
  ])('uses the local day for deadline comparisons in %s', async (timezone, now, today, yesterday) => {
    vi.stubEnv('TZ', timezone)
    vi.setSystemTime(new Date(now))
    const goal = await service.createGoal({ ...input, deadline: today })
    expect(getLocalDate()).toBe(today)
    expect(isGoalOverdue(goal)).toBe(false)
    expect(isGoalOverdue(await service.updateGoal(goal.id, { ...input, deadline: yesterday }))).toBe(true)
    expect(goal.deadline).toBe(today)
  })

  it('retains dates across DST and year boundaries and accepts past or future deadlines', async () => {
    vi.stubEnv('TZ', 'America/New_York')
    for (const deadline of ['2026-03-08', '2026-11-01', '2026-12-31', '2027-01-01', '2028-02-29']) {
      const goal = await service.createGoal({ ...input, deadline })
      expect((await service.getGoalDetails(goal.id))?.goal.deadline).toBe(deadline)
    }
  })
})
