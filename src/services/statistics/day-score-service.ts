import { db, type TaskTrackerDatabase } from '../../db/database'
import { getLocalDate, type LocalDate } from '../../lib/local-date'
import type { Habit } from '../../models/habit'
import { calculateDayScore, calculateWeeklyScore, type DayScoreData, type WeeklyScoreData } from './day-score'
import { getTimestampLocalDate } from './period-utils'
import { getWeekStart } from '../habit-schedule'

/** One indexed query for lifecycle context, shared by compact and full statistics. */
export async function readFirstRecordedDates(database: TaskTrackerDatabase, habits: Habit[], startDate: LocalDate) {
  const ranges = habits.filter((habit) => getTimestampLocalDate(habit.createdAt) > startDate)
    .map((habit) => [[habit.id, '0000-01-01'], [habit.id, startDate]] as const)
  const keys = ranges.length === 0 ? [] : await database.habitEntries.where('[habitId+date]')
    .inAnyRange(ranges, { includeLowers: true, includeUppers: false }).primaryKeys()
  const firstRecordedDates = new Map<string, LocalDate>()
  for (const [habitId, date] of keys) {
    const first = firstRecordedDates.get(habitId)
    if (first === undefined || date < first) firstRecordedDates.set(habitId, date)
  }
  return firstRecordedDates
}

export class DayScoreService {
  constructor(private readonly database: TaskTrackerDatabase) {}

  async getDayScore(date: LocalDate): Promise<DayScoreData> {
    const database = this.database
    return database.transaction('r', [database.habits, database.habitEntries], async () => {
      const [habits, entries] = await Promise.all([
        database.habits.toArray(), database.habitEntries.where('date').between(getWeekStart(date), date, true, true).toArray(),
      ])
      const firstRecordedDates = await readFirstRecordedDates(database, habits, date)
      return calculateDayScore(habits, entries, date, firstRecordedDates)
    })
  }

  async getWeeklyScore(date: LocalDate): Promise<WeeklyScoreData> {
    const database = this.database
    const startDate = getWeekStart(date)
    return database.transaction('r', [database.habits, database.habitEntries], async () => {
      const [habits, entries] = await Promise.all([
        database.habits.toArray(), database.habitEntries.where('date').between(startDate, date, true, true).toArray(),
      ])
      const firstRecordedDates = await readFirstRecordedDates(database, habits, startDate)
      return calculateWeeklyScore(habits, entries, date, firstRecordedDates, getLocalDate())
    })
  }
}

const dayScoreService = new DayScoreService(db)
export const getDayScore = (date: LocalDate) => dayScoreService.getDayScore(date)
export const getWeeklyScore = (date: LocalDate) => dayScoreService.getWeeklyScore(date)
