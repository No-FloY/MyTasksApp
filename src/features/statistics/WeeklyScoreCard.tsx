import { HABIT_CATEGORIES } from '@/models/habit-category'
import type { WeeklyScoreData } from '@/services/statistics/day-score'
import { formatRate, formatStatisticsDate } from './format-statistics'
import './day-score.css'

function WeeklyMetrics({ data }: { data: WeeklyScoreData }) {
  return <>
    <dl className="weekly-score-metrics">
      <div><dt>Полностью заполнено</dt><dd data-statistic="full-days">{data.fullDays} дн.</dd></div>
      <div><dt>Частично заполнено</dt><dd data-statistic="partial-days">{data.partialDays} дн.</dd></div>
      <div><dt>Без записей</dt><dd data-statistic="missing-days">{data.missingDays} дн.</dd></div>
      <div><dt>Без доступных показателей</dt><dd>{data.unavailableDays} дн.</dd></div>
      <div><dt>Лучший день</dt><dd data-statistic="best-day">{data.bestDay ? `${formatStatisticsDate(data.bestDay.date, true)} · ${formatRate(data.bestDay.score)}` : 'Нет данных'}</dd></div>
      <div><dt>Самый слабый день</dt><dd data-statistic="worst-day">{data.worstDay ? `${formatStatisticsDate(data.worstDay.date, true)} · ${formatRate(data.worstDay.score)}` : 'Нет данных'}</dd></div>
    </dl>
    <dl className="day-score-categories">{data.categories.map((category) => <div key={category.category} data-week-score-category={category.category}>
      <dt>{HABIT_CATEGORIES.find((item) => item.id === category.category)?.label}<small>Дневных оценок: {category.days} · Недельных целей: {data.weeklyGoals.filter((goal) => goal.category === category.category).length}</small></dt><dd>{formatRate(category.score)}</dd>
    </div>)}</dl>
  </>
}

export function WeeklyScoreCard({ data, compact = false }: { data: WeeklyScoreData; compact?: boolean }) {
  return <section className="day-score-card weekly-score-card" aria-label="Оценка недели" data-testid="weekly-score">
    <div className="day-score-heading"><div><h2>Оценка недели</h2><p className="day-score-dates"><time dateTime={data.startDate}>{formatStatisticsDate(data.startDate, true)}</time> — <time dateTime={data.endDate}>{formatStatisticsDate(data.endDate, true)}</time></p></div>
      <strong className="day-score-value" data-statistic="weekly-score" data-testid="weekly-score-value">{formatRate(data.score === null ? null : Math.round(data.score))}</strong></div>
    <p className="day-score-coverage">Средняя заполненность: <strong data-statistic="weekly-coverage" data-testid="weekly-coverage">{formatRate(data.averageCoverage === null ? null : Math.round(data.averageCoverage))}</strong></p>
    <p className="day-score-interpretation">Дней с заполненностью не ниже 50%: {data.sufficientDays} из {data.days.length}. Недельные цели учитываются отдельно, по одному разу.</p>
    {data.weeklyGoals.length > 0 && <dl className="weekly-score-goals">{data.weeklyGoals.map((goal) => <div key={goal.id} data-weekly-score-habit={goal.id}><dt>{goal.name} · раз в неделю</dt><dd data-weekly-habit-result={goal.id}>{formatRate(goal.score)}</dd></div>)}</dl>}
    {!compact && <WeeklyMetrics data={data} />}
    <details className="day-score-details"><summary>Оценки по дням и правила недели</summary>
      {compact && <WeeklyMetrics data={data} />}
      <div className="weekly-score-table-wrap"><table className="weekly-score-table"><caption>Календарная неделя с понедельника до выбранной даты</caption>
        <thead><tr><th scope="col">Дата</th><th scope="col">Оценка</th><th scope="col">Заполненность</th></tr></thead>
        <tbody>{data.days.map((day) => <tr key={day.date}><th scope="row"><time dateTime={day.date}>{formatStatisticsDate(day.date, true)}</time></th>
          <td>{formatRate(day.score)}{day.score !== null && !day.sufficient && <small>Не входит в среднее</small>}</td><td>{formatRate(day.coverage)}</td></tr>)}</tbody>
      </table></div>
      <p>Неделя начинается в понедельник; будущие дни не учитываются. Для ежедневных привычек берём оценки категорий за дни с заполненностью не ниже 50%. Лучший и самый слабый день используют тот же порог; при равенстве показана более ранняя дата.</p>
      <p>Каждую недельную цель добавляем один раз в её категорию, затем усредняем категории с данными с равным весом. Назначенная на день недельная цель повторно не считается. Без данных цель исключена из среднего; отсутствие результата за полностью отслеживаемую завершённую неделю означает 0%. Неполная неделя создания или архивации остаётся без данных.</p>
      <p>Средняя заполненность относится к ежедневным оценкам: пустые дни дают 0%, дни без ожидаемых показателей исключены. Отсутствующие ежедневные данные не становятся нулевыми оценками.</p>
    </details>
  </section>
}
