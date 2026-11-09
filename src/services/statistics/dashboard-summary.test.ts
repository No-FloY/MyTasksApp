import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../../db/database'
import { createInitialHabits } from '../../db/seed'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { BooleanHabit, Habit } from '../../models/habit'
import type { HabitEntry } from '../../models/habit-entry'
import { calculateDayScore, calculateWeeklyScore } from './day-score'
import { getStatisticsPeriod } from './period-utils'
import { calculateStatistics, StatisticsService, type StatisticsSource } from './statistics-service'

const timestamp = '2026-10-01T12:00:00.000Z'
const now = new Date(2026, 10, 4, 12)
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
const today = date('2026-11-04')
function boolean(id: string, fields: Partial<BooleanHabit> = {}): BooleanHabit {
  return { id, name: id, description: '', category: 'self_development', type: 'boolean', order: 0,
    createdAt: timestamp, updatedAt: timestamp, archivedAt: null, ...fields }
}
function mark(habitId: string, day: string, status: 'success' | 'failure' | 'no-data' = 'success'): HabitEntry {
  return { habitId, date: date(day), type: 'boolean', status, createdAt: timestamp, updatedAt: timestamp }
}
function minutes(habitId: string, day: string, value: number): HabitEntry {
  return { habitId, date: date(day), type: 'duration', minutes: value, createdAt: timestamp, updatedAt: timestamp }
}
function quantity(habitId: string, day: string, value: number): HabitEntry {
  return { habitId, date: date(day), type: 'amount', value, createdAt: timestamp, updatedAt: timestamp }
}
function source(habits: Habit[], entries: HabitEntry[] = []): StatisticsSource {
  return { habits, entries, tasks: [], goals: [], milestones: [] }
}
afterEach(() => vi.restoreAllMocks())

describe('compact dashboard selectors', () => {
  it('shows the selected historical day including partial coverage instead of the latest day', () => {
    const habits = [boolean('a'), boolean('b'), boolean('c')]
    const entries = [mark('a', '2026-11-03'), mark('a', '2026-11-04', 'failure'), mark('b', '2026-11-03', 'no-data')]
    const period = getStatisticsPeriod('day', today, undefined, date('2026-11-03'))
    const result = calculateStatistics(source(habits, entries), period, now)
    expect(result.dashboard.days).toEqual([calculateDayScore(habits, entries, date('2026-11-03'))])
    expect(result.dashboard).toMatchObject({ score: 100, filled: 1, eligible: 3, sufficientDays: 0,
      habits: { successCount: 1, failureCount: 0, noDataCount: 2 } })
    expect(result.dashboard.averageCoverage).toBeCloseTo(100 / 3)
    expect(result.dashboard.categories).toEqual([{ category: 'self_development', score: 100, days: 1, filled: 1, eligible: 3 }])
  })

  it('uses unchanged WeeklyScore values and counts a weekly-only cleaning goal once', () => {
    const habits = [boolean('reading'), boolean('cleaning', { category: 'routine', schedule: { type: 'weekly' } })]
    const entries = [mark('reading', '2026-11-02'), mark('reading', '2026-11-03', 'failure'), mark('cleaning', '2026-11-02')]
    const period = getStatisticsPeriod('week', today)
    const result = calculateStatistics(source(habits, entries), period, now)
    const weekly = calculateWeeklyScore(habits, entries, period.endDate, undefined, today)
    expect(result.weeklyScore).toEqual(weekly)
    expect(result.dashboard).toMatchObject({ score: weekly.score, averageCoverage: weekly.averageCoverage,
      sufficientDays: weekly.sufficientDays, bestDay: weekly.bestDay, worstDay: weekly.worstDay })
    expect(result.dashboard.categories.find((category) => category.category === 'routine'))
      .toEqual({ category: 'routine', score: 100, days: 0, filled: 0, eligible: 0 })
    expect(result.weeklyScore.weeklyGoals).toHaveLength(1)
    expect(result.dashboard.habits).toEqual({ successCount: 1, failureCount: 1, noDataCount: 1 })
  })

  it('preserves assigned weekly-goal math when reusing the day timeline', () => {
    const habits = [boolean('reading'), boolean('cleaning', { category: 'routine', schedule: { type: 'weekly', weekday: 2 } })]
    const entries = [mark('reading', '2026-11-02'), mark('cleaning', '2026-11-02', 'failure')]
    const period = getStatisticsPeriod('week', today)
    const result = calculateStatistics(source(habits, entries), period, now)
    expect(result.weeklyScore).toEqual(calculateWeeklyScore(habits, entries, period.endDate, undefined, today))
    expect(result.dashboard.days.map((day) => day.eligible)).toEqual([1, 2, 1])
  })

  it('averages sufficiently covered DayScores over a month and keeps empty days in coverage', () => {
    const habits = [boolean('reading'), boolean('breakfast', { category: 'food_water' }), boolean('lunch', { category: 'food_water' })]
    const entries = [mark('reading', '2026-11-01'), mark('breakfast', '2026-11-01', 'failure'),
      mark('reading', '2026-11-02'), mark('reading', '2026-11-03', 'failure'), mark('breakfast', '2026-11-03', 'failure')]
    const result = calculateStatistics(source(habits, entries), getStatisticsPeriod('month', today), now)
    expect(result.dashboard).toMatchObject({ score: 25, sufficientDays: 2, filled: 5, eligible: 12 })
    expect(result.dashboard.averageCoverage).toBeCloseTo(125 / 3)
    expect(result.dashboard.days.map((day) => day.score)).toEqual([50, 100, 0, null])
    expect(result.dashboard.bestDay?.date).toBe('2026-11-01')
    expect(result.dashboard.worstDay?.date).toBe('2026-11-03')
    expect(result.dashboard.categories.find((category) => category.category === 'self_development')?.score).toBe(50)
    expect(result.dashboard.categories.find((category) => category.category === 'food_water')?.score).toBe(0)
  })

  it('uses the exact custom interval for overview scores, counts and daily trend', () => {
    const input = source([boolean('reading')], [mark('reading', '2026-11-01', 'failure'), mark('reading', '2026-11-02'),
      mark('reading', '2026-11-03'), mark('reading', '2026-11-04', 'failure')])
    const custom = getStatisticsPeriod('custom', today, { startDate: '2026-11-02', endDate: '2026-11-03' })
    const result = calculateStatistics(input, custom, now)
    expect(result.dashboard).toMatchObject({ score: 100, averageCoverage: 100, sufficientDays: 2,
      habits: { successCount: 2, failureCount: 0, noDataCount: 0 } })
    expect(result.dashboard.days.map((day) => day.date)).toEqual(['2026-11-02', '2026-11-03'])
  })

  it('keeps empty, untracked and explicit zero values distinct for compact formatting', () => {
    const habits = createInitialHabits(timestamp).filter((habit) => ['gaming', 'social-media'].includes(habit.id))
    const period = getStatisticsPeriod('day', today)
    const empty = calculateStatistics(source(habits), period, now)
    expect(empty.dashboard).toMatchObject({ score: null, averageCoverage: 0,
      screenTime: { totalMinutes: null, averageMinutes: null, recordedDays: 0 } })
    expect(calculateStatistics(source([]), period, now).dashboard.averageCoverage).toBeNull()
    const zero = calculateStatistics(source(habits, [minutes('gaming', today, 0)]), period, now)
    expect(zero.dashboard).toMatchObject({ score: 100, averageCoverage: 50,
      screenTime: { totalMinutes: 0, averageMinutes: 0, recordedDays: 1 } })
  })

  it('combines screen time by recorded calendar days, counting shared dates only once', () => {
    const habits = createInitialHabits(timestamp).filter((habit) => ['gaming', 'social-media'].includes(habit.id))
    const entries = [minutes('gaming', '2026-11-02', 60), minutes('social-media', '2026-11-02', 30),
      minutes('gaming', '2026-11-03', 0), minutes('social-media', '2026-10-31', 500)]
    expect(calculateStatistics(source(habits, entries), getStatisticsPeriod('week', today), now).dashboard.screenTime)
      .toEqual({ totalMinutes: 90, averageMinutes: 45, recordedDays: 2 })
  })

  it('uses actual workout, food and water facts without inferring workouts from repetitions', () => {
    const habits = createInitialHabits(timestamp)
    const entries = [mark('workout', '2026-11-02'), mark('workout', '2026-11-03', 'failure'),
      quantity('push-ups', '2026-11-04', 100), quantity('water', '2026-11-02', 2400), quantity('water', '2026-11-03', 0),
      mark('no-alcohol', '2026-11-02', 'failure'), mark('no-alcohol', '2026-11-03'),
      ...['breakfast', 'lunch', 'dinner'].map((id) => mark(id, '2026-11-02')),
      mark('breakfast', '2026-11-03'), mark('lunch', '2026-11-03'), mark('dinner', '2026-11-03', 'failure')]
    const result = calculateStatistics(source(habits, entries), getStatisticsPeriod('week', today), now)
    expect(result.dashboard.training).toEqual({ workoutDays: 1, recordedDays: 2 })
    expect(result.dashboard.food).toEqual({ alcoholDays: 1, alcoholRecordedDays: 2,
      fullMealDays: 1, fullMealRecordedDays: 2, waterSuccessDays: 1, waterRecordedDays: 2 })
  })

  it('does not invent scoreable days or categories before a habit existed', () => {
    const input = source([boolean('new', { createdAt: '2026-11-04T12:00:00.000Z' })])
    const result = calculateStatistics(input, getStatisticsPeriod('day', today, undefined, date('2026-11-03')), now)
    expect(result.dashboard).toMatchObject({ score: null, averageCoverage: null, filled: 0, eligible: 0, categories: [] })
  })
})

describe('anchored IndexedDB dashboard snapshots', () => {
  it('selects historical days/weeks/months with bounded shared reads and preserved backdated lifecycles', async () => {
    const database = new TaskTrackerDatabase(`anchored-dashboard-${crypto.randomUUID()}`)
    try {
      await database.open()
      await database.habits.clear()
      const habits = [boolean('reading', { createdAt: '2026-11-04T12:00:00.000Z' })]
      await database.habits.bulkPut(habits)
      await database.habitEntries.bulkPut([mark('reading', '2026-09-01'), mark('reading', '2026-10-13', 'failure'),
        mark('reading', '2026-10-14'), mark('reading', '2026-11-04')])
      const service = new StatisticsService(database)
      const query = vi.spyOn(database.habitEntries, 'where')
      const day = await service.getStatistics(getStatisticsPeriod('day', today, undefined, date('2026-10-13')), now)
      expect(day.dashboard).toMatchObject({ score: 0, averageCoverage: 100, sufficientDays: 1 })
      expect(day.dashboard.days.map((item) => item.date)).toEqual(['2026-10-13'])
      expect(query.mock.calls.length).toBeLessThanOrEqual(2)
      query.mockClear()
      const week = await service.getStatistics(getStatisticsPeriod('week', today, undefined, date('2026-10-13')), now)
      expect(week.dashboard).toMatchObject({ score: 50, sufficientDays: 2, eligible: 7, filled: 2 })
      expect(query.mock.calls.length).toBeLessThanOrEqual(2)
      query.mockClear()
      const month = await service.getStatistics(getStatisticsPeriod('month', today, undefined, date('2026-10-13')), now)
      expect(month.dashboard).toMatchObject({ score: 50, sufficientDays: 2, eligible: 31, filled: 2 })
      expect(query.mock.calls.length).toBeLessThanOrEqual(2)
      expect(await database.habitEntries.count()).toBe(4)
    } finally { await database.delete() }
  })
})
