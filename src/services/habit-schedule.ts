import { endOfWeek, getISODay, parseISO, startOfWeek } from 'date-fns'
import { getLocalDate, isLocalDate, type LocalDate } from '../lib/local-date'
import type { Habit } from '../models/habit'
import type { HabitSchedule } from '../models/habit-schedule'

type ScheduledHabit = Pick<Habit, 'schedule'>

export function getHabitSchedule(habit: ScheduledHabit): HabitSchedule {
  return habit.schedule ?? { type: 'daily' }
}

export function isWeeklyHabit(habit: ScheduledHabit): boolean {
  return getHabitSchedule(habit).type === 'weekly'
}

function localDay(date: LocalDate): Date {
  if (!isLocalDate(date)) throw new Error('Некорректная календарная дата.')
  return parseISO(date)
}

export function getWeekStart(date: LocalDate): LocalDate {
  return getLocalDate(startOfWeek(localDay(date), { weekStartsOn: 1 }))
}

export function getWeekEnd(date: LocalDate): LocalDate {
  return getLocalDate(endOfWeek(localDay(date), { weekStartsOn: 1 }))
}

/** Unscheduled weekly goals belong to the week, never to every daily coverage. */
export function isHabitExpectedOnDate(habit: ScheduledHabit, date: LocalDate): boolean {
  const weekday = getISODay(localDay(date))
  const schedule = getHabitSchedule(habit)
  if (schedule.type === 'daily') return true
  if (schedule.type === 'weekdays') return schedule.days.includes(weekday)
  return schedule.weekday === weekday
}

/** All views edit the same occurrence, regardless of the selected day of its week. */
export function getHabitEntryDate(habit: ScheduledHabit, date: LocalDate): LocalDate {
  return isWeeklyHabit(habit) ? getWeekStart(date) : getLocalDate(localDay(date))
}
