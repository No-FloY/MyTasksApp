import { useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getLocalDate, type LocalDate } from '@/lib/local-date'
import { HABIT_CATEGORIES, getHabitCategory } from '@/models/habit-category'
import { DayScore, TodayWeeklyScore } from '@/features/statistics/DayScore'
import { HabitRow } from '@/features/today/components/HabitRow'
import { AmountTracker } from '@/features/today/components/AmountTracker'
import { DurationTracker } from '@/features/today/components/DurationTracker'
import { useDayHabits } from './use-day-habits'
import './day-habits.css'

export function DayHabits({ date, mode }: { date: LocalDate; mode: 'today' | 'calendar' }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const {
    habits, amountHabits, loading, error, retry, saveStatus, getSaveState,
    addAmount, submitAmount, changeAmountInput, getAmountInput,
    durationHabits, getDurationDraft, changeDurationInput, submitDuration,
  } = useDayHabits(date, mode)
  const count = habits.length + amountHabits.length + durationHabits.length
  const categories = HABIT_CATEGORIES.map((category) => ({
    ...category,
    booleans: habits.filter((item) => getHabitCategory(item.habit) === category.id),
    amounts: amountHabits.filter((item) => getHabitCategory(item.habit) === category.id),
    durations: durationHabits.filter((item) => getHabitCategory(item.habit) === category.id),
  })).filter((category) => category.booleans.length + category.amounts.length + category.durations.length > 0)

  return <>
    {date <= getLocalDate() && <DayScore date={date} />}
    {date <= getLocalDate() && <TodayWeeklyScore date={date} />}
    <div className="day-habits">
      <div className="habits-card-heading day-habits-heading">
        <div><h2>Ежедневные привычки</h2><p>{mode === 'calendar' ? 'Результаты выбранного дня и недели' : 'Как проходит ваш день? Недельные привычки отмечаются один раз.'}</p></div>
        {!loading && !error && <span className="habit-count">Всего: {count}</span>}
      </div>
      {loading && <div className="empty-state" role="status"><LoaderCircle className="spin" size={25} aria-hidden="true" /><p>Загружаем ваши привычки…</p></div>}
      {error && <div className="empty-state error-state" role="alert">
        <AlertCircle size={28} aria-hidden="true" />
        <h3>Не удалось открыть привычки</h3>
        <p>Проверьте, разрешено ли хранение данных в браузере, и попробуйте ещё раз.</p>
        <Button onClick={retry}>Повторить загрузку</Button>
      </div>}
      {!loading && !error && count === 0 && <div className="empty-state"><p>Нет активных привычек для отметки.</p></div>}
      {!loading && !error && categories.map((category) => <section
        className="habit-category" key={category.id} data-habit-category={category.id}
        aria-labelledby={`day-category-${category.id}`}
      >
        <header className="habit-category-heading">
          <h3 id={`day-category-${category.id}`}>{category.label}</h3>
          <span>{category.booleans.filter((item) => item.status !== 'no-data').length + category.amounts.filter((item) => item.hasEntry).length + category.durations.filter((item) => item.minutes !== null).length} / {category.booleans.length + category.amounts.length + category.durations.length} отмечено</span>
          <Button variant="ghost" size="icon" aria-label={`${collapsed[category.id] ? 'Развернуть' : 'Свернуть'} категорию «${category.label}»`}
            aria-expanded={!collapsed[category.id]} aria-controls={`category-content-${category.id}`}
            onClick={() => setCollapsed((current) => ({ ...current, [category.id]: !current[category.id] }))}>
            {collapsed[category.id] ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </Button>
        </header>
        <div id={`category-content-${category.id}`} hidden={Boolean(collapsed[category.id])}>
        {category.amounts.length > 0 && <div className="category-amounts">
          {category.amounts.map((item) => {
            const saveState = getSaveState(item.habit.id)
            return <AmountTracker
              mode={mode === 'calendar' ? 'total' : item.habit.manualMode}
              showQuickActions={mode === 'today'}
              key={`${date}:${item.habit.id}`}
              item={item}
              input={getAmountInput(item.habit.id)}
              pending={saveState.pending}
              error={saveState.error}
              onInputChange={(input) => changeAmountInput(item.habit.id, input)}
              onAdd={(amount) => addAmount(item.habit.id, amount)}
              onSubmit={() => submitAmount(item.habit.id)}
            />
          })}
        </div>}
        {category.durations.length > 0 && <div className="duration-trackers">
          {category.durations.map((item) => {
            const saveState = getSaveState(item.habit.id)
            const input = getDurationDraft(item.habit.id)
            return <DurationTracker
              dayLabel={mode === 'calendar' ? 'Время за выбранный день' : 'Время за сегодня'}
              key={`${date}:${item.habit.id}`}
              item={item}
              hours={input.hours}
              minutes={input.minutes}
              pending={saveState.pending}
              error={saveState.error}
              onHoursChange={(value) => changeDurationInput(item.habit.id, 'hours', value)}
              onMinutesChange={(value) => changeDurationInput(item.habit.id, 'minutes', value)}
              onSubmit={() => submitDuration(item.habit.id)}
            />
          })}
        </div>}
        {category.booleans.length > 0 && <Card className="habits-card category-booleans">
          <ul className="habit-list" aria-label={`${category.label}: ${mode === 'calendar' ? 'привычки выбранного дня' : 'привычки на сегодня'}`}>
            {category.booleans.map(({ habit, status }, index) => {
              const saveState = getSaveState(habit.id)
              return <HabitRow key={habit.id} habit={habit} date={date} status={status} index={index} pending={saveState.pending} error={saveState.error} onChange={(nextStatus) => saveStatus(habit.id, nextStatus)} />
            })}
          </ul>
        </Card>}
        </div>
      </section>)}
      <div className="habits-card-footer"><span className="storage-dot" aria-hidden="true" /><span>Отметки сохраняются автоматически в этом браузере</span></div>
    </div>
  </>
}
