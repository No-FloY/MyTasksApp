import { Card } from '@/components/ui/card'
import type { DurationStatistics } from '@/services/statistics/duration-statistics'
import { StatisticsChart } from './StatisticsChart'
import { formatMinutes, formatStatisticsDate, spansCalendarYears } from './format-statistics'

export function DurationStatisticsCard({ data }: { data: DurationStatistics }) {
  const includeYear = spansCalendarYears(data.days[0]?.date, data.days.at(-1)?.date)
  return <section className="statistics-section" aria-label={`Статистика: ${data.habit.name}`} data-duration-statistics-id={data.habit.id}>
    <Card className="duration-week-card">
      <h2>{data.habit.name} {data.habit.archivedAt && <span className="statistics-badge">Архив</span>}</h2>
      <dl className="week-metrics statistics-metrics">
        <div><dt>Всего за период</dt><dd data-statistic="total">{formatMinutes(data.recordedDays === 0 ? null : data.totalMinutes)}</dd></div>
        <div><dt>В среднем за день с записью</dt><dd data-statistic="average">{formatMinutes(data.averageMinutes)}</dd></div>
        <div><dt>Минимум</dt><dd data-statistic="minimum">{formatMinutes(data.minimumMinutes)}</dd></div>
        <div><dt>Максимум</dt><dd data-statistic="maximum">{formatMinutes(data.maximumMinutes)}</dd></div>
      </dl>
      <p className="week-explanation">Дней с записью: {data.recordedDays} из {data.days.length}. Без записи в периоде: <span data-statistic="missing">{data.missingDays}</span>.<br />Из них до создания или после архивации: {data.ineligibleDays}. Нулевое время учитывается в среднем; дни без записи — нет.</p>
      <p className="week-explanation">Сумма / календарные дни отслеживания ({data.eligibleDays}): <strong data-statistic="calendar-average">{formatMinutes(data.averagePerDayMinutes)}</strong>. Это распределение записанной суммы на период, пропуски не означают нулевое время.</p>
      <ul className="rating-distribution" aria-label="Распределение оценок">
        {data.ratingCounts.map(({ rating, days }) => <li key={rating.id} data-rating-id={rating.id}><span aria-hidden="true">{rating.emoji}</span><span>{rating.label}</span><strong data-rating-count={rating.id}>{days}</strong></li>)}
      </ul>
      {data.recordedDays === 0 ? <p className="statistics-empty">За выбранный период пока нет данных.</p> : <>
        <p className="week-chart-label">Время по дням · минуты</p>
        <StatisticsChart data={data.days.map((day) => ({ date: day.date, value: day.minutes }))} label={`Время по дням: ${data.habit.name}`} unit="мин" bars={data.days.length <= 31} includeYear={includeYear} />
      </>}
      <details className="statistics-table-details" open={data.days.length <= 7}>
        <summary>Время и оценки по дням</summary>
        <div className="statistics-table-scroll"><table className="duration-days">
          <caption>Время по дням</caption>
          <thead><tr><th scope="col">Дата</th><th scope="col">Время</th><th scope="col">Оценка</th></tr></thead>
          <tbody>{data.days.map((day) => <tr key={day.date} data-duration-minutes={day.minutes ?? 'missing'}><th scope="row"><time dateTime={day.date}>{formatStatisticsDate(day.date, includeYear)}</time></th><td>{formatMinutes(day.minutes)}</td><td>{day.rating ? <><span aria-hidden="true">{day.rating.emoji} </span>{day.rating.label}</> : '—'}</td></tr>)}</tbody>
        </table></div>
      </details>
      <p className="week-explanation">Оценки рассчитаны по текущим диапазонам. Фактические минуты сохранены независимо от оценки.</p>
    </Card>
  </section>
}
