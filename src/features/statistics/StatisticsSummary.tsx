import { Card } from '@/components/ui/card'
import { Activity, CheckCheck, CircleCheck, Dumbbell, Monitor, PieChart } from 'lucide-react'
import type { StatisticsDashboard } from '@/services/statistics/statistics-service'
import { getDayScoreInterpretation } from '@/services/statistics/day-score'
import { formatMinutes, formatRate } from './format-statistics'
import { ScoreRing } from './ScoreRing'

export function StatisticsSummary({ data }: { data: StatisticsDashboard }) {
  const { dashboard, period, tasks } = data
  const day = period.preset === 'day'
  const scoreTitle = day ? 'Оценка дня' : period.preset === 'week' ? 'Оценка недели' : period.preset === 'month' ? 'Оценка месяца' : 'Оценка периода'
  const completed = tasks.completedOnTime + tasks.completedLate + tasks.completedUnknown
  const markedHabits = dashboard.habits.successCount + dashboard.habits.failureCount
  return <section className="statistics-section" aria-labelledby="statistics-overview-heading" data-testid="statistics-summary">
    <h2 id="statistics-overview-heading" className="sr-only">Обзор периода</h2>
    <div className="statistics-summary-grid">
      <Card className="statistics-summary-card dashboard-score" data-testid="dashboard-score">
        <h3><Activity size={16} aria-hidden="true" />{scoreTitle}</h3>
        <ScoreRing score={dashboard.score} label={scoreTitle} testId="dashboard-score-value" small />
        <p>{day ? getDayScoreInterpretation(dashboard.score) : dashboard.score === null ? 'Недостаточно заполненных дней' : `${dashboard.sufficientDays} дн. с достаточными данными`}</p>
      </Card>
      <Card className="statistics-summary-card" data-testid="dashboard-coverage">
        <h3><PieChart size={16} aria-hidden="true" />Заполненность</h3><strong data-testid="dashboard-coverage-value">{formatRate(dashboard.averageCoverage)}</strong>
        <div className="dashboard-mini-meter" aria-hidden="true"><span style={{ width: `${dashboard.averageCoverage ?? 0}%` }} /></div>
        <p><span data-testid="dashboard-filled">{dashboard.filled} / {dashboard.eligible}</span> результатов{!day && ' · в среднем по дням'}</p>
      </Card>
      <Card className="statistics-summary-card" data-testid="dashboard-habits">
        <h3><CircleCheck size={16} aria-hidden="true" />Привычки</h3><strong>{markedHabits ? `${dashboard.habits.successCount} / ${markedHabits}` : 'Нет данных'}</strong>
        <p>{markedHabits ? `выполнено · ${dashboard.habits.failureCount} не выполнено` : 'Пока нет результатов'}{dashboard.habits.noDataCount > 0 && ` · ${dashboard.habits.noDataCount} без данных`}</p>
      </Card>
      <Card className="statistics-summary-card" data-testid="dashboard-training">
        <h3><Dumbbell size={16} aria-hidden="true" />Тренировка</h3><strong>{dashboard.training.recordedDays === 0 ? 'Нет данных' : day ? dashboard.training.workoutDays ? 'Была' : 'Не было' : `${dashboard.training.workoutDays} дн.`}</strong>
        <p>{day ? 'Результат выбранного дня' : `с тренировкой · известно ${dashboard.training.recordedDays} дн.`}</p>
      </Card>
      <Card className="statistics-summary-card" data-testid="dashboard-screen-time">
        <h3><Monitor size={16} aria-hidden="true" />Экранное время</h3><strong>{formatMinutes(day ? dashboard.screenTime.totalMinutes : dashboard.screenTime.averageMinutes)}</strong>
        <p>{day ? 'Игры и соцсети · сохранённое время' : `в день с записью · ${dashboard.screenTime.recordedDays} дн.`}</p>
      </Card>
      <Card className="statistics-summary-card" data-testid="dashboard-tasks">
        <h3><CheckCheck size={16} aria-hidden="true" />Задачи</h3><strong>{tasks.tasksDue ? `${completed} / ${tasks.tasksDue}` : 'Нет задач'}</strong>
        <p>{tasks.tasksDue ? `выполнено · ${tasks.completedOnTime} вовремя` : 'Нет сроков в этом периоде'}</p>
      </Card>
    </div>
  </section>
}
