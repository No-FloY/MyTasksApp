import { ArrowUpRight, CalendarCheck2 } from 'lucide-react'
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { HABIT_CATEGORIES } from '@/models/habit-category'
import type { StatisticsDashboard } from '@/services/statistics/statistics-service'
import { StatisticsSummary } from './StatisticsSummary'
import { StatisticsChart } from './StatisticsChart'
import { WeeklyStatistics } from './WeeklyStatistics'
import { formatRate, formatStatisticsDate, spansCalendarYears } from './format-statistics'

export function StatisticsEmptyState({ data }: { data: StatisticsDashboard }) {
  const selectedDay = data.period.preset === 'day'
  const date = selectedDay ? data.period.endDate : data.period.today
  const link = date === data.period.today ? '#today' : `#calendar?date=${date}&month=${date.slice(0, 7)}`
  return <div className="dashboard-empty" data-testid="statistics-empty">
    <CalendarCheck2 size={24} aria-hidden="true" />
    <div><h2>Пока нет данных</h2><p>Выберите другой период или добавьте первые отметки.</p></div>
    <a href={link}>{selectedDay && date !== data.period.today ? 'Заполнить выбранный день' : 'Заполнить сегодня'}<ArrowUpRight size={16} aria-hidden="true" /></a>
  </div>
}

export function StatisticsOverview({ data }: { data: StatisticsDashboard }) {
  const [showWeeklyHistory, setShowWeeklyHistory] = useState(false)
  const { dashboard, period } = data
  const isDay = period.preset === 'day'
  const includeYear = spansCalendarYears(period.startDate, period.endDate)
  const hasTrend = dashboard.days.filter((day) => day.score !== null).length >= 2
  const cleaning = data.weeklyHabits.find((habit) => habit.habit.id === 'cleaning')
  const cleaningWeek = cleaning?.weeks.find((week) => week.startDate === data.weeklyScore.startDate)
  if (!data.hasPeriodData) return <StatisticsEmptyState data={data} />
  return <>
    <StatisticsSummary data={data} />
    <div className="dashboard-detail-grid">
      <Card className="dashboard-panel" data-testid="dashboard-categories">
        <div className="dashboard-panel-heading"><h2>По категориям</h2><span>{isDay ? 'За день' : 'За период'}</span></div>
        <div className="dashboard-categories">{dashboard.categories.map((category) => <div className="dashboard-category" data-testid={`dashboard-category-${category.category}`} key={category.category}>
          <div><span>{HABIT_CATEGORIES.find((item) => item.id === category.category)?.label}</span><strong>{formatRate(category.score)}</strong></div>
          <div className="statistics-meter" role="meter" aria-label={`Оценка категории: ${HABIT_CATEGORIES.find((item) => item.id === category.category)?.label}`}
            aria-valuenow={category.score ?? 0} aria-valuetext={formatRate(category.score)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${category.score ?? 0}%` }} /></div>
        </div>)}</div>
        {dashboard.categories.length === 0 && <p className="dashboard-muted">За этот период нет доступных категорий.</p>}
      </Card>
      <Card className="dashboard-panel" data-testid="dashboard-highlights">
        <div className="dashboard-panel-heading"><h2>{isDay ? 'День в деталях' : 'Главное за период'}</h2></div>
        <dl className="dashboard-facts">
          {!isDay && dashboard.bestDay && <div><dt>Лучший день</dt><dd>{formatStatisticsDate(dashboard.bestDay.date, includeYear)} · {formatRate(dashboard.bestDay.score)}</dd></div>}
          {!isDay && dashboard.worstDay && <div><dt>Самая низкая оценка</dt><dd>{formatStatisticsDate(dashboard.worstDay.date, includeYear)} · {formatRate(dashboard.worstDay.score)}</dd></div>}
          <div><dt>{isDay ? 'Алкоголь' : 'Дни с алкоголем'}</dt><dd>{dashboard.food.alcoholRecordedDays === 0 ? 'Нет данных' : isDay ? dashboard.food.alcoholDays ? 'Был' : 'Не было' : `${dashboard.food.alcoholDays} дн.`}</dd></div>
          {data.coffee && <div data-testid="dashboard-coffee"><dt>Кофе · пил</dt><dd>{data.coffee.filledDays === 0 ? 'Нет данных' : `${data.coffee.drankDays} дн. из ${data.coffee.eligibleDays}`}</dd></div>}
          <div><dt>{isDay ? 'Три приёма пищи' : 'Полное питание'}</dt><dd>{dashboard.food.fullMealRecordedDays === 0 ? 'Нет данных' : isDay ? dashboard.food.fullMealDays ? 'Да' : 'Нет' : `${dashboard.food.fullMealDays} дн.`}</dd></div>
          <div><dt>{isDay ? 'Цель воды' : 'Дни с целью воды'}</dt><dd>{dashboard.food.waterRecordedDays === 0 ? 'Нет данных' : isDay ? dashboard.food.waterSuccessDays ? 'Достигнута' : 'Ниже цели' : `${dashboard.food.waterSuccessDays} дн.`}</dd></div>
          {cleaning && <div data-testid="dashboard-cleaning"><dt>Уборка{period.preset === 'week' || isDay ? ' · неделя' : ''}</dt><dd>{period.preset === 'week' || isDay ? cleaningWeek?.status === 'success' ? 'Выполнена' : cleaningWeek?.status === 'failure' ? 'Не выполнена' : 'Нет данных' : `${cleaning.successCount} / ${cleaning.eligibleWeeks} нед.`}</dd></div>}
          <div><dt>Цели · сейчас</dt><dd>{data.goals.activeGoals} активных · {data.goals.completedGoals} завершено</dd></div>
        </dl>
      </Card>
    </div>
    {hasTrend && <Card className="dashboard-panel dashboard-trend" data-testid="dashboard-trend">
      <div className="dashboard-panel-heading"><h2>Ритм периода</h2><span>Оценка по дням</span></div>
      <StatisticsChart data={dashboard.days.map((day) => ({ date: day.date, value: day.score }))} label="Оценка дня в выбранном периоде" unit="%" percent includeYear={includeYear} />
      <details className="statistics-table-details"><summary>Дневные оценки и заполненность</summary><div className="statistics-table-scroll">
        <table className="statistics-week-table"><caption>Оценки по отметкам и правилам завершённых дней. «Нет данных» не равно нулю.</caption><thead><tr><th scope="col">Дата</th><th scope="col">Оценка</th><th scope="col">Заполнено</th></tr></thead>
          <tbody>{dashboard.days.map((day) => <tr key={day.date}><th scope="row">{formatStatisticsDate(day.date, includeYear)}</th><td>{formatRate(day.score)}</td><td>{formatRate(day.coverage)}</td></tr>)}</tbody>
        </table></div></details>
    </Card>}
    <details className="statistics-table-details dashboard-method"><summary>Как читать оценку</summary>
      <p className="week-explanation">Дневная оценка — среднее категорий с данными. Заполненность учитывает явные отметки и результаты по правилу завершённого дня. «Нет данных» исключено; кофе не влияет ни на оценку, ни на заполненность. Для средней оценки периода используются дни с заполненностью от 50%. В режиме «Неделя» недельные цели учитываются один раз внутри своей категории. Задачи входят по сроку, их результат и состояние целей показаны на текущий момент.</p>
    </details>
    {data.weekly.length > 0 && <details className="statistics-table-details dashboard-history" onToggle={(event) => setShowWeeklyHistory(event.currentTarget.open)}><summary>Подробная динамика по неделям</summary>{showWeeklyHistory && <WeeklyStatistics weeks={data.weekly} />}</details>}
  </>
}
