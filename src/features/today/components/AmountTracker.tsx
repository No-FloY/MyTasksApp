import { useId } from 'react'
import { Check, Droplets, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { AmountHabitWithProgress } from '@/services/habit-service'
import '../amount-tracker.css'

interface AmountTrackerProps {
  mode?: 'add' | 'total'
  item: AmountHabitWithProgress
  input: string
  pending: boolean
  error: string | undefined
  onInputChange: (value: string) => void
  onAdd: (amount: number) => void
  onSubmit: () => void
}

const numberFormatter = new Intl.NumberFormat('ru-RU')

export function AmountTracker({
  mode = 'add',
  item: { habit, value, status, progress, hasEntry },
  input,
  pending,
  error,
  onInputChange,
  onAdd,
  onSubmit,
}: AmountTrackerProps) {
  const id = useId()
  const titleId = `${id}-title`
  const inputId = `${id}-input`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const unitLabel = habit.unit === 'ml' ? 'мл' : habit.unit
  const amountLabel = `${numberFormatter.format(value)} / ${numberFormatter.format(habit.target)} ${unitLabel}`
  const statusLabel = hasEntry && value === 0 ? `Сохранено 0 ${unitLabel}` : status === 'success'
    ? 'Цель достигнута'
    : status === 'no-data'
      ? 'Пока нет записей'
      : 'Каждый стакан — шаг к цели'

  return (
    <section className="amount-tracker" aria-labelledby={titleId} data-amount-habit-id={habit.id}>
      <Card className="amount-tracker-card">
        <div className="amount-overview">
          <div className="amount-heading">
            <span className="amount-icon"><Droplets size={23} strokeWidth={1.6} aria-hidden="true" /></span>
            <div>
              <h2 id={titleId}>{habit.name}</h2>
              <p>Ваша дневная цель</p>
            </div>
          </div>

          <p className="amount-total" aria-live="polite" aria-atomic="true">
            <strong>{numberFormatter.format(value)}</strong>
            <span>/ {numberFormatter.format(habit.target)} {unitLabel}</span>
          </p>

          <div
            className={`amount-progress ${status === 'success' ? 'is-complete' : ''}`}
            role="progressbar"
            aria-label={`Прогресс: ${habit.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-valuetext={amountLabel}
          >
            <div className="amount-progress-fill" style={{ width: `${progress}%` }} />
          </div>

          <p className={`amount-status ${status === 'success' ? 'is-complete' : ''}`}>
            {status === 'success' && <Check size={15} strokeWidth={2} aria-hidden="true" />}
            {statusLabel}
          </p>
        </div>

        <div className="amount-controls">
          {mode === 'add' && <div className="amount-quick-actions" aria-label={`Быстро добавить: ${habit.name}`}>
            {[200, 400].map((amount) => (
              <Button
                key={amount}
                type="button"
                variant="secondary"
                className="amount-quick-button"
                disabled={pending}
                onClick={() => onAdd(amount)}
              >
                +{amount} {unitLabel}
              </Button>
            ))}
          </div>}

          <form
            className={`amount-form ${mode === 'total' ? 'amount-form-total' : ''}`}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit()
            }}
          >
            <label htmlFor={inputId}>{mode === 'total' ? 'Итог за день' : 'Сколько добавить'}, {unitLabel}</label>
            <div className="amount-input-row">
              <input
                id={inputId}
                name="amount"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="Например, 330"
                value={input}
                disabled={pending}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                onChange={(event) => onInputChange(event.target.value)}
              />
              <Button className="amount-submit" type="submit" disabled={pending}>{mode === 'total' ? 'Сохранить количество' : 'Добавить'}</Button>
            </div>
            <p id={hintId} className="amount-hint">{mode === 'total' ? 'Заменим итог выбранного дня. Можно указать 0.' : 'Прибавим к выпитому за сегодня.'}</p>
          </form>

          {error && <p id={errorId} className="amount-error" role="alert">{error}</p>}
          <p className="amount-save-note" role="status">
            {pending
              ? <><LoaderCircle size={13} className="spin" aria-hidden="true" />Сохраняем…</>
              : <><span className="storage-dot" aria-hidden="true" />Сохраняется в этом браузере</>}
          </p>
        </div>
      </Card>
    </section>
  )
}
