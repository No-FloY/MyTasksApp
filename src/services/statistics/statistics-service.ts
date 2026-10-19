import { db, type TaskTrackerDatabase } from '../../db/database'
import type { LocalDate } from '../../lib/local-date'
import type { Habit } from '../../models/habit'
import type { HabitEntry } from '../../models/habit-entry'
import type { Task } from '../../models/task'
import type { Goal, GoalMilestone } from '../../models/goal'
import { calculateBooleanStatistics } from './habit-statistics'
import { calculateAmountStatistics } from './amount-statistics'
import { calculateDurationStatistics } from './duration-statistics'
import { calculateTaskStatistics } from './task-statistics'
import { calculateGoalStatistics } from './goal-statistics'
import { getTimestampLocalDate, getWeekPeriods, type StatisticsPeriod } from './period-utils'

export interface StatisticsSource {
  habits: Habit[]
  entries: HabitEntry[]
  tasks: Task[]
  goals: Goal[]
  milestones: GoalMilestone[]
  /** Earlier keys supply lifecycle context without loading out-of-period values. */
  firstRecordedDates?: ReadonlyMap<string, LocalDate>
}

function calculateHabits(
  habits: Habit[], entriesByHabit: ReadonlyMap<string, HabitEntry[]>, period: StatisticsPeriod,
  firstRecordedDates?: ReadonlyMap<string, LocalDate>,
) {
  const booleans = habits.flatMap((habit) => habit.type === 'boolean'
    ? [calculateBooleanStatistics(habit, entriesByHabit.get(habit.id) ?? [], period, firstRecordedDates?.get(habit.id))]
    : []).filter((item) => item.eligibleDays > 0)
  const amounts = habits.flatMap((habit) => habit.type === 'amount'
    ? [calculateAmountStatistics(habit, entriesByHabit.get(habit.id) ?? [], period, firstRecordedDates?.get(habit.id))]
    : []).filter((item) => item.eligibleDays > 0)
  const durations = habits.flatMap((habit) => habit.type === 'duration'
    ? [calculateDurationStatistics(habit, entriesByHabit.get(habit.id) ?? [], period, firstRecordedDates?.get(habit.id))]
    : []).filter((item) => item.eligibleDays > 0)
  const successCount = booleans.reduce((sum, item) => sum + item.successCount, 0)
  const markedCount = booleans.reduce((sum, item) => sum + item.markedCount, 0)
  return { booleans, amounts, durations, successCount, markedCount,
    habitSuccessRate: markedCount === 0 ? null : successCount / markedCount * 100 }
}

/** All aggregates derive from the same read snapshot. No saved counters or per-day queries. */
export function calculateStatistics(source: StatisticsSource, period: StatisticsPeriod, now: Date) {
  const habits = [...source.habits].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const entriesByHabit = new Map<string, HabitEntry[]>()
  for (const entry of source.entries) {
    const entries = entriesByHabit.get(entry.habitId) ?? []
    entries.push(entry)
    entriesByHabit.set(entry.habitId, entries)
  }
  const habitStatistics = calculateHabits(habits, entriesByHabit, period, source.firstRecordedDates)
  const tasks = calculateTaskStatistics(source.tasks, period.startDate, period.endDate, now)
  const goals = calculateGoalStatistics(source.goals, source.milestones, period.today)
  const weekly = period.dates.length < 15 ? [] : getWeekPeriods(period).map((week) => {
    const results = calculateHabits(habits, entriesByHabit, week, source.firstRecordedDates)
    const taskResults = calculateTaskStatistics(source.tasks, week.startDate, week.endDate, now)
    return {
      startDate: week.startDate, endDate: week.endDate,
      habitSuccessRate: results.habitSuccessRate,
      taskOnTimeRate: taskResults.onTimeRate,
      waterSuccessRate: results.amounts.find((item) => item.habit.id === 'water')?.successRate ?? null,
      gamingAverage: results.durations.find((item) => item.habit.id === 'gaming')?.averageMinutes ?? null,
      socialAverage: results.durations.find((item) => item.habit.id === 'social-media')?.averageMinutes ?? null,
    }
  })
  return { period, ...habitStatistics, tasks, goals, weekly,
    hasPeriodData: habitStatistics.markedCount > 0
      || habitStatistics.amounts.some((item) => item.daysWithData > 0)
      || habitStatistics.durations.some((item) => item.recordedDays > 0) || tasks.tasksDue > 0 }
}

export type StatisticsDashboard = ReturnType<typeof calculateStatistics>

export class StatisticsService {
  constructor(private readonly database: TaskTrackerDatabase) {}

  async getStatistics(period: StatisticsPeriod, now: Date): Promise<StatisticsDashboard> {
    const database = this.database
    return database.transaction('r', [database.habits, database.habitEntries, database.tasks, database.goals, database.goalMilestones], async () => {
      const [habits, entries, tasks, goals, milestones] = await Promise.all([
        database.habits.toArray(),
        database.habitEntries.where('date').between(period.startDate, period.endDate, true, true).toArray(),
        database.tasks.where('date').between(period.startDate, period.endDate, true, true).toArray(),
        database.goals.toArray(), database.goalMilestones.toArray(),
      ])
      // A backdated result can establish an earlier start than createdAt. Read
      // only those historical keys which can affect lifecycle counts, in one
      // compound-index query, rather than fetching every habit's full history.
      const historyRanges = habits
        .filter((habit) => getTimestampLocalDate(habit.createdAt) > period.startDate)
        .map((habit) => [[habit.id, '0000-01-01'], [habit.id, period.startDate]] as const)
      const historicalKeys = historyRanges.length === 0 ? [] : await database.habitEntries
        .where('[habitId+date]').inAnyRange(historyRanges, { includeLowers: true, includeUppers: false }).primaryKeys()
      const firstRecordedDates = new Map<string, LocalDate>()
      for (const [habitId, date] of historicalKeys) {
        const firstDate = firstRecordedDates.get(habitId)
        if (firstDate === undefined || date < firstDate) firstRecordedDates.set(habitId, date)
      }
      return calculateStatistics({ habits, entries, tasks, goals, milestones, firstRecordedDates }, period, now)
    })
  }
}

const statisticsService = new StatisticsService(db)
export const getStatistics = (period: StatisticsPeriod, now: Date) => statisticsService.getStatistics(period, now)
