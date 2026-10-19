import { Card } from '@/components/ui/card'
import type { StatisticsDashboard } from '@/services/statistics/statistics-service'
import { formatMinutes, formatRate } from './format-statistics'

export function StatisticsSummary({ data }: { data: StatisticsDashboard }) {
  return <section className="statistics-section" aria-labelledby="statistics-overview-heading" data-testid="statistics-summary">
    <h2 id="statistics-overview-heading">Обзор периода</h2>
    <div className="statistics-summary-grid">
      <Card className="statistics-summary-card"><h3>Привычки</h3><strong>{formatRate(data.habitSuccessRate)}</strong><p>успехов среди {data.markedCount} явных отметок</p></Card>
      {data.amounts.map((item) => <Card key={item.habit.id} className="statistics-summary-card"><h3>{item.habit.name}{item.habit.archivedAt && ' · архив'}</h3><strong>{item.daysWithData === 0 ? 'Нет данных' : `${item.successfulDays} / ${item.daysWithData} дн.`}</strong><p>цель достигнута · только дни с записью</p></Card>)}
      {data.durations.map((item) => <Card key={item.habit.id} className="statistics-summary-card"><h3>{item.habit.name}{item.habit.archivedAt && ' · архив'}</h3><strong>{formatMinutes(item.averageMinutes)}</strong><p>в среднем за день с записью</p></Card>)}
      <Card className="statistics-summary-card"><h3>Задачи</h3><strong>{formatRate(data.tasks.onTimeRate)}</strong><p>{data.tasks.completedOnTime} из {data.tasks.relevantTasks} задач с результатом — вовремя</p></Card>
      <Card className="statistics-summary-card"><h3>Цели · сейчас</h3><strong>{data.goals.activeGoals} активных</strong><p>{data.goals.completedGoals} завершено · текущее состояние</p></Card>
    </div>
  </section>
}
