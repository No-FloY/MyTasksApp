import { useMemo } from 'react'
import { AlertCircle, ChartNoAxesCombined, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrentTime } from '@/hooks/use-current-time'
import { useHashParam } from '@/hooks/use-hash-param'
import { getLocalDate, isLocalDate } from '@/lib/local-date'
import { getHabitCategory } from '@/models/habit-category'
import { getStatisticsPeriod, isStatisticsPreset } from '@/services/statistics/period-utils'
import { AmountStatisticsCard } from './AmountStatisticsCard'
import { DurationStatisticsCard } from './DurationStatisticsCard'
import { HabitStatistics } from './HabitStatistics'
import { FoodRoutineStatistics } from './FoodRoutineStatistics'
import { PeriodPicker } from './PeriodPicker'
import { StatisticsOverview } from './StatisticsOverview'
import { TaskStatisticsCard } from './TaskStatisticsCard'
import { GoalStatisticsCard } from './GoalStatisticsCard'
import { CoffeeStatistics } from './CoffeeStatistics'
import { StatisticsTabs } from './StatisticsTabs'
import { getStatisticsSection, getStatisticsSectionLink } from './statistics-navigation'
import { useStatistics } from './use-statistics'
import './statistics.css'
import './statistics-dashboard.css'

export default function StatisticsPage() {
  const now = useCurrentTime()
  const today = getLocalDate(now)
  const preset = useHashParam('period')
  const from = useHashParam('from')
  const to = useHashParam('to')
  const anchor = useHashParam('date')
  const section = getStatisticsSection(useHashParam('section'))
  const selection = useMemo(() => {
    try {
      if (preset !== null && !isStatisticsPreset(preset)) throw new Error('Неизвестный период статистики.')
      if (anchor !== null && !isLocalDate(anchor)) throw new Error('Некорректная календарная дата.')
      return { period: getStatisticsPeriod(preset ?? 'week', today, { startDate: from ?? '', endDate: to ?? '' }, anchor ?? today), error: null }
    } catch (reason) {
      return { period: getStatisticsPeriod('week', today), error: reason instanceof Error ? reason.message : 'Некорректный период.' }
    }
  }, [preset, from, to, anchor, today])
  const { data, loading, error, retry } = useStatistics(selection.period, now)
  return (
    <div className="statistics-page">
      <section className="today-heading">
        <div><p className="eyebrow date-heading"><ChartNoAxesCombined size={17} aria-hidden="true" />ВАШИ РЕЗУЛЬТАТЫ</p><h1>Статистика<span className="heading-dot" aria-hidden="true">.</span></h1><p className="page-description">Общая картина и детали, когда они нужны.</p></div>
      </section>
      {selection.error && <p role="alert" className="statistics-input-error">{selection.error} Показана текущая неделя.</p>}
      <PeriodPicker period={selection.period} />
      <StatisticsTabs selected={section} onSelect={(selected) => { window.location.hash = getStatisticsSectionLink(window.location.hash, selected) }} />
      {loading && <div className="empty-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /><p>Загружаем статистику…</p></div>}
      {error && <div className="empty-state error-state" role="alert"><AlertCircle aria-hidden="true" /><h2>Не удалось загрузить статистику</h2><p>Проверьте доступ к хранилищу браузера и повторите загрузку.</p><Button onClick={retry}>Повторить загрузку</Button></div>}
      {data && !error && <div className="statistics-tab-panel" role="tabpanel" id={`statistics-panel-${section}`} aria-labelledby={`statistics-tab-${section}`} tabIndex={0}>
        {section === 'overview' && <StatisticsOverview data={data} />}
        {section === 'habits' && <>
          <HabitStatistics data={data} />
          <FoodRoutineStatistics data={data} mode="weekly" />
          {data.amounts.filter((item) => !['food_water', 'training'].includes(getHabitCategory(item.habit))).map((item) => <AmountStatisticsCard key={item.habit.id} data={item} />)}
        </>}
        {section === 'nutrition' && <>
          <CoffeeStatistics data={data} />
          <FoodRoutineStatistics data={data} mode="nutrition" />
          {data.amounts.filter((item) => getHabitCategory(item.habit) === 'food_water').map((item) => <AmountStatisticsCard key={item.habit.id} data={item} />)}
          <HabitStatistics data={data} category="food_water" title="Привычки питания" />
        </>}
        {section === 'training' && <>
          <HabitStatistics data={data} category="training" title="Тренировка и активность" />
          {data.amounts.filter((item) => getHabitCategory(item.habit) === 'training').map((item) => <AmountStatisticsCard key={item.habit.id} data={item} />)}
        </>}
        {section === 'screen-time' && <div className="duration-weeks">{data.durations.length === 0 ? <p className="statistics-empty">В этом периоде нет привычек с учётом времени.</p> : data.durations.map((item) => <DurationStatisticsCard key={item.habit.id} data={item} />)}</div>}
        {section === 'tasks' && <TaskStatisticsCard data={data.tasks} />}
        {section === 'goals' && <GoalStatisticsCard data={data.goals} />}
      </div>}
    </div>
  )
}
