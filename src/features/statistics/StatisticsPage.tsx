import { useMemo } from 'react'
import { AlertCircle, ChartNoAxesCombined, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrentTime } from '@/hooks/use-current-time'
import { useHashParam } from '@/hooks/use-hash-param'
import { getLocalDate } from '@/lib/local-date'
import { getStatisticsPeriod, isStatisticsPreset } from '@/services/statistics/period-utils'
import { AmountStatisticsCard } from './AmountStatisticsCard'
import { DurationStatisticsCard } from './DurationStatisticsCard'
import { HabitStatistics } from './HabitStatistics'
import { PeriodPicker } from './PeriodPicker'
import { StatisticsSummary } from './StatisticsSummary'
import { TaskStatisticsCard } from './TaskStatisticsCard'
import { GoalStatisticsCard } from './GoalStatisticsCard'
import { WeeklyStatistics } from './WeeklyStatistics'
import { useStatistics } from './use-statistics'
import './statistics.css'

export default function StatisticsPage() {
  const now = useCurrentTime()
  const today = getLocalDate(now)
  const preset = useHashParam('period')
  const from = useHashParam('from')
  const to = useHashParam('to')
  const selection = useMemo(() => {
    try {
      if (preset !== null && !isStatisticsPreset(preset)) throw new Error('Неизвестный период статистики.')
      return { period: getStatisticsPeriod(preset ?? '7d', today, { startDate: from ?? '', endDate: to ?? '' }), error: null }
    } catch (reason) {
      return { period: getStatisticsPeriod('7d', today), error: reason instanceof Error ? reason.message : 'Некорректный период.' }
    }
  }, [preset, from, to, today])
  const { data, loading, error, retry } = useStatistics(selection.period, now)
  return (
    <div className="statistics-page">
      <section className="today-heading">
        <div><p className="eyebrow date-heading"><ChartNoAxesCombined size={17} aria-hidden="true" />ВАШИ РЕЗУЛЬТАТЫ</p><h1>Статистика<span className="heading-dot" aria-hidden="true">.</span></h1><p className="page-description">Привычки, время и планы — в цифрах за выбранный период.</p></div>
      </section>
      {selection.error && <p role="alert" className="statistics-input-error">{selection.error} Показаны последние 7 дней.</p>}
      <PeriodPicker period={selection.period} />
      {loading && <div className="empty-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /><p>Загружаем статистику…</p></div>}
      {error && <div className="empty-state error-state" role="alert"><AlertCircle aria-hidden="true" /><h2>Не удалось загрузить статистику</h2><p>Проверьте доступ к хранилищу браузера и повторите загрузку.</p><Button onClick={retry}>Повторить загрузку</Button></div>}
      {data && !error && <>
        {!data.hasPeriodData && <p className="statistics-empty" data-testid="statistics-empty">За выбранный период пока нет данных. Отмечайте привычки и добавляйте задачи — здесь появятся результаты.</p>}
        <StatisticsSummary data={data} />
        <HabitStatistics data={data} />
        {data.amounts.map((item) => <AmountStatisticsCard key={item.habit.id} data={item} />)}
        <div className="duration-weeks">{data.durations.map((item) => <DurationStatisticsCard key={item.habit.id} data={item} />)}</div>
        <TaskStatisticsCard data={data.tasks} />
        <GoalStatisticsCard data={data.goals} />
        <WeeklyStatistics weeks={data.weekly} />
      </>}
    </div>
  )
}
