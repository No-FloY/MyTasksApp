import { Card } from '@/components/ui/card'
import type { AmountStatistics } from '@/services/statistics/amount-statistics'
import { StatisticsChart } from './StatisticsChart'
import { formatNumber, formatRate, formatStatisticsDate, spansCalendarYears } from './format-statistics'

export function AmountStatisticsCard({ data }: { data: AmountStatistics }) {
  const includeYear = spansCalendarYears(data.days[0]?.date, data.days.at(-1)?.date)
  return <section className="statistics-section" aria-label={`Статистика: ${data.habit.name}`} data-amount-statistics-id={data.habit.id}>
    <Card className="statistics-card">
      <h2>{data.habit.name} {data.habit.archivedAt && <span className="statistics-badge">Архив</span>}</h2>
      <dl className="week-metrics statistics-metrics">
        <div><dt>Среднее по дням с записью</dt><dd data-statistic="average">{formatNumber(data.average)}{data.average !== null && ` ${data.habit.unit}`}</dd></div>
        <div><dt>Цель достигнута</dt><dd data-statistic="successful">{data.successfulDays} / {data.daysWithData} дн.</dd></div>
        <div><dt>Доля дней с достигнутой целью</dt><dd data-statistic="success-rate">{formatRate(data.successRate)}</dd></div>
        <div><dt>Максимум</dt><dd data-statistic="maximum">{formatNumber(data.maximum)}{data.maximum !== null && ` ${data.habit.unit}`}</dd></div>
      </dl>
      <p className="week-explanation">Всего: <strong data-statistic="total">{formatNumber(data.total)}</strong> {data.total !== null && data.habit.unit}. Минимум: {formatNumber(data.minimum)} {data.minimum !== null && data.habit.unit}.<br />Ниже цели: {data.failedDays} дн. Без данных за время отслеживания: {data.noDataCount} из {data.eligibleDays} дн.</p>
      {data.daysWithData === 0 ? <p className="statistics-empty">За выбранный период пока нет данных.</p> : <>
        <p className="week-chart-label">По дням · {data.habit.unit}. Пунктир — цель {formatNumber(data.habit.target)} {data.habit.unit}.</p>
        <StatisticsChart data={data.days.map((day) => ({ date: day.date, value: day.value }))} label={`${data.habit.name} по дням`} unit={data.habit.unit} target={data.habit.target} bars={data.days.length <= 31} includeYear={includeYear} />
      </>}
      <details className="statistics-table-details" open={data.days.length <= 7}>
        <summary>Значения по дням</summary>
        <div className="statistics-table-scroll"><table className="duration-days"><caption>{data.habit.name}: фактические значения</caption>
          <thead><tr><th scope="col">Дата</th><th scope="col">{data.habit.unit}</th><th scope="col">Цель</th></tr></thead>
          <tbody>{data.days.map((day) => <tr key={day.date} data-amount-value={day.value ?? 'missing'}><th scope="row"><time dateTime={day.date}>{formatStatisticsDate(day.date, includeYear)}</time></th><td>{formatNumber(day.value)}</td><td>{day.value === null ? 'Нет данных' : day.value >= data.habit.target ? 'Достигнута' : 'Ниже цели'}</td></tr>)}</tbody>
        </table></div>
      </details>
      <p className="week-explanation">Среднее и процент используют только дни с записью, включая ноль. Значения выше цели сохранены полностью.</p>
    </Card>
  </section>
}
