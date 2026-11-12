import { Card } from '@/components/ui/card'
import type { StatisticsDashboard } from '@/services/statistics/statistics-service'
import { StatisticsChart } from './StatisticsChart'
import { formatRate, formatStatisticsDate } from './format-statistics'

export function CoffeeStatistics({ data }: { data: StatisticsDashboard }) {
  const coffee = data.coffee
  if (!coffee) return null
  const buckets = data.period.dates.length > 100 ? coffee.months : coffee.weeks
  return <Card className="dashboard-panel coffee-statistics" data-testid="coffee-statistics">
    <div className="dashboard-panel-heading"><h2>Кофе</h2><span>Наблюдение</span></div>
    <p className="dashboard-muted">Частота употребления. Не влияет на оценку дня и её заполненность.</p>
    <dl className="dashboard-facts">
      <div><dt>Пил кофе</dt><dd data-statistic="coffee-days">{coffee.drankDays} дн. из {coffee.eligibleDays}</dd></div>
      <div><dt>Не пил</dt><dd data-statistic="coffee-free-days">{coffee.didNotDrinkDays} дн.</dd></div>
      <div><dt>Нет данных</dt><dd data-statistic="coffee-no-data">{coffee.noDataDays} дн.</dd></div>
      <div><dt>Частота среди заполненных дней</dt><dd data-statistic="coffee-frequency">{formatRate(coffee.frequencyPercent === null ? null : Math.round(coffee.frequencyPercent))}</dd></div>
    </dl>
    <p className="dashboard-muted">Заполнено: {coffee.filledDays} дн. · По правилу: {coffee.inferredDays} дн. Явное «Нет данных» не заменяется предположением.</p>
    {buckets.length > 1 && <>
      <h3>Дни с кофе {data.period.dates.length > 100 ? 'по месяцам' : 'по неделям'}</h3>
      <StatisticsChart data={buckets.map((bucket) => ({ date: bucket.startDate, value: bucket.filledDays === 0 ? null : bucket.drankDays }))} label="Количество дней с кофе" unit="дн." bars />
      <details className="statistics-table-details"><summary>Значения по периодам</summary>
        <div className="statistics-table-scroll"><table className="statistics-week-table"><caption>Наблюдения за кофе в выбранном периоде</caption>
          <thead><tr><th scope="col">Период</th><th scope="col">Пил</th><th scope="col">Заполнено</th></tr></thead>
          <tbody>{buckets.map((bucket) => <tr key={bucket.startDate}><th scope="row">{formatStatisticsDate(bucket.startDate, true)} — {formatStatisticsDate(bucket.endDate, true)}</th><td>{bucket.filledDays === 0 ? 'Нет данных' : bucket.drankDays}</td><td>{bucket.filledDays} / {bucket.eligibleDays}</td></tr>)}</tbody>
        </table></div>
      </details>
    </>}
  </Card>
}
