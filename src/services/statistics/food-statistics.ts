import type { LocalDate } from '../../lib/local-date'
import type { BooleanHabit, Habit } from '../../models/habit'
import type { HabitEntry } from '../../models/habit-entry'
import { calculateBooleanStatistics } from './habit-statistics'
import { getStatisticsPeriod, type StatisticsPeriod } from './period-utils'

const mealIds = ['breakfast', 'lunch', 'dinner'] as const

/** These are views over ordinary boolean facts, with no extra counters or storage. */
export function calculateFoodStatistics(
  habits: Habit[], entries: HabitEntry[], period: StatisticsPeriod, firstRecordedDates?: ReadonlyMap<string, LocalDate>,
) {
  const byId = new Map(habits.filter((habit): habit is BooleanHabit => habit.type === 'boolean').map((habit) => [habit.id, habit]))
  const statsFor = (habit: BooleanHabit, range: StatisticsPeriod) =>
    calculateBooleanStatistics(habit, entries, range, firstRecordedDates?.get(habit.id))
  const alcoholHabit = byId.get('no-alcohol')
  const monthDates = new Map<string, LocalDate[]>()
  for (const date of period.dates) {
    const month = date.slice(0, 7)
    const dates = monthDates.get(month) ?? []
    dates.push(date)
    monthDates.set(month, dates)
  }
  const alcohol = alcoholHabit ? {
    selected: statsFor(alcoholHabit, period),
    currentMonth: statsFor(alcoholHabit, getStatisticsPeriod('month', period.today)),
    months: [...monthDates].map(([month, dates]) => ({ month,
      ...statsFor(alcoholHabit, getStatisticsPeriod('custom', period.today, { startDate: dates[0]!, endDate: dates.at(-1)! })),
    })),
  } : null
  const meals = mealIds.flatMap((id) => {
    const habit = byId.get(id)
    return habit ? [statsFor(habit, period)] : []
  })
  const mealDays = meals.map((meal) => new Map(meal.days.map((day) => [day.date, day.status])))
  const eligibleDates = meals.length === 3 ? period.dates.filter((date) => mealDays.every((days) => days.has(date))) : []
  const fullMealDays = eligibleDates.filter((date) => mealDays.every((days) => days.get(date) === 'success')).length
  return { alcohol, meals, fullMealDays, eligibleMealDays: eligibleDates.length }
}
