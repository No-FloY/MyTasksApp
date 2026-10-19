import { describe, expect, it } from 'vitest'
import { getInitialDurationRanges } from '../../db/duration-defaults'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { DurationHabit } from '../../models/habit'
import type { DurationHabitEntry } from '../../models/habit-entry'
import { calculateDurationStatistics } from './duration-statistics'
import { getStatisticsPeriod } from './period-utils'

const timestamp = '2026-09-20T10:00:00.000Z'
function habit(id = 'gaming'): DurationHabit {
  return { id, name: id, type: 'duration', unit: 'minutes', ratingRanges: getInitialDurationRanges(id), description: '', order: 0, createdAt: timestamp, updatedAt: timestamp, archivedAt: null }
}
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
function entry(day: string, minutes: number, habitId = 'gaming'): DurationHabitEntry {
  return { habitId, date: date(day), type: 'duration', minutes, createdAt: timestamp, updatedAt: timestamp }
}
const period = getStatisticsPeriod('7d', date('2026-10-16'))

describe('duration statistics over selected periods', () => {
  it('keeps actual minutes and separates averages by recorded and eligible calendar days', () => {
    const entries = [entry('2026-10-10', 0), entry('2026-10-12', 120), entry('2026-10-16', 360)]
    expect(calculateDurationStatistics(habit(), entries, period)).toMatchObject({
      totalMinutes: 480, recordedDays: 3, missingDays: 4, eligibleDays: 7,
      averageMinutes: 160, averagePerDayMinutes: 480 / 7, minimumMinutes: 0, maximumMinutes: 360,
    })
  })

  it('uses null averages/min/max for no data and retains the empty chart as null points', () => {
    const result = calculateDurationStatistics(habit(), [], period)
    expect(result).toMatchObject({ totalMinutes: 0, recordedDays: 0, averageMinutes: null, averagePerDayMinutes: null, minimumMinutes: null, maximumMinutes: null, missingDays: 7 })
    expect(result.days.every((day) => day.minutes === null && day.rating === null)).toBe(true)
    expect(result.ratingCounts.every((count) => count.days === 0)).toBe(true)
  })

  it('counts a recorded zero as data with an excellent rating', () => {
    const result = calculateDurationStatistics(habit(), [entry('2026-10-16', 0)], period)
    expect(result).toMatchObject({ recordedDays: 1, averageMinutes: 0, averagePerDayMinutes: 0, minimumMinutes: 0, maximumMinutes: 0 })
    expect(result.ratingCounts[0]?.days).toBe(1)
  })

  it('distributes gaming categories from saved minute boundaries', () => {
    const values = [0, 120, 121, 241, 330, 361]
    const entries = values.map((minutes, index) => entry(`2026-10-${10 + index}`, minutes))
    const result = calculateDurationStatistics(habit(), entries, period)
    expect(result.ratingCounts.map(({ rating, days }) => [rating.id, days])).toEqual([
      ['excellent', 2], ['good', 1], ['neutral', 1], ['poor', 1], ['very-poor', 1],
    ])
    expect(result.totalMinutes).toBe(values.reduce((sum, minutes) => sum + minutes, 0))
  })

  it('keeps social media independent with its own saved rating configuration', () => {
    const entries = [entry('2026-10-10', 60, 'social-media'), entry('2026-10-11', 61, 'social-media'), entry('2026-10-12', 90, 'social-media'), entry('2026-10-13', 91, 'social-media'), entry('2026-10-16', 1440)]
    const result = calculateDurationStatistics(habit('social-media'), entries, period)
    expect(result).toMatchObject({ totalMinutes: 302, averageMinutes: 75.5, recordedDays: 4, maximumMinutes: 91 })
    expect(result.ratingCounts.map(({ rating, days }) => [rating.id, days])).toEqual([['excellent', 1], ['good', 2], ['poor', 1]])
  })

  it('re-evaluates categories from the current ranges without changing actual saved time', () => {
    const configured = { ...habit(), ratingRanges: [{ id: 'all', label: 'Одна категория', emoji: '🙂', minMinutes: 0, maxMinutes: null }] }
    const entries = [entry('2026-10-10', 180), entry('2026-10-16', 420)]
    const original = structuredClone(entries)
    const result = calculateDurationStatistics(configured, entries, period)
    expect(result.ratingCounts.map(({ rating, days }) => [rating.id, days])).toEqual([['all', 2]])
    expect(result).toMatchObject({ totalMinutes: 600, averageMinutes: 300 })
    expect(entries).toEqual(original)
  })

  it('retains full chart dates for a new habit but averages over only days it existed', () => {
    const createdLater = { ...habit(), createdAt: '2026-10-15T10:00:00.000Z' }
    const result = calculateDurationStatistics(createdLater, [entry('2026-10-16', 60)], period)
    expect(result).toMatchObject({ eligibleDays: 2, ineligibleDays: 5, missingDays: 6, noDataCount: 1, averageMinutes: 60, averagePerDayMinutes: 30 })
    expect(result.days).toHaveLength(7)
  })

  it('keeps historical archived results without adding empty post-archive days to the average denominator', () => {
    const archived = { ...habit(), createdAt: '2026-10-13T10:00:00.000Z', archivedAt: '2026-10-14T10:00:00.000Z' }
    expect(calculateDurationStatistics(archived, [entry('2026-10-14', 60)], period)).toMatchObject({ eligibleDays: 2, ineligibleDays: 5, missingDays: 6, noDataCount: 1, averagePerDayMinutes: 30, totalMinutes: 60 })
  })

  it('excludes days outside the selected period', () => {
    const entries = [entry('2026-10-09', 1440), entry('2026-10-17', 1440), entry('2026-10-16', 20)]
    expect(calculateDurationStatistics(habit(), entries, period)).toMatchObject({ totalMinutes: 20, recordedDays: 1, maximumMinutes: 20 })
  })
})
