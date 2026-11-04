import { Card } from '@/components/ui/card'
import type { StatisticsDashboard } from '@/services/statistics/statistics-service'
import { formatRate } from './format-statistics'

function Counts({ data, successLabel, failureLabel }: {
  data: { successCount: number; failureCount: number; noDataCount: number; successRate: number | null }
  successLabel: string
  failureLabel: string
}) {
  return <dl className="statistics-small-metrics">
    <div><dt>{successLabel}</dt><dd data-statistic="success">{data.successCount}</dd></div>
    <div><dt>{failureLabel}</dt><dd data-statistic="failure">{data.failureCount}</dd></div>
    <div><dt>Нет данных</dt><dd data-statistic="no-data">{data.noDataCount}</dd></div>
    <div><dt>Доля успехов среди заполненных</dt><dd data-statistic="success-rate">{formatRate(data.successRate)}</dd></div>
  </dl>
}

export function FoodRoutineStatistics({ data }: { data: StatisticsDashboard }) {
  const { alcohol, meals, fullMealDays, eligibleMealDays } = data.food
  return <>
    {alcohol && <Card className="statistics-card" data-testid="alcohol-statistics">
      <h2>Алкоголь</h2>
      <p className="week-explanation">За выбранный период. «Пил» означает один календарный день с алкоголем; «Нет данных» не считается употреблением.</p>
      <Counts data={alcohol.selected} successLabel="Не пил, дней" failureLabel="Пил алкоголь, дней" />
      <p>Дней с алкоголем за текущий месяц: <strong data-statistic="current-month-drinking-days">{alcohol.currentMonth.failureCount}</strong></p>
      <p className="week-explanation">С начала текущего месяца по сегодня, независимо от выбранного периода.</p>
      {alcohol.months.length > 1 && <details className="statistics-table-details"><summary>Динамика алкоголя по месяцам</summary>
        <div className="statistics-table-scroll"><table className="statistics-week-table"><caption>Дни с алкоголем в пределах выбранного периода</caption>
          <thead><tr><th scope="col">Месяц</th><th scope="col">Пил</th><th scope="col">Не пил</th><th scope="col">Нет данных</th></tr></thead>
          <tbody>{alcohol.months.map((month) => <tr key={month.month}><th scope="row">{month.month}</th><td>{month.failureCount}</td><td>{month.successCount}</td><td>{month.noDataCount}</td></tr>)}</tbody>
        </table></div>
      </details>}
    </Card>}
    {meals.length > 0 && <section className="statistics-section" aria-labelledby="meal-statistics-heading" data-testid="meal-statistics">
      <h2 id="meal-statistics-heading">Приёмы пищи</h2>
      <div className="boolean-statistics-grid">{meals.map((meal) => <Card key={meal.habit.id} className="statistics-habit-card" data-meal-id={meal.habit.id}>
        <h3>{meal.habit.name}{meal.habit.archivedAt && ' · архив'}</h3>
        <Counts data={meal} successLabel="Был" failureLabel="Пропущен" />
      </Card>)}</div>
      <p>Все три приёма пищи были: <strong data-statistic="full-meal-days">{fullMealDays}</strong> из {eligibleMealDays} дней.</p>
      <p className="week-explanation">Полноценный день питания: завтрак, обед и ужин отмечены как «Был». Пропущенный приём пищи считается невыполнением; «Нет данных» исключено из процента.</p>
    </section>}
    {data.weeklyHabits.map((item) => <Card key={item.habit.id} className="statistics-card" data-weekly-habit-id={item.habit.id} data-testid={item.habit.id === 'cleaning' ? 'cleaning-statistics' : undefined}>
      <h2>{item.habit.name}{item.habit.archivedAt && ' · архив'} · по неделям</h2>
      <Counts data={item} successLabel="Выполненных недель" failureLabel="Невыполненных недель" />
      <p className="week-explanation">Всего: {item.eligibleWeeks} недель. Каждая неделя с понедельника по воскресенье учитывается один раз. Текущая незавершённая неделя без результата и явное «Нет данных» исключены из процента.</p>
      <p className="week-explanation">Если целая завершённая неделя входит в период и отметки нет, она считается невыполненной. Частичные крайние недели без результата остаются без данных.</p>
    </Card>)}
  </>
}
