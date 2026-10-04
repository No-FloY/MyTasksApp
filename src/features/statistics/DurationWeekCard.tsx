import { useId } from 'react'
import { format, parseISO } from 'date-fns'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Card } from '@/components/ui/card'
import { formatDuration } from '@/services/duration-service'
import type { DurationWeek } from '@/services/duration-statistics-service'

export function DurationWeekCard({ week }: { week: DurationWeek }) {
  const id = useId()
  const chartData = week.days.map((day) => ({ ...day, label: format(parseISO(day.date), 'dd.MM') }))
  return (
    <section aria-labelledby={id} data-duration-statistics-id={week.habit.id}>
      <Card className="duration-week-card">
        <h2 id={id}>{week.habit.name}</h2>
        <dl className="week-metrics">
          <div><dt>Всего за 7 дней</dt><dd data-statistic="total">{formatDuration(week.totalMinutes)}</dd></div>
          <div><dt>В среднем за день с записью</dt><dd data-statistic="average">{week.averageMinutes === null ? 'Нет данных' : `${Number.isInteger(week.averageMinutes) ? '' : '≈ '}${formatDuration(week.averageMinutes)}`}</dd></div>
        </dl>
        <p className="week-explanation">Дней с записью: {week.recordedDays} из 7. Без данных: <span data-statistic="missing">{week.missingDays}</span>.<br />Нулевое время учитывается в среднем; дни без записи — нет.</p>
        <ul className="rating-distribution" aria-label="Распределение оценок">
          {week.ratingCounts.map(({ rating, days }) => <li key={rating.id} data-rating-id={rating.id}><span aria-hidden="true">{rating.emoji}</span><span>{rating.label}</span><strong data-rating-count={rating.id}>{days}</strong></li>)}
        </ul>
        <p className="week-chart-label">Время по дням · минуты</p>
        {typeof globalThis.ResizeObserver !== 'undefined' && (
          <div className="duration-chart" role="img" aria-label={`Время по дням: ${week.habit.name}`}>
            <ResponsiveContainer width="100%" height={180} minWidth={0} initialDimension={{ width: 250, height: 180 }}>
              <BarChart data={chartData} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
                <CartesianGrid vertical={false} stroke="#e6ebdf" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7961' }} interval={0} />
                <YAxis width={35} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7961' }} allowDecimals={false} />
                <Bar dataKey="minutes" fill="#7a9b7d" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <table className="duration-days">
          <caption>Время по дням</caption>
          <thead><tr><th scope="col">Дата</th><th scope="col">Время</th><th scope="col">Оценка</th></tr></thead>
          <tbody>{chartData.map((day) => <tr key={day.date} data-duration-minutes={day.minutes ?? 'missing'}><th scope="row"><time dateTime={day.date}>{day.label}</time></th><td>{day.minutes === null ? 'Нет данных' : formatDuration(day.minutes)}</td><td>{day.rating ? <><span aria-hidden="true">{day.rating.emoji} </span>{day.rating.label}</> : '—'}</td></tr>)}</tbody>
        </table>
      </Card>
    </section>
  )
}
