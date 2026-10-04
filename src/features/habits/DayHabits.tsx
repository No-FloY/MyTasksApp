import { AlertCircle, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { LocalDate } from '@/lib/local-date'
import { HabitRow } from '@/features/today/components/HabitRow'
import { AmountTracker } from '@/features/today/components/AmountTracker'
import { DurationTracker } from '@/features/today/components/DurationTracker'
import { useDayHabits } from './use-day-habits'

export function DayHabits({ date, mode }: { date: LocalDate; mode: 'today' | 'calendar' }) {
  const {
    habits, amountHabits, loading, error, retry, saveStatus, getSaveState,
    addAmount, submitAmount, changeAmountInput, getAmountInput,
    durationHabits, getDurationDraft, changeDurationInput, submitDuration,
  } = useDayHabits(date, mode)
  return <>
      {amountHabits.map((item) => {
        const saveState = getSaveState(item.habit.id)
        return (
          <AmountTracker
            mode={mode === 'calendar' ? 'total' : 'add'}
            key={`${date}:${item.habit.id}`}
            item={item}
            input={getAmountInput(item.habit.id)}
            pending={saveState.pending}
            error={saveState.error}
            onInputChange={(input) => changeAmountInput(item.habit.id, input)}
            onAdd={(amount) => addAmount(item.habit.id, amount)}
            onSubmit={() => submitAmount(item.habit.id)}
          />
        )
      })}

      {durationHabits.length > 0 && (
        <div className="duration-trackers">
          {durationHabits.map((item) => {
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
        </div>
      )}

      <Card className="habits-card">
        <div className="habits-card-heading">
          <div><h2>Ежедневные привычки</h2><p>{mode === 'calendar' ? 'Результаты выбранного дня' : 'Как проходит ваш день?'}</p></div>
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

        {!loading && !error && habits.length === 0 && <div className="empty-state"><p>Нет активных привычек.</p></div>}

        {!loading && !error && habits.length > 0 && (
          <ul className="habit-list" aria-label={mode === 'calendar' ? 'Привычки выбранного дня' : 'Привычки на сегодня'}>
            {habits.map(({ habit, status }, index) => {
              const saveState = getSaveState(habit.id)
              return <HabitRow key={habit.id} habit={habit} status={status} index={index} pending={saveState.pending} error={saveState.error} onChange={(nextStatus) => saveStatus(habit.id, nextStatus)} />
            })}
          </ul>
        )}

        <div className="habits-card-footer"><span className="storage-dot" aria-hidden="true" /><span>Отметки сохраняются автоматически в этом браузере</span></div>
      </Card>

  </>
}
