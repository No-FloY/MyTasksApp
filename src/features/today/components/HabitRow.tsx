import { Check, LoaderCircle, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BooleanHabitStatus } from '@/models/habit-entry'
import type { BooleanHabitWithStatus } from '@/services/habit-service'

const statusOptions = [
  { value: 'success', label: 'Успех', icon: Check },
  { value: 'failure', label: 'Неудача', icon: X },
  { value: 'no-data', label: 'Нет данных', icon: Minus },
] as const

interface HabitRowProps extends BooleanHabitWithStatus {
  index: number
  pending: boolean
  error?: string | undefined
  onChange: (status: BooleanHabitStatus) => void
}

export function HabitRow({ habit, status, index, pending, error, onChange }: HabitRowProps) {
  const StatusIcon = statusOptions.find((option) => option.value === status)?.icon ?? Minus

  return (
    <li className={cn('habit-row', `habit-${status}`)} data-habit-id={habit.id} aria-label={habit.name}>
      <div className="habit-main">
        <span className="habit-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div className="habit-copy">
          <h3 id={`habit-${habit.id}`}>{habit.name}</h3>
          {habit.description && <p>{habit.description}</p>}
        </div>
        <span className={cn('habit-status-mark', status)} aria-hidden="true"><StatusIcon size={17} /></span>
      </div>
      <fieldset className="status-control" disabled={pending} aria-busy={pending}>
        <legend className="sr-only">Результат привычки «{habit.name}»</legend>
        {statusOptions.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="sm"
            className={cn('status-button', value, status === value && 'is-selected')}
            aria-pressed={status === value}
            onClick={() => onChange(value)}
          >
            <Icon size={14} aria-hidden="true" />{label}
          </Button>
        ))}
      </fieldset>
      {pending && <span className="save-feedback" role="status"><LoaderCircle className="spin" size={12} aria-hidden="true" />Сохраняем…</span>}
      {error && <p className="habit-error" role="alert">{error}</p>}
    </li>
  )
}
