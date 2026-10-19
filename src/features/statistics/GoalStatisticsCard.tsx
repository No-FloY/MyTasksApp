import { Card } from '@/components/ui/card'
import type { GoalStatistics } from '@/services/statistics/goal-statistics'
import { formatRate } from './format-statistics'

export function GoalStatisticsCard({ data }: { data: GoalStatistics }) {
  return <section className="statistics-section" aria-labelledby="goal-statistics-heading" data-testid="goal-statistics">
    <Card className="statistics-card">
      <h2 id="goal-statistics-heading">Цели · текущее состояние</h2>
      <p className="week-explanation">Эта сводка не зависит от выбранного периода. История изменения прогресса не сохранялась; показаны текущие значения целей вне архива.</p>
      <dl className="statistics-small-metrics statistics-goal-metrics">
        <div><dt>Активные</dt><dd data-statistic="active">{data.activeGoals}</dd></div>
        <div><dt>Завершены</dt><dd data-statistic="completed">{data.completedGoals}</dd></div>
        <div><dt>Не достигнуты</dt><dd data-statistic="failed">{data.failedGoals}</dd></div>
        <div><dt>Отменены</dt><dd data-statistic="cancelled">{data.cancelledGoals}</dd></div>
        <div><dt>Просрочены среди активных</dt><dd data-statistic="overdue">{data.overdueGoals}</dd></div>
        <div><dt>Средний прогресс активных</dt><dd data-statistic="average-progress">{formatRate(data.averageProgress)}</dd></div>
      </dl>
      {data.totalGoals === 0 && <p className="statistics-empty">Пока нет целей вне архива.</p>}
      <p className="week-explanation">Всего вне архива: <span data-statistic="total">{data.totalGoals}</span>. Целей в архиве: <span data-statistic="archived">{data.archivedGoals}</span>. Средний прогресс учитывает каждую активную цель с равным весом и её режим AUTO/MANUAL.</p>
    </Card>
  </section>
}
