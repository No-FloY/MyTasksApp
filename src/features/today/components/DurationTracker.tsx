import { useId } from 'react'
import { Clock3, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDuration, type DurationHabitWithRating } from '@/services/duration-service'
import '../duration-tracker.css'

interface DurationTrackerProps {
  dayLabel?: string
  item: DurationHabitWithRating
  hours: string
  minutes: string
  pending: boolean
  error: string | undefined
  onHoursChange: (value: string) => void
  onMinutesChange: (value: string) => void
  onSubmit: () => void
}

export function DurationTracker({
  dayLabel = 'Время за сегодня',
  item: { habit, minutes: savedMinutes, rating },
  hours,
  minutes,
  pending,
  error,
  onHoursChange,
  onMinutesChange,
  onSubmit,
}: DurationTrackerProps) {
  const id = useId()
  const titleId = `${id}-title`
  const hoursId = `${id}-hours`
  const minutesId = `${id}-minutes`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? `${hintId} ${errorId}` : hintId

  return (
    <section className="duration-tracker" aria-labelledby={titleId} data-duration-habit-id={habit.id}>
      <Card className="duration-tracker-card">
        <div className="duration-heading">
          <span className="duration-icon"><Clock3 size={22} strokeWidth={1.6} aria-hidden="true" /></span>
          <div>
            <h2 id={titleId}>{habit.name}</h2>
            <p>{dayLabel}</p>
          </div>
        </div>

        <div className="duration-result" aria-live="polite" aria-atomic="true">
          <p className={`duration-total ${savedMinutes === null ? 'is-empty' : ''}`}>
            {savedMinutes === null ? 'Нет данных' : formatDuration(savedMinutes)}
          </p>
          {rating ? (
            <p className="duration-rating">
              <span aria-hidden="true">{rating.emoji}</span>
              <span>{rating.label}</span>
            </p>
          ) : (
            <p className="duration-no-rating">Оценка появится после сохранения времени.</p>
          )}
        </div>

        <form
          className="duration-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <div className="duration-inputs">
            <div className="duration-field">
              <label htmlFor={hoursId}>Часы</label>
              <input
                id={hoursId}
                name="hours"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="0"
                value={hours}
                disabled={pending}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                onChange={(event) => onHoursChange(event.target.value)}
              />
            </div>
            <div className="duration-field">
              <label htmlFor={minutesId}>Минуты</label>
              <input
                id={minutesId}
                name="minutes"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="0–59"
                value={minutes}
                disabled={pending}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                onChange={(event) => onMinutesChange(event.target.value)}
              />
            </div>
          </div>
          <p id={hintId} className="duration-hint">Укажите итог за день, включая 0 ч 0 мин. Новое значение заменит предыдущее.</p>
          <Button className="duration-submit" type="submit" disabled={pending}>
            {pending && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
            {pending ? 'Сохраняем…' : 'Сохранить время'}
          </Button>
          {error && <p id={errorId} className="duration-error" role="alert">{error}</p>}
        </form>

        <details className="duration-ranges">
          <summary>Как считается оценка</summary>
          <dl>
            {habit.ratingRanges.map((range) => (
              <div className="duration-range" key={range.id}>
                <dt><span aria-hidden="true">{range.emoji}</span> {range.label}</dt>
                <dd>
                  {range.maxMinutes === null
                    ? `От ${formatDuration(range.minMinutes)}`
                    : range.minMinutes === range.maxMinutes
                      ? formatDuration(range.minMinutes)
                      : `${formatDuration(range.minMinutes)} – ${formatDuration(range.maxMinutes)}`}
                </dd>
              </div>
            ))}
          </dl>
          <p>Обе границы включены. Оценка зависит от сохранённого времени.</p>
        </details>

        <p className="duration-save-note">
          <span className="storage-dot" aria-hidden="true" />Сохраняется в этом браузере
        </p>
      </Card>
    </section>
  )
}
