import { Card } from '@/components/ui/card'
import type { StatisticsDashboard } from '@/services/statistics/statistics-service'
import { StatisticsChart } from './StatisticsChart'
import { formatMinutes, formatRate, formatStatisticsDate, spansCalendarYears } from './format-statistics'

export function WeeklyStatistics({ weeks }: { weeks: StatisticsDashboard['weekly'] }) {
  if (weeks.length === 0) return null
  const includeYear = spansCalendarYears(weeks[0]?.startDate, weeks.at(-1)?.endDate)
  const series = [
    { key: 'habitSuccessRate', label: 'Успехи привычек', unit: '%', percent: true },
    { key: 'taskOnTimeRate', label: 'Задачи вовремя', unit: '%', percent: true },
    { key: 'waterSuccessRate', label: 'Дни с целью воды', unit: '%', percent: true },
    { key: 'gamingAverage', label: 'Игры: среднее время', unit: 'мин', percent: false },
    { key: 'socialAverage', label: 'Соцсети: среднее время', unit: 'мин', percent: false },
  ] as const
  return <section className="statistics-section" aria-labelledby="weekly-statistics-heading" data-testid="weekly-statistics">
    <h2 id="weekly-statistics-heading">Динамика по неделям</h2>
    <p className="week-explanation">Недели с понедельника по воскресенье, первая и последняя ограничены периодом. Каждый показатель использует ту же формулу, что и общая сводка; единой оценки нет.</p>
    <div className="statistics-weekly-grid">{series.map((item) => <Card key={item.key} className="statistics-card">
      <h3>{item.label}</h3>
      {weeks.every((week) => week[item.key] === null) && <p className="statistics-empty">За выбранный период пока нет данных.</p>}
      <StatisticsChart data={weeks.map((week) => ({ date: week.startDate, value: week[item.key] }))} label={`${item.label} по неделям`} unit={item.unit} percent={item.percent} includeYear={includeYear} />
      <details className="statistics-table-details"><summary>Значения по неделям</summary>
        <div className="statistics-table-scroll"><table className="statistics-week-table"><caption>{item.label}</caption><thead><tr><th scope="col">Неделя</th><th scope="col">Значение</th></tr></thead>
          <tbody>{weeks.map((week) => <tr key={week.startDate}><th scope="row">{formatStatisticsDate(week.startDate, includeYear)}–{formatStatisticsDate(week.endDate, includeYear)}</th><td>{item.percent ? formatRate(week[item.key]) : formatMinutes(week[item.key])}</td></tr>)}</tbody>
        </table></div>
      </details>
    </Card>)}</div>
  </section>
}
