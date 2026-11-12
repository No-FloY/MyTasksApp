import type { LocalDate } from '../../lib/local-date'
import type { BooleanHabit } from '../../models/habit'
import type { HabitEntry } from '../../models/habit-entry'
import { getWeekStart } from '../habit-schedule'
import { calculateBooleanStatistics, type BooleanStatistics } from './habit-statistics'
import type { StatisticsPeriod } from './period-utils'

function countDays(days: BooleanStatistics['days']) {
  const drankDays = days.filter((day) => day.status === 'success').length
  const didNotDrinkDays = days.filter((day) => day.status === 'failure').length
  const filledDays = drankDays + didNotDrinkDays
  return {
    drankDays, didNotDrinkDays, filledDays, eligibleDays: days.length,
    noDataDays: days.length - filledDays,
    frequencyPercent: filledDays === 0 ? null : drankDays / filledDays * 100,
    explicitDays: days.filter((day) => day.source === 'explicit' && day.status !== 'no-data').length,
    inferredDays: days.filter((day) => day.source === 'inferred').length,
  }
}

/** Neutral event counts reuse resolved days, never success scores or stored counters. */
export function calculateCoffeeStatistics(habit: BooleanHabit, entries: HabitEntry[], period: StatisticsPeriod,
  firstRecordedDate?: LocalDate, prepared?: BooleanStatistics) {
  const statistics = prepared ?? calculateBooleanStatistics(habit, entries, period, firstRecordedDate)
  const byDate = new Map(statistics.days.map((day) => [day.date, day]))
  const buckets = (keyFor: (date: LocalDate) => string) => {
    const groups = new Map<string, LocalDate[]>()
    for (const date of period.dates) {
      const key = keyFor(date)
      const dates = groups.get(key) ?? []
      dates.push(date)
      groups.set(key, dates)
    }
    return [...groups.values()].map((dates) => ({ startDate: dates[0]!, endDate: dates.at(-1)!,
      ...countDays(dates.flatMap((date) => { const result = byDate.get(date); return result ? [result] : [] })) }))
  }
  return { habit, days: statistics.days, ...countDays(statistics.days),
    weeks: buckets(getWeekStart), months: buckets((date) => date.slice(0, 7)) }
}

export type CoffeeStatistics = ReturnType<typeof calculateCoffeeStatistics>
