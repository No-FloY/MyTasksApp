import { Card } from '@/components/ui/card'
import type { StatisticsDashboard } from '@/services/statistics/statistics-service'
import { formatRate } from './format-statistics'

export function HabitStatistics({ data }: { data: StatisticsDashboard }) {
  return <section className="statistics-section" aria-labelledby="boolean-statistics-heading">
    <h2 id="boolean-statistics-heading">Привычки</h2>
    <p className="week-explanation">Доля успехов = успехи / (успехи + неудачи). «Нет данных» не считается неудачей. Серии ограничены выбранным периодом; текущая заканчивается его последним днём.</p>
    {data.booleans.length === 0 && <p className="statistics-empty">В этом периоде ещё не было привычек.</p>}
    <div className="boolean-statistics-grid">{data.booleans.map((item) => <Card key={item.habit.id} className="statistics-habit-card" data-boolean-statistics-id={item.habit.id}>
      <div className="statistics-habit-title"><h3>{item.habit.name}</h3>{item.habit.archivedAt && <span className="statistics-badge">Архив</span>}</div>
      <strong className="statistics-habit-rate" data-statistic="success-rate">{formatRate(item.successRate)}</strong>
      {item.successRate !== null && <div className="statistics-meter" role="meter" aria-label={`Доля успехов: ${item.habit.name}`} aria-valuenow={item.successRate} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${item.successRate}%` }} /></div>}
      <dl className="statistics-small-metrics">
        <div><dt>Успехи</dt><dd data-statistic="success">{item.successCount}</dd></div>
        <div><dt>Неудачи</dt><dd data-statistic="failure">{item.failureCount}</dd></div>
        <div><dt>Без данных</dt><dd data-statistic="no-data">{item.noDataCount}</dd></div>
        <div><dt>Отмечено</dt><dd data-statistic="marked">{item.markedCount} / {item.eligibleDays}</dd></div>
        <div><dt>Текущая серия</dt><dd data-statistic="current-streak">{item.currentStreak} дн.</dd></div>
        <div><dt>Лучшая серия</dt><dd data-statistic="best-streak">{item.bestStreak} дн.</dd></div>
      </dl>
    </Card>)}</div>
    <p className="week-explanation">Дни до создания и после архивации исключены из пропусков. Сохранённые записи, в том числе внесённые задним числом, остаются в расчётах.</p>
  </section>
}
