import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskTrackerDatabase } from '../../db/database'
import { createInitialHabits } from '../../db/seed'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { BooleanHabit } from '../../models/habit'
import type { HabitEntry, BooleanHabitStatus } from '../../models/habit-entry'
import { HabitService } from '../habit-service'
import { CalendarService } from '../calendar-service'
import { StreakService } from '../streak-service'
import { DayScoreService } from './day-score-service'
import { calculateDayScore, calculateWeeklyScore } from './day-score'
import { calculateCoffeeStatistics } from './coffee-statistics'
import { calculateStatistics, StatisticsService } from './statistics-service'
import { calculateWeeklyHabitStatistics } from './weekly-habit-statistics'
import { getStatisticsPeriod } from './period-utils'

function date(value: string): LocalDate { if (!isLocalDate(value)) throw new Error('Invalid fixture'); return value }
const timestamp = '2026-10-01T09:00:00.000Z'
const today = date('2026-11-03')
const yesterday = date('2026-11-02')
const habits = createInitialHabits(timestamp)
const coffee = habits.find((habit): habit is BooleanHabit => habit.id === 'coffee' && habit.type === 'boolean')!
function mark(habitId: string, day: LocalDate, status: BooleanHabitStatus): HabitEntry {
  return { habitId, date: day, type: 'boolean', status, createdAt: timestamp, updatedAt: timestamp }
}
const opened: TaskTrackerDatabase[] = []
afterEach(async () => { for (const database of opened.splice(0)) await database.delete(); vi.useRealTimers() })

describe('policy and neutral observation statistics', () => {
  it('counts coffee 17/28 filled days in a month, with inferred non-events and explicit unknown days', () => {
    const period = getStatisticsPeriod('month', today, undefined, date('2026-10-15'))
    const entries = period.dates.slice(0, 17).map((day) => mark('coffee', day, 'success'))
    entries.push(...period.dates.slice(28).map((day) => mark('coffee', day, 'no-data')))
    const before = structuredClone(entries)
    const result = calculateCoffeeStatistics(coffee, entries, period)
    expect(result).toMatchObject({ drankDays: 17, didNotDrinkDays: 11, noDataDays: 3,
      eligibleDays: 31, filledDays: 28, explicitDays: 17, inferredDays: 11 })
    expect(result.frequencyPercent).toBeCloseTo(17 / 28 * 100)
    expect(Math.round(result.frequencyPercent!)).toBe(61)
    expect(result.weeks.reduce((sum, week) => sum + week.drankDays, 0)).toBe(17)
    expect(result.weeks.reduce((sum, week) => sum + week.filledDays, 0)).toBe(28)
    expect(result.months).toHaveLength(1)
    expect(entries).toStrictEqual(before)
    expect(entries).toHaveLength(20)
  })

  it.each(['day', 'week', 'month', '3m', 'year', 'custom'] as const)('supports neutral coffee counts for %s and preserves empty periods', (preset) => {
    const period = getStatisticsPeriod(preset, today, { startDate: yesterday, endDate: today })
    const definition = { ...coffee, createdAt: '2026-11-03T09:00:00.000Z', missingDataPolicy: 'manual' as const }
    const source = { habits: [definition], entries: [mark('coffee', today, 'success')], tasks: [], goals: [], milestones: [] }
    const result = calculateStatistics(source, period, new Date('2026-11-03T12:00:00Z'))
    expect(result.coffee).toMatchObject({ drankDays: 1, filledDays: 1, frequencyPercent: 100 })
    expect(result.hasPeriodData).toBe(true)
    expect(result.habitSuccessRate).toBeNull()
    expect(result.dayScore).toMatchObject({ score: null, coverage: null, filled: 0, eligible: 0 })
    expect(result.weeklyScore.score).toBeNull()
    expect(result.dashboard.categories).toEqual([])
    expect(calculateStatistics({ ...source, entries: [] }, period, new Date('2026-11-03T12:00:00Z')).hasPeriodData).toBe(false)
  })

  it('uses inferred known results in scoring and coverage while manual measurements remain missing', () => {
    const selected = habits.filter((habit) => ['coffee', 'english', 'no-alcohol', 'no-sweets', 'push-ups', 'water', 'gaming', 'social-media'].includes(habit.id))
    const day = calculateDayScore(selected, [], yesterday, undefined, today)
    expect(day).toMatchObject({ filled: 4, eligible: 7, sufficient: true })
    expect(day.coverage).toBeCloseTo(400 / 7)
    expect(day.score).toBeCloseTo(100 / 3)
    expect(calculateDayScore(selected, [], today, undefined, today)).toMatchObject({ score: null, coverage: 0, filled: 0, eligible: 7 })
    for (const status of ['success', 'failure', 'no-data'] as const) {
      const entries = [mark('coffee', yesterday, status)]
      expect(calculateDayScore(selected, entries, yesterday, undefined, today)).toEqual(day)
      expect(calculateWeeklyScore(selected, entries, yesterday, undefined, today))
        .toEqual(calculateWeeklyScore(selected, [], yesterday, undefined, today))
    }
  })

  it('does not infer historical failures before creation even if a backdated explicit mark establishes tracked dates', () => {
    const english = { ...habits.find((habit) => habit.id === 'english')!, createdAt: '2026-11-03T09:00:00Z' }
    const first = new Map([['english', date('2026-10-01')]])
    expect(calculateDayScore([english], [], yesterday, first, today)).toMatchObject({ score: null, filled: 0 })
    expect(calculateDayScore([english], [mark('english', yesterday, 'success')], yesterday, first, today).score).toBe(100)
  })

  it('honors manual weekly overrides and never infers a partial selected week', () => {
    const cleaning = habits.find((habit) => habit.id === 'cleaning')!
    const full = getStatisticsPeriod('custom', today, { startDate: '2026-10-26', endDate: '2026-11-01' })
    expect(calculateWeeklyHabitStatistics(cleaning, [], full)).toMatchObject({ failureCount: 1 })
    expect(calculateWeeklyHabitStatistics({ ...cleaning, missingDataPolicy: 'manual' }, [], full)).toMatchObject({ noDataCount: 1, failureCount: 0 })
    const partial = getStatisticsPeriod('custom', today, { startDate: '2026-10-27', endDate: '2026-11-01' })
    expect(calculateWeeklyHabitStatistics(cleaning, [], partial)).toMatchObject({ noDataCount: 1, failureCount: 0 })
  })

  it('keeps all database reads consistent, lets explicit edits override inference, and never persists inferred history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'))
    const database = new TaskTrackerDatabase(`policy-integration-${crypto.randomUUID()}`)
    opened.push(database)
    await database.open()
    await database.habits.toCollection().modify({ createdAt: timestamp })
    const before = await Promise.all(database.tables.map((table) => table.toArray()))
    const habitService = new HabitService(database)
    const scores = new DayScoreService(database)
    const statistics = new StatisticsService(database)
    const daily = getStatisticsPeriod('day', today, undefined, yesterday)
    const rows = await habitService.getTodayHabits(yesterday)
    expect(rows.find((row) => row.habit.id === 'coffee')).toMatchObject({ status: 'failure', source: 'inferred' })
    expect(rows.find((row) => row.habit.id === 'no-alcohol')).toMatchObject({ status: 'success', source: 'inferred' })
    expect((await habitService.getTodayAmountHabits(yesterday)).find((row) => row.habit.id === 'push-ups'))
      .toMatchObject({ value: 0, hasEntry: true, source: 'inferred' })
    const overview = await statistics.getStatistics(daily, new Date())
    expect(await scores.getDayScore(yesterday)).toEqual(overview.dayScore)
    expect(overview.dayScore.filled).toBeGreaterThan(0)
    expect(overview.coffee).toMatchObject({ didNotDrinkDays: 1, inferredDays: 1 })
    const calendar = await new CalendarService(database).getMonth(yesterday)
    expect(calendar.summaries[yesterday]!.failures).toBe(4) // english, reading, workout, walking; coffee stays neutral.
    expect((await new StreakService(database).getBooleanStatistics(yesterday)).some((item) => item.habit.id === 'coffee')).toBe(false)
    expect(await Promise.all(database.tables.map((table) => table.toArray()))).toStrictEqual(before)
    await habitService.setBooleanHabitStatus('coffee', yesterday, 'success')
    expect((await habitService.getTodayHabits(yesterday)).find((row) => row.habit.id === 'coffee'))
      .toMatchObject({ status: 'success', source: 'explicit' })
    await habitService.setBooleanHabitStatus('english', yesterday, 'no-data')
    expect((await habitService.getTodayHabits(yesterday)).find((row) => row.habit.id === 'english'))
      .toMatchObject({ status: 'no-data', source: 'explicit' })
    expect(await database.habitEntries.count()).toBe(2)
    const updated = await statistics.getStatistics(daily, new Date())
    expect(updated.coffee).toMatchObject({ drankDays: 1, inferredDays: 0 })
    expect(updated.dayScore.filled).toBe(overview.dayScore.filled - 1)
    database.close()
    await database.open()
    expect((await habitService.getTodayHabits(yesterday)).find((row) => row.habit.id === 'coffee')?.status).toBe('success')
    expect(await database.habitEntries.count()).toBe(2)
  })
})
