import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocalDate, isLocalDate, type LocalDate } from '../../lib/local-date'
import type { Goal, GoalMilestone, MilestoneInput } from '../../models/goal'
import { calculateGoalStatistics } from './goal-statistics'

const timestamp = '2026-10-16T09:00:00.000Z'

function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

function goal(fields: Partial<Goal> = {}): Goal {
  return {
    id: 'goal', title: 'Цель', description: '', deadline: null,
    status: 'active', progressMode: 'auto', manualProgress: 0, archived: false,
    createdAt: timestamp, updatedAt: timestamp, ...fields,
  }
}

function milestone(goalId: string, fields: MilestoneInput): GoalMilestone {
  return { id: crypto.randomUUID(), goalId, order: 0, createdAt: timestamp, updatedAt: timestamp, ...fields }
}

afterEach(() => vi.unstubAllEnvs())

describe('current goal statistics', () => {
  it('returns an explicit empty result without NaN or a fictional progress percentage', () => {
    expect(calculateGoalStatistics([], [], date('2026-10-16'))).toEqual({
      totalGoals: 0, archivedGoals: 0, activeGoals: 0, completedGoals: 0,
      failedGoals: 0, cancelledGoals: 0, overdueGoals: 0, averageProgress: null,
    })
  })

  it('counts explicit statuses and overdue active goals separately', () => {
    const goals = [
      goal({ id: 'active', deadline: date('2026-10-15') }),
      goal({ id: 'completed', status: 'completed', deadline: date('2026-10-15') }),
      goal({ id: 'failed', status: 'failed', deadline: date('2026-10-15') }),
      goal({ id: 'cancelled', status: 'cancelled', deadline: date('2026-10-15') }),
    ]
    expect(calculateGoalStatistics(goals, [], date('2026-10-16'))).toEqual({
      totalGoals: 4, archivedGoals: 0, activeGoals: 1, completedGoals: 1,
      failedGoals: 1, cancelledGoals: 1, overdueGoals: 1, averageProgress: 0,
    })
  })

  it('excludes archived goals from current counts and progress but reports their existence', () => {
    const goals = [
      goal({ id: 'visible', progressMode: 'manual', manualProgress: 20 }),
      goal({ id: 'archived', archived: true, deadline: date('2026-01-01'), progressMode: 'manual', manualProgress: 100 }),
      goal({ id: 'archived-completed', status: 'completed', archived: true }),
    ]
    expect(calculateGoalStatistics(goals, [], date('2026-10-16'))).toMatchObject({
      totalGoals: 1, archivedGoals: 2, activeGoals: 1, completedGoals: 0,
      overdueGoals: 0, averageProgress: 20,
    })
  })

  it('averages actual active progress with equal goal weights and preserves fractional values', () => {
    const goals = [
      goal({ id: 'manual', progressMode: 'manual', manualProgress: 25 }),
      goal({ id: 'automatic' }),
      goal({ id: 'empty' }),
      goal({ id: 'completed', status: 'completed', progressMode: 'manual', manualProgress: 100 }),
    ]
    const milestones = [
      milestone('automatic', { type: 'boolean', title: 'Первый', completed: true }),
      milestone('automatic', { type: 'amount', title: 'Второй', current: 1, target: 3 }),
      milestone('manual', { type: 'boolean', title: 'Не влияет', completed: true }),
      milestone('unrelated', { type: 'amount', title: 'Чужой', current: 500, target: 1 }),
    ]
    const before = structuredClone({ goals, milestones })
    const result = calculateGoalStatistics(goals, milestones, date('2026-10-16'))
    expect(result.activeGoals).toBe(3)
    expect(result.averageProgress).toBeCloseTo((25 + (1 + 1 / 3) / 2 * 100) / 3)
    expect({ goals, milestones }).toEqual(before)
  })

  it('caps each amount milestone before averaging active goals', () => {
    const milestones = [
      milestone('goal', { type: 'amount', title: 'Больше цели', current: 500, target: 100 }),
      milestone('goal', { type: 'boolean', title: 'Не выполнен', completed: false }),
    ]
    expect(calculateGoalStatistics([goal()], milestones, date('2026-10-16')).averageProgress).toBe(50)
  })

  it('does not treat 100% progress as completed or completed status as active progress', () => {
    const goals = [
      goal({ id: 'active', progressMode: 'manual', manualProgress: 100 }),
      goal({ id: 'completed', status: 'completed', progressMode: 'manual', manualProgress: 20 }),
    ]
    expect(calculateGoalStatistics(goals, [], date('2026-10-16'))).toMatchObject({
      activeGoals: 1, completedGoals: 1, averageProgress: 100,
    })
    expect(calculateGoalStatistics(goals.slice(1), [], date('2026-10-16')).averageProgress).toBeNull()
  })

  it('treats absent, current-day and future deadlines as pending', () => {
    const goals = [
      goal({ id: 'none' }), goal({ id: 'today', deadline: date('2026-10-16') }),
      goal({ id: 'future', deadline: date('2026-10-17') }),
    ]
    expect(calculateGoalStatistics(goals, [], date('2026-10-16')).overdueGoals).toBe(0)
  })

  it.each([
    ['Europe/Moscow', '2026-10-15T22:00:00Z', '2026-10-15', 1],
    ['America/Los_Angeles', '2026-10-16T01:00:00Z', '2026-10-15', 0],
  ])('uses the actual local date at midnight in %s', (timezone, now, deadline, overdue) => {
    vi.stubEnv('TZ', timezone)
    expect(calculateGoalStatistics([goal({ deadline: date(deadline) })], [], getLocalDate(new Date(now))).overdueGoals).toBe(overdue)
  })

  it('rejects malformed local dates instead of silently classifying deadlines', () => {
    expect(() => calculateGoalStatistics([], [], '2026-02-30' as LocalDate)).toThrow('календарная дата')
    expect(() => calculateGoalStatistics([goal({ deadline: '2026-02-30' as LocalDate })], [], date('2026-10-16'))).toThrow('календарная дата')
  })
})
