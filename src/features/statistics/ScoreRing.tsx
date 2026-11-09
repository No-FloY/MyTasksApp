import type { HabitCategory } from '@/models/habit-category'
import { HABIT_CATEGORIES } from '@/models/habit-category'
import './day-score.css'

export function ScoreRing({ score, label, testId, statistic, small = false }: {
  score: number | null
  label: string
  testId?: string
  statistic?: string
  small?: boolean
}) {
  const value = score === null ? null : Math.max(0, Math.min(100, Math.round(score)))
  const text = value === null ? 'Нет данных' : `${value}%`
  const tone = value === null ? 'empty' : value >= 75 ? 'good' : value >= 50 ? 'medium' : 'low'
  return <div className={`score-ring score-ring-${tone}${small ? ' score-ring-small' : ''}`} role="img" aria-label={`${label}: ${text}`}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle className="score-ring-track" cx="50" cy="50" r="43" />
      {value !== null && <circle className="score-ring-progress" cx="50" cy="50" r="43" pathLength="100" strokeDasharray={`${value} 100`} />}
    </svg>
    <strong data-testid={testId} data-statistic={statistic}>{text}</strong>
  </div>
}

export function ScoreCategoryPreview({ categories }: { categories: { category: HabitCategory; score: number | null }[] }) {
  const filled = categories.filter((category) => category.score !== null)
  if (filled.length === 0) return null
  return <ul className="score-category-preview" aria-label="Кратко по категориям">
    {filled.slice(0, 3).map((category) => <li key={category.category}>
      <span>{HABIT_CATEGORIES.find((item) => item.id === category.category)?.label}</span>
      <strong>{Math.round(category.score!)}%</strong>
    </li>)}
    {filled.length > 3 && <li className="score-category-more">Ещё {filled.length - 3} в подробностях</li>}
  </ul>
}
