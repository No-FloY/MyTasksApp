import { Button } from '@/components/ui/button'
import type { LocalDate } from '@/lib/local-date'
import { HABIT_CATEGORIES } from '@/models/habit-category'
import { getDayScoreInterpretation, type DayScoreData } from '@/services/statistics/day-score'
import { getStatisticsLink } from '@/services/statistics/period-utils'
import { formatRate, formatStatisticsDate } from './format-statistics'
import { ScoreCategoryPreview, ScoreRing } from './ScoreRing'
import { useDayScore, useWeeklyScore } from './use-day-score'
import { WeeklyScoreCard } from './WeeklyScoreCard'
import './day-score.css'

export function DayScoreCard({ data, onStartEntry }: { data: DayScoreData; onStartEntry?: (() => void) | undefined }) {
  return <section className="day-score-card" aria-label="Оценка дня" data-testid="day-score" data-day-score-date={data.date}>
    <div className="day-score-heading"><div><h2>Оценка дня</h2><time dateTime={data.date}>{formatStatisticsDate(data.date, true)}</time></div></div>
    <div className="score-card-body"><ScoreRing score={data.score} label="Оценка дня" statistic="day-score" testId="day-score-value" />
    <div className="score-card-context"><p className="day-score-coverage">Заполненность: <strong data-statistic="coverage" data-testid="day-coverage">{formatRate(data.coverage === null ? null : Math.round(data.coverage))}</strong><br /><span data-statistic="filled" data-testid="day-filled">{data.filled} / {data.eligible}</span> показателей</p>
    <p className={data.sufficient ? 'day-score-interpretation' : 'day-score-warning'}>
      {data.sufficient ? getDayScoreInterpretation(data.score) : data.eligible === 0 ? 'На эту дату нет доступных показателей.' : data.filled === 0 ? 'Добавьте первую отметку за день.' : 'Недостаточно данных для полной оценки'}
    </p>
    </div></div>
    <ScoreCategoryPreview categories={data.categories} />
    {data.filled === 0 && data.eligible > 0 && onStartEntry && <button className="score-entry-action" onClick={onStartEntry}>Заполнить привычки</button>}
    <a className="score-statistics-link" href={getStatisticsLink('day', data.date)} aria-label="Открыть статистику за день">Статистика дня <span aria-hidden="true">↗</span></a>
    <details className="day-score-details"><summary aria-label="Подробнее об оценке дня">Подробнее</summary>
      <dl className="day-score-categories">{data.categories.map((category) => <div key={category.category} data-score-category={category.category}>
        <dt>{HABIT_CATEGORIES.find((item) => item.id === category.category)?.label}<small>{category.filled} / {category.eligible} заполнено</small></dt>
        <dd>{formatRate(category.score)}</dd>
      </div>)}</dl>
      <p>Сначала считаем среднее заполненных привычек в каждой категории, затем среднее категорий с данными. У категорий равный вес. Результаты завершённых дней могут вычисляться по выбранному правилу пропусков; явное «Нет данных» остаётся без данных. Наблюдаемые трекеры, включая кофе, не входят в оценку и заполненность.</p>
      <p>Успех — 100%, неудача — 0%. Количество — доля цели, максимум 100% для оценки. Категории времени распределены равномерно от 100% до 0%; единственный уровень — 100%.</p>
      <p>Для полной оценки нужно заполнить не менее 50% доступных показателей. Текущие категории, цели и диапазоны применяются и к прошлым дням.</p>
      <p>Заполненность учитывает только привычки, ожидаемые по расписанию в этот день. Недельная привычка без назначенного дня входит только в оценку недели.</p>
      {data.unsupportedRatingCount > 0 && <p>Показатели типа rating ({data.unsupportedRatingCount}) не включены в оценку и заполненность: у них пока нет определённой шкалы. Записи сохранены.</p>}
    </details>
  </section>
}

/** Compact live summary shared by Today and the selected calendar day. */
export function DayScore({ date, onStartEntry }: { date: LocalDate; onStartEntry?: () => void }) {
  const { data, error, loading, retry } = useDayScore(date)
  if (loading) return <p className="day-score-loading" role="status">Рассчитываем оценку дня…</p>
  if (error) return <div className="day-score-card day-score-warning" role="alert"><p>Не удалось рассчитать оценку дня.</p><Button variant="outline" onClick={retry}>Повторить расчёт</Button></div>
  return data ? <DayScoreCard data={data} onStartEntry={onStartEntry} /> : null
}

export function TodayWeeklyScore({ date }: { date: LocalDate }) {
  const { data, error, loading, retry } = useWeeklyScore(date)
  if (loading) return <p className="day-score-loading" role="status">Рассчитываем оценку недели…</p>
  if (error) return <div className="day-score-card day-score-warning" role="alert"><p>Не удалось рассчитать оценку недели.</p><Button variant="outline" onClick={retry}>Повторить расчёт недели</Button></div>
  return data ? <WeeklyScoreCard data={data} compact /> : null
}
