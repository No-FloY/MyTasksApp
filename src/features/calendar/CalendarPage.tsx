import { useEffect, useRef, type KeyboardEvent } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DayHabits } from '@/features/habits/DayHabits'
import { useLocalDate } from '@/hooks/use-local-date'
import { getCalendarMonth, shiftCalendarMonth } from '@/lib/calendar'
import { getLocalDate, isFutureDate, type LocalDate } from '@/lib/local-date'
import { DayInsights } from './DayInsights'
import { useCalendarMonth, useCalendarSelection } from './use-calendar'
import './calendar.css'

const statusLabels = { 'no-data': 'Нет данных', partial: 'Частично заполнен', complete: 'Все привычки отмечены' }

export default function CalendarPage() {
  const today = useLocalDate()
  const { selectedDate, month, select } = useCalendarSelection(today)
  const grid = getCalendarMonth(month)
  const { data, loading, error, retry, initialized } = useCalendarMonth(month)
  const future = isFutureDate(selectedDate, today)
  const calendarRef = useRef<HTMLDivElement>(null)
  const focusDate = useRef<LocalDate | null>(null)

  useEffect(() => {
    if (focusDate.current) {
      calendarRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${focusDate.current}"]`)?.focus()
      focusDate.current = null
    }
  }, [selectedDate, month])

  function onDayKey(event: KeyboardEvent<HTMLButtonElement>, date: LocalDate) {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
    if (offset === undefined) return
    event.preventDefault()
    const next = getLocalDate(addDays(parseISO(date), offset))
    focusDate.current = next
    select(next)
  }

  return <div className="calendar-page">
    <section className="today-heading">
      <div>
        <p className="eyebrow date-heading"><CalendarDays size={17} aria-hidden="true" />ВАША ИСТОРИЯ</p>
        <h1>Календарь<span className="heading-dot" aria-hidden="true">.</span></h1>
        <p className="page-description">Выберите день, чтобы посмотреть или исправить результаты.</p>
      </div>
    </section>

    <section className="calendar-card" aria-label="Календарь привычек">
      <div className="calendar-toolbar">
        <h2 data-testid="calendar-month" aria-live="polite">{format(parseISO(month), 'LLLL yyyy', { locale: ru })}</h2>
        <div className="calendar-navigation">
          <Button variant="secondary" aria-label="Предыдущий месяц" onClick={() => select(selectedDate, shiftCalendarMonth(month, -1))}><ChevronLeft size={20} aria-hidden="true" /></Button>
          <Button variant="secondary" onClick={() => select(today)}>Сегодня</Button>
          <Button variant="secondary" aria-label="Следующий месяц" onClick={() => select(selectedDate, shiftCalendarMonth(month, 1))}><ChevronRight size={20} aria-hidden="true" /></Button>
        </div>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid" ref={calendarRef} role="group" aria-label="Дни месяца" aria-busy={loading}>
        {grid.days.map(({ date, inMonth }) => {
          const summary = data?.summaries[date]
          const isToday = date === today
          const isSelected = date === selectedDate
          const isFuture = isFutureDate(date, today)
          const status = summary?.status ?? 'no-data'
          const detail = isFuture ? 'Этот день ещё не наступил' : loading ? 'Загружаем данные' : error ? 'Данные недоступны'
            : `${statusLabels[status]}. Отмечено ${summary?.recorded ?? 0} из ${summary?.total ?? 0}`
          return <button
            key={date}
            type="button"
            className={`calendar-day ${inMonth ? '' : 'is-outside'} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}
            data-calendar-date={date}
            data-day-status={isFuture || loading || error ? undefined : status}
            aria-label={`${format(parseISO(date), 'EEEE, d MMMM yyyy', { locale: ru })}. ${detail}`}
            aria-pressed={isSelected}
            aria-current={isToday ? 'date' : undefined}
            onClick={() => select(date, inMonth ? month : date)}
            onKeyDown={(event) => onDayKey(event, date)}
          >
            <span className="calendar-day-number">{format(parseISO(date), 'd')}</span>
            <span className={`calendar-day-summary summary-${status}`} aria-hidden="true">
              {isFuture || loading || error ? '·' : status === 'complete' ? '✓' : status === 'partial' ? `${summary?.recorded}/${summary?.total}` : '—'}
            </span>
          </button>
        })}
      </div>
      {loading && <p className="calendar-feedback" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true" />Загружаем историю…</p>}
      {error && <div className="calendar-feedback" role="alert"><AlertCircle size={18} aria-hidden="true" /><p>Не удалось загрузить календарь.</p><Button onClick={retry}>Повторить загрузку</Button></div>}
      <ul className="calendar-legend" aria-label="Обозначения календаря">
        <li><span aria-hidden="true">—</span>Нет данных</li>
        <li><span aria-hidden="true">3/11</span>Часть отмечена</li>
        <li><span aria-hidden="true">✓</span>Всё отмечено</li>
      </ul>
      <p className="calendar-explanation">Индикатор показывает заполненность, а не оценку дня. «Нет данных» не считается неудачей. Сегодня обведено, выбранный день выделен фоном.</p>
    </section>

    <section className="calendar-selected" data-selected-date={selectedDate} aria-labelledby="selected-date-title">
      <div className="calendar-selected-heading">
        <p className="eyebrow">{selectedDate === today ? 'СЕГОДНЯ' : future ? 'БУДУЩИЙ ДЕНЬ' : 'ВЫБРАННЫЙ ДЕНЬ'}</p>
        <h2 id="selected-date-title"><time dateTime={selectedDate}>{format(parseISO(selectedDate), 'd MMMM yyyy', { locale: ru })}</time></h2>
        <p>{future ? 'Этот день ещё не наступил' : 'Изменения сохраняются для этой даты и сразу учитываются в статистике.'}</p>
      </div>
      {!future && initialized && <>
        <DayHabits key={selectedDate} date={selectedDate} mode="calendar" />
        <DayInsights key={`insights:${selectedDate}`} date={selectedDate} />
      </>}
    </section>
  </div>
}
