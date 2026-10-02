import { AlertCircle, ArrowRight, Info, LoaderCircle, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useLocalDate } from '@/hooks/use-local-date'
import { formatLocalDate } from '@/lib/local-date'
import { HabitRow } from './components/HabitRow'
import { useTodayHabits } from './use-today-habits'

export function TodayPage() {
  const date = useLocalDate()
  const { habits, loading, error, retry, saveStatus, getSaveState } = useTodayHabits(date)

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

      <Card className="habits-card">
        <div className="habits-card-heading">
          <div><h2>Ежедневные привычки</h2><p>Как проходит ваш день?</p></div>
          {!loading && !error && <span className="habit-count">Всего: {habits.length}</span>}
        </div>

        {loading && <div className="empty-state" role="status"><LoaderCircle className="spin" size={25} aria-hidden="true" /><p>Загружаем ваши привычки…</p></div>}

        {error && (
          <div className="empty-state error-state" role="alert">
            <AlertCircle size={28} aria-hidden="true" />
            <h3>Не удалось открыть привычки</h3>
            <p>Проверьте, разрешено ли хранение данных в браузере, и попробуйте ещё раз.</p>
            <Button onClick={retry}>Повторить загрузку</Button>
          </div>
        )}

        {!loading && !error && habits.length === 0 && <div className="empty-state"><p>На сегодня нет активных привычек.</p></div>}

        {!loading && !error && habits.length > 0 && (
          <ul className="habit-list" aria-label="Привычки на сегодня">
            {habits.map(({ habit, status }, index) => {
              const saveState = getSaveState(habit.id)
              return <HabitRow key={habit.id} habit={habit} status={status} index={index} pending={saveState.pending} error={saveState.error} onChange={(nextStatus) => saveStatus(habit.id, nextStatus)} />
            })}
          </ul>
        )}

        <div className="habits-card-footer"><span className="storage-dot" aria-hidden="true" /><span>Отметки сохраняются автоматически в этом браузере</span></div>
      </Card>

      <div className="gentle-reminder"><Info size={18} strokeWidth={1.7} aria-hidden="true" /><p><strong>Не каждый день должен быть идеальным.</strong> «Нет данных» — это отсутствие оценки, а не неудача. Любую отметку за сегодня можно изменить.</p></div>
    </div>
  )
}
