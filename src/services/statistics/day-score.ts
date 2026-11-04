import type { LocalDate } from '../../lib/local-date'
import type { Habit } from '../../models/habit'
import { HABIT_CATEGORIES, getHabitCategory, type HabitCategory } from '../../models/habit-category'
import type { HabitEntry } from '../../models/habit-entry'
import { getDurationRating } from '../duration-service'
import { getAmountHabitProgress } from '../habit-service'
import { getHabitEntryDate, getWeekStart, isHabitExpectedOnDate, isWeeklyHabit } from '../habit-schedule'
import { getHabitPeriodDates, getStatisticsPeriod, getTimestampLocalDate, type StatisticsPeriod } from './period-utils'
import { getWeeklyHabitOccurrences } from './weekly-habit-statistics'

export const SUFFICIENT_DAY_COVERAGE = 50

export interface CategoryScore {
  category: HabitCategory
  score: number | null
  filled: number
  eligible: number
}

export interface DayScoreData {
  date: LocalDate
  score: number | null
  coverage: number | null
  filled: number
  eligible: number
  sufficient: boolean
  categories: CategoryScore[]
  unsupportedRatingCount: number
}

export interface WeeklyScoreData {
  startDate: LocalDate
  endDate: LocalDate
  days: DayScoreData[]
  score: number | null
  averageCoverage: number | null
  sufficientDays: number
  fullDays: number
  partialDays: number
  missingDays: number
  unavailableDays: number
  bestDay: DayScoreData | null
  worstDay: DayScoreData | null
  categories: { category: HabitCategory; score: number | null; days: number }[]
  weeklyGoals: { id: string; name: string; category: HabitCategory; score: number | null }[]
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Ordered levels run from best to worst. A sole configured level scores 100. */
export function getRatingLevelScore(index: number, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new Error('Некорректный уровень оценки.')
  }
  return count === 1 ? 100 : (1 - index / (count - 1)) * 100
}

/** Missing marks stay missing; this function never changes a stored result. */
export function getHabitScore(habit: Habit, entry: HabitEntry | undefined): number | null {
  // RatingHabit has no defined scale. Do not invent one from its stored values.
  if (habit.type === 'rating' || !entry) return null
  if (entry.habitId !== habit.id || entry.type !== habit.type) throw new Error('Тип записи не соответствует привычке.')
  if (habit.type === 'boolean' && entry.type === 'boolean') {
    if (entry.status === 'no-data') return null
    if (entry.status === 'success') return 100
    if (entry.status === 'failure') return 0
    throw new Error('Некорректная отметка привычки.')
  }
  if (habit.type === 'amount') return getAmountHabitProgress(habit, entry).progress
  if (habit.type === 'duration' && entry.type === 'duration') {
    const rating = getDurationRating(entry.minutes, habit.ratingRanges)
    return getRatingLevelScore(habit.ratingRanges.indexOf(rating), habit.ratingRanges.length)
  }
  throw new Error('Тип записи не соответствует привычке.')
}

function calculateDays(
  habits: Habit[], entries: HabitEntry[], period: StatisticsPeriod, firstRecordedDates?: ReadonlyMap<string, LocalDate>,
): DayScoreData[] {
  const entriesByHabit = new Map<string, HabitEntry[]>()
  for (const entry of entries) {
    const rows = entriesByHabit.get(entry.habitId) ?? []
    rows.push(entry)
    entriesByHabit.set(entry.habitId, rows)
  }
  const prepared = habits.map((habit) => {
    const rows = entriesByHabit.get(habit.id) ?? []
    return { habit, category: getHabitCategory(habit), byDate: new Map(rows.map((entry) => [entry.date, entry])),
      dates: new Set(getHabitPeriodDates(habit, rows, period, firstRecordedDates?.get(habit.id))) }
  })
  return period.dates.map((date) => {
    let unsupportedRatingCount = 0
    const groups = new Map<HabitCategory, { values: number[]; eligible: number }>()
    for (const item of prepared) {
      if (!item.dates.has(date) || !isHabitExpectedOnDate(item.habit, date)) continue
      const entryDate = getHabitEntryDate(item.habit, date)
      // Archiving ends availability on its local day, but existing facts remain scoreable.
      if (item.habit.archivedAt !== null && getTimestampLocalDate(item.habit.archivedAt) <= date && !item.byDate.has(entryDate)) continue
      if (item.habit.type === 'rating') { unsupportedRatingCount += 1; continue }
      const group = groups.get(item.category) ?? { values: [], eligible: 0 }
      group.eligible += 1
      const score = getHabitScore(item.habit, item.byDate.get(entryDate))
      if (score !== null) group.values.push(score)
      groups.set(item.category, group)
    }
    const categories = HABIT_CATEGORIES.flatMap(({ id }) => {
      const group = groups.get(id)
      return group ? [{ category: id, score: average(group.values), filled: group.values.length, eligible: group.eligible }] : []
    })
    const eligible = categories.reduce((sum, category) => sum + category.eligible, 0)
    const filled = categories.reduce((sum, category) => sum + category.filled, 0)
    const coverage = eligible === 0 ? null : filled / eligible * 100
    const score = average(categories.flatMap((category) => category.score === null ? [] : [category.score]))
    return { date, score, coverage, filled, eligible, categories, unsupportedRatingCount,
      sufficient: score !== null && coverage !== null && coverage >= SUFFICIENT_DAY_COVERAGE }
  })
}

export function calculateDayScore(
  habits: Habit[], entries: HabitEntry[], date: LocalDate, firstRecordedDates?: ReadonlyMap<string, LocalDate>,
): DayScoreData {
  const period = getStatisticsPeriod('custom', date, { startDate: date, endDate: date })
  return calculateDays(habits, entries, period, firstRecordedDates)[0]!
}

/** Calendar week to the chosen date; each weekly goal contributes once inside its category. */
export function calculateWeeklyScore(
  habits: Habit[], entries: HabitEntry[], endDate: LocalDate, firstRecordedDates?: ReadonlyMap<string, LocalDate>,
  today: LocalDate = endDate,
): WeeklyScoreData {
  const period = getStatisticsPeriod('custom', today, { startDate: getWeekStart(endDate), endDate })
  const days = calculateDays(habits, entries, period, firstRecordedDates)
  const sufficientDays = days.filter((day) => day.sufficient)
  // Assigned weekly goals can appear in a DayScore, but are never counted twice here.
  const dailyDays = calculateDays(habits.filter((habit) => !isWeeklyHabit(habit)), entries, period, firstRecordedDates)
  const sufficientDailyDays = dailyDays.filter((day) => day.sufficient)
  const weeklyGoals = habits.filter((habit) => isWeeklyHabit(habit) && habit.type !== 'rating').flatMap((habit) => {
    const occurrence = getWeeklyHabitOccurrences(habit, entries, period, firstRecordedDates?.get(habit.id))[0]
    if (!occurrence) return []
    const score = occurrence.inferredFailure ? 0 : getHabitScore(habit, occurrence.entry)
    return [{ id: habit.id, name: habit.name, category: getHabitCategory(habit), score }]
  })
  const eligibleDays = days.filter((day) => day.eligible > 0)
  const ranked = [...sufficientDays].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.date.localeCompare(b.date))
  const categories = HABIT_CATEGORIES.map(({ id }) => {
    const values = sufficientDailyDays.flatMap((day) => {
      const score = day.categories.find((category) => category.category === id)?.score
      return score === null || score === undefined ? [] : [score]
    })
    const goals = weeklyGoals.flatMap((goal) => goal.category === id && goal.score !== null ? [goal.score] : [])
    return { category: id, score: average([...values, ...goals]), days: values.length }
  })
  return {
    startDate: period.startDate, endDate, days,
    score: average(categories.flatMap((category) => category.score === null ? [] : [category.score])),
    averageCoverage: average(eligibleDays.map((day) => day.coverage!)),
    sufficientDays: sufficientDays.length,
    fullDays: eligibleDays.filter((day) => day.filled === day.eligible).length,
    partialDays: eligibleDays.filter((day) => day.filled > 0 && day.filled < day.eligible).length,
    missingDays: eligibleDays.filter((day) => day.filled === 0).length,
    unavailableDays: days.length - eligibleDays.length,
    bestDay: ranked[0] ?? null,
    worstDay: [...sufficientDays].sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.date.localeCompare(b.date))[0] ?? null,
    categories, weeklyGoals,
  }
}

export function getDayScoreInterpretation(score: number | null): string {
  if (score === null) return 'Нет данных для оценки'
  if (score >= 90) return 'Отличный день'
  if (score >= 75) return 'Хороший день'
  if (score >= 60) return 'Нормальный день'
  if (score >= 40) return 'Слабый результат'
  return 'Много целей осталось невыполненными'
}
