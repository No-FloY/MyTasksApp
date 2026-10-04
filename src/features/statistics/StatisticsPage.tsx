import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertCircle, ChartNoAxesCombined, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocalDate } from '@/hooks/use-local-date'
import { getLastSevenDates } from '@/services/duration-statistics-service'
import { DurationWeekCard } from './DurationWeekCard'
import { useDurationStatistics } from './use-duration-statistics'
import './statistics.css'

export default function StatisticsPage() {
  const date = useLocalDate()
  const { weeks, loading, error, retry } = useDurationStatistics(date)
  const start = getLastSevenDates(date)[0] ?? date
  return (
    <div className="statistics-page">
      <section className="today-heading">
        <div><p className="eyebrow date-heading"><ChartNoAxesCombined size={17} aria-hidden="true" />ПОСЛЕДНИЕ 7 ДНЕЙ</p><h1>Статистика<span className="heading-dot" aria-hidden="true">.</span></h1><p className="page-description">Игры и соцсети · {format(parseISO(start), 'd MMMM', { locale: ru })} — {format(parseISO(date), 'd MMMM', { locale: ru })}</p></div>
      </section>
      {loading && <div className="empty-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /><p>Загружаем статистику…</p></div>}
      {error && <div className="empty-state error-state" role="alert"><AlertCircle aria-hidden="true" /><h2>Не удалось загрузить статистику</h2><p>Проверьте доступ к хранилищу браузера и повторите загрузку.</p><Button onClick={retry}>Повторить загрузку</Button></div>}
      {!loading && !error && weeks.length === 0 && <p>Нет активных привычек с учётом времени.</p>}
      <div className="duration-weeks">{weeks.map((week) => <DurationWeekCard key={week.habit.id} week={week} />)}</div>
      <p className="week-explanation">Оценки рассчитаны по текущим диапазонам. Точные значения доступны в таблицах под графиками.</p>
    </div>
  )
}
