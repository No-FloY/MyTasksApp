import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInitialHabits } from '../../db/seed'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { HabitEntry } from '../../models/habit-entry'
import { calculateStatistics } from '../../services/statistics/statistics-service'
import { getStatisticsPeriod, type StatisticsPreset } from '../../services/statistics/period-utils'
import { PeriodPicker } from './PeriodPicker'
import { StatisticsOverview } from './StatisticsOverview'
import { StatisticsSummary } from './StatisticsSummary'
import { StatisticsTabs } from './StatisticsTabs'

const timestamp = '2026-10-01T10:00:00.000Z'
const now = new Date('2026-10-23T12:00:00.000Z')
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
const today = date('2026-10-23')
const selectedDay = date('2026-10-22')
function data(preset: StatisticsPreset, entries: HabitEntry[] = [], selected = selectedDay) {
  const period = getStatisticsPeriod(preset, today, undefined, selected)
  return calculateStatistics({ habits: createInitialHabits(timestamp), entries, tasks: [], goals: [], milestones: [] }, period, now)
}
const marks: HabitEntry[] = [
  { habitId: 'english', type: 'boolean', status: 'success', date: selectedDay, createdAt: timestamp, updatedAt: timestamp },
  { habitId: 'workout', type: 'boolean', status: 'failure', date: selectedDay, createdAt: timestamp, updatedAt: timestamp },
  { habitId: 'gaming', type: 'duration', minutes: 0, date: selectedDay, createdAt: timestamp, updatedAt: timestamp },
  { habitId: 'english', type: 'boolean', status: 'failure', date: today, createdAt: timestamp, updatedAt: timestamp },
]

describe('statistics dashboard presentation', () => {
  it('renders selected day values, a recorded zero and category bars from that day only', () => {
    const html = renderToStaticMarkup(createElement(StatisticsOverview, { data: data('day', marks) }))
    expect(html).toContain('data-testid="dashboard-filled">3 / 22')
    expect(html).toContain('data-testid="dashboard-category-self_development"')
    expect(html).toContain('aria-label="Оценка категории: Саморазвитие" aria-valuenow="100"')
    expect(html).toContain('aria-label="Оценка категории: Тренировка" aria-valuenow="0"')
    expect(html).toContain('data-testid="dashboard-screen-time"')
    expect(html).toContain('0 ч 0 мин')
    expect(html).toContain('1 / 2')
    expect(html).not.toContain('data-testid="dashboard-trend"')
    expect(html).not.toMatch(/NaN|Infinity/)
  })

  it('uses a compact empty state linking to the selected historical date', () => {
    const html = renderToStaticMarkup(createElement(StatisticsOverview, { data: data('day') }))
    expect(html).toContain('Пока нет данных')
    expect(html).toContain('href="#calendar?date=2026-10-22&amp;month=2026-10"')
    expect(html).toContain('Заполнить выбранный день')
    expect(html).not.toContain('data-testid="dashboard-score"')
    expect(html).not.toContain('data-testid="dashboard-trend"')
    expect(html).not.toContain('role="meter"')
  })

  it('links an empty current period to Today and keeps missing values distinct from zero', () => {
    expect(renderToStaticMarkup(createElement(StatisticsOverview, { data: data('week', [], today) }))).toContain('href="#today"')
    const html = renderToStaticMarkup(createElement(StatisticsSummary, { data: data('day') }))
    expect(html).toContain('data-testid="dashboard-score-value">Нет данных')
    expect(html).toContain('Нет задач')
    expect(html).toContain('Нет данных')
    expect(html).not.toMatch(/NaN|Infinity/)
  })

  it('keeps six overview metrics and long-range chart details collapsed', () => {
    const html = renderToStaticMarkup(createElement(StatisticsOverview, { data: data('month', marks) }))
    for (const metric of ['score', 'coverage', 'habits', 'training', 'screen-time', 'tasks']) expect(html).toContain(`data-testid="dashboard-${metric}"`)
    expect(html).toContain('Оценка месяца')
    expect(html).toContain('Подробная динамика по неделям')
    expect(html).not.toContain('data-testid="weekly-statistics"')
    expect(html).not.toContain('<details open')
  })

  it('exposes only the selected detail tab in the keyboard tab order', () => {
    const html = renderToStaticMarkup(createElement(StatisticsTabs, { selected: 'nutrition', onSelect: () => undefined }))
    expect(html).toContain('role="tablist" aria-label="Разделы статистики"')
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(6)
    expect(html).toContain('id="statistics-tab-nutrition" aria-selected="true" aria-controls="statistics-panel-nutrition"')
  })
})

describe('statistics period controls', () => {
  it('shows the concrete selected date and limits the date input to today', () => {
    const html = renderToStaticMarkup(createElement(PeriodPicker, { period: getStatisticsPeriod('day', today, undefined, selectedDay) }))
    expect(html).toContain('type="date" max="2026-10-23" value="2026-10-22"')
    expect(html).toContain('Опорная дата')
    expect(html).toContain('aria-pressed="true">День')
  })

  it('disables moving into a future week and labels the chosen calendar month', () => {
    const week = renderToStaticMarkup(createElement(PeriodPicker, { period: getStatisticsPeriod('week', today) }))
    expect(week).toContain('aria-label="Следующий период" disabled=""')
    const month = renderToStaticMarkup(createElement(PeriodPicker, { period: getStatisticsPeriod('month', today, undefined, date('2026-09-14')) }))
    expect(month).toContain('Выбранный месяц')
    expect(month).toContain('type="month" max="2026-10" value="2026-09"')
    expect(month).toContain('1 сент. 2026 — 30 сент. 2026')
  })

  it('preserves inclusive custom bounds and exposes six required period choices', () => {
    const period = getStatisticsPeriod('custom', today, { startDate: '2026-10-02', endDate: '2026-10-11' })
    const html = renderToStaticMarkup(createElement(PeriodPicker, { period }))
    expect(html).toContain('value="2026-10-02"')
    expect(html).toContain('value="2026-10-11"')
    expect(html).toContain('Применить период')
    for (const label of ['День', 'Неделя', 'Месяц', '3 месяца', 'Год', 'Произвольный']) expect(html).toContain(label)
  })
})
