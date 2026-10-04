import { ArrowRight, Info, Sun } from 'lucide-react'
import { useLocalDate } from '@/hooks/use-local-date'
import { formatLocalDate } from '@/lib/local-date'
import { DayHabits } from '@/features/habits/DayHabits'

export function TodayPage() {
  const date = useLocalDate()
  return (
    <div className="today-page">
      <section className="today-heading" aria-labelledby="today-title">
        <div>
          <p className="eyebrow date-heading"><Sun size={17} strokeWidth={1.7} aria-hidden="true" /><time dateTime={date}>{formatLocalDate(date)}</time></p>
          <h1 id="today-title">Сегодня<span className="heading-dot">.</span></h1>
          <p className="page-description">Маленькие действия. Ваш собственный темп.</p>
        </div>
        <div className="day-note"><span>НОВЫЙ ДЕНЬ — НОВЫЙ ШАГ</span><p>Не идеально.<br />Просто последовательно.</p><ArrowRight size={20} strokeWidth={1.5} aria-hidden="true" /></div>
      </section>

      <DayHabits key={date} date={date} mode="today" />

      <div className="gentle-reminder"><Info size={18} strokeWidth={1.7} aria-hidden="true" /><p><strong>Не каждый день должен быть идеальным.</strong> «Нет данных» — это отсутствие оценки, а не неудача. Любую отметку за сегодня можно изменить.</p></div>
    </div>
  )
}
