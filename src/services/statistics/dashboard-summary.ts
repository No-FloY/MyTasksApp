import { HABIT_CATEGORIES, getHabitCategory } from '../../models/habit-category'
import type { AmountStatistics } from './amount-statistics'
import type { DayScoreData, WeeklyScoreData } from './day-score'
import type { DurationStatistics } from './duration-statistics'
import type { calculateFoodStatistics } from './food-statistics'
import type { BooleanStatistics } from './habit-statistics'
import type { StatisticsPeriod } from './period-utils'

interface DashboardSource {
  period: StatisticsPeriod
  days: DayScoreData[]
  weeklyScore: WeeklyScoreData
  booleans: BooleanStatistics[]
  amounts: AmountStatistics[]
  durations: DurationStatistics[]
  food: ReturnType<typeof calculateFoodStatistics>
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Compact selectors consume already-calculated period data; no storage reads or per-card scoring. */
export function calculateDashboardSummary({ period, days, weeklyScore, booleans, amounts, durations, food }: DashboardSource) {
  const sufficient = days.filter((day) => day.sufficient)
  const eligibleDays = days.filter((day) => day.eligible > 0)
  const day = days[0]
  const isDay = period.preset === 'day'
  const isWeek = period.preset === 'week'
  const score = isDay ? day?.score ?? null : isWeek ? weeklyScore.score : average(sufficient.map((item) => item.score!))
  const averageCoverage = isDay ? day?.coverage ?? null
    : isWeek ? weeklyScore.averageCoverage : average(eligibleDays.map((item) => item.coverage!))
  const categories = HABIT_CATEGORIES.flatMap(({ id }) => {
    const categoryDays = days.flatMap((item) => item.categories.filter((category) => category.category === id))
    const weeklyCategory = weeklyScore.categories.find((category) => category.category === id)
    const sufficientCategories = sufficient.flatMap((item) => item.categories.filter((category) => category.category === id))
    const values = (isDay ? categoryDays : sufficientCategories).flatMap((item) => item.score === null ? [] : [item.score])
    const categoryScore = isWeek ? weeklyCategory?.score ?? null : average(values)
    if (categoryDays.length === 0 && categoryScore === null) return []
    return [{ category: id, score: categoryScore, days: isWeek ? weeklyCategory?.days ?? 0 : values.length,
      filled: categoryDays.reduce((sum, item) => sum + item.filled, 0),
      eligible: categoryDays.reduce((sum, item) => sum + item.eligible, 0) }]
  })
  const screenTimeByDate = new Map<string, number>()
  for (const duration of durations.filter((item) => getHabitCategory(item.habit) === 'screen_time')) {
    for (const item of duration.days) {
      if (item.minutes !== null) screenTimeByDate.set(item.date, (screenTimeByDate.get(item.date) ?? 0) + item.minutes)
    }
  }
  const screenRecordedDays = screenTimeByDate.size
  const screenTotal = screenRecordedDays === 0 ? null : [...screenTimeByDate.values()].reduce((sum, value) => sum + value, 0)
  const workout = booleans.find((item) => item.habit.id === 'workout')
  const water = amounts.find((item) => item.habit.id === 'water')
  const mealDays = food.meals.map((meal) => new Map(meal.days.map((item) => [item.date, item.status])))
  const fullMealRecordedDays = mealDays.length !== 3 ? 0 : period.dates.filter((date) =>
    mealDays.every((items) => items.has(date) && items.get(date) !== 'no-data')).length
  const bestDay = [...sufficient].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.date.localeCompare(b.date))[0] ?? null
  const worstDay = [...sufficient].sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.date.localeCompare(b.date))[0] ?? null
  return {
    score, averageCoverage, days, categories,
    filled: days.reduce((sum, item) => sum + item.filled, 0),
    eligible: days.reduce((sum, item) => sum + item.eligible, 0),
    sufficientDays: sufficient.length,
    bestDay: isWeek ? weeklyScore.bestDay : bestDay,
    worstDay: isWeek ? weeklyScore.worstDay : worstDay,
    habits: {
      successCount: booleans.reduce((sum, item) => sum + item.successCount, 0),
      failureCount: booleans.reduce((sum, item) => sum + item.failureCount, 0),
      noDataCount: booleans.reduce((sum, item) => sum + item.noDataCount, 0),
    },
    training: { workoutDays: workout?.successCount ?? 0, recordedDays: workout?.markedCount ?? 0 },
    food: {
      alcoholDays: food.alcohol?.selected.failureCount ?? 0,
      alcoholRecordedDays: food.alcohol?.selected.markedCount ?? 0,
      fullMealDays: food.fullMealDays, fullMealRecordedDays,
      waterSuccessDays: water?.successfulDays ?? 0, waterRecordedDays: water?.daysWithData ?? 0,
    },
    screenTime: { totalMinutes: screenTotal, averageMinutes: screenTotal === null ? null : screenTotal / screenRecordedDays,
      recordedDays: screenRecordedDays },
  }
}

export type DashboardSummary = ReturnType<typeof calculateDashboardSummary>
