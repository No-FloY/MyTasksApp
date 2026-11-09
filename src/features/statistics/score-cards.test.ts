import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getLocalDate } from '@/lib/local-date'
import type { DayScoreData, WeeklyScoreData } from '@/services/statistics/day-score'
import { DayScoreCard } from './DayScore'
import { WeeklyScoreCard } from './WeeklyScoreCard'
import { ScoreRing } from './ScoreRing'

const date = getLocalDate(new Date(2026, 10, 5))
const day: DayScoreData = {
  date, score: null, coverage: 0, filled: 0, eligible: 2, sufficient: false,
  categories: [{ category: 'food_water', score: null, filled: 0, eligible: 2 }], unsupportedRatingCount: 0,
}
const week: WeeklyScoreData = {
  startDate: getLocalDate(new Date(2026, 10, 2)), endDate: date, days: [day], score: 0,
  averageCoverage: 0, sufficientDays: 0, fullDays: 0, partialDays: 0, missingDays: 1, unavailableDays: 0,
  bestDay: null, worstDay: null, categories: [{ category: 'routine', score: 0, days: 0 }],
  weeklyGoals: [{ id: 'cleaning', name: 'Уборка', category: 'routine', score: 0 }],
}

describe('compact score cards', () => {
  it.each([null, 0, 76.6, 100])('communicates an accessible score without confusing empty and zero: %s', (score) => {
    const html = renderToStaticMarkup(createElement(ScoreRing, { score, label: 'Оценка дня', testId: 'value' }))
    const value = score === null ? 'Нет данных' : `${Math.round(score)}%`
    expect(html).toContain(`aria-label="Оценка дня: ${value}"`)
    expect(html).toContain(`data-testid="value">${value}</strong>`)
    expect(html.includes('score-ring-progress')).toBe(score !== null)
  })

  it('shows a short empty prompt with an entry action and an exact day link; formulas start collapsed', () => {
    const html = renderToStaticMarkup(createElement(DayScoreCard, { data: day, onStartEntry: () => {} }))
    expect(html).toContain('Добавьте первую отметку за день.')
    expect(html).toContain('Заполнить привычки</button>')
    expect(html).toContain('href="#statistics?period=day&amp;date=2026-11-05"')
    expect(html).toContain('aria-label="Подробнее об оценке дня"')
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    expect(html).toContain('У категорий равный вес.')
    expect(html).not.toContain('class="score-category-preview"')
  })

  it('keeps a real failed day and category visible while separating low coverage', () => {
    const data: DayScoreData = { ...day, score: 0, coverage: 50, filled: 1, sufficient: true,
      categories: [{ category: 'food_water', score: 0, filled: 1, eligible: 2 }] }
    const html = renderToStaticMarkup(createElement(DayScoreCard, { data }))
    expect(html).toContain('data-testid="day-score-value" data-statistic="day-score">0%</strong>')
    expect(html).toContain('data-testid="day-coverage">50%</strong>')
    expect(html).toContain('data-score-category="food_water"')
    expect(html).toContain('aria-label="Кратко по категориям"')
    expect(html).not.toContain('Заполнить привычки</button>')
  })

  it('keeps weekly-only goals visible without requiring sufficient daily results', () => {
    const html = renderToStaticMarkup(createElement(WeeklyScoreCard, { data: week, compact: true }))
    expect(html).toContain('data-weekly-score-habit="cleaning"')
    expect(html).toContain('Уборка · раз в неделю')
    expect(html).toContain('data-weekly-habit-result="cleaning">0%</dd>')
    expect(html.indexOf('data-weekly-score-habit="cleaning"')).toBeLessThan(html.indexOf('<details'))
    expect(html).toContain('href="#statistics?period=week&amp;date=2026-11-05"')
    expect(html).toContain('aria-label="Подробнее об оценке недели"')
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    expect(html).toContain('Неполная неделя создания или архивации остаётся без данных.')
  })
})
