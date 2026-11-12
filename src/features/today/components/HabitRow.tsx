import { Check, Coffee, LoaderCircle, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BooleanHabitStatus } from '@/models/habit-entry'
import type { BooleanHabitWithStatus } from '@/services/habit-service'
import type { LocalDate } from '@/lib/local-date'
import { getWeekEnd, getWeekStart, isWeeklyHabit } from '@/services/habit-schedule'
import { formatStatisticsDate } from '@/features/statistics/format-statistics'
import { isObservationalHabit } from '@/models/habit-policy'

const statusOptions = [
  { value: 'success', label: 'Успех', icon: Check },
  { value: 'failure', label: 'Неудача', icon: X },
  { value: 'no-data', label: 'Нет данных', icon: Minus },
] as const

interface HabitRowProps extends BooleanHabitWithStatus {
  date: LocalDate
  index: number
  pending: boolean
  error?: string | undefined
  onChange: (status: BooleanHabitStatus) => void
}

export function HabitRow({ habit, status, source, date, index, pending, error, onChange }: HabitRowProps) {
  const observational = isObservationalHabit(habit)
  const StatusIcon = observational ? status === 'success' ? Coffee : Minus : statusOptions.find((option) => option.value === status)?.icon ?? Minus
  const weekly = isWeeklyHabit(habit)
  const labels = habit.id === 'coffee' ? ['Пил', 'Не пил'] : habit.id === 'no-alcohol' ? ['Не пил', 'Пил']
    : habit.id === 'no-sweets' ? ['Не ел', 'Ел']
    : ['breakfast', 'lunch', 'dinner'].includes(habit.id) ? ['Был', 'Не было']
    : weekly ? ['Выполнено', 'Не выполнено'] : ['Успех', 'Неудача']

  return (
    <li className={cn('habit-row', `habit-${status}`, observational && 'habit-observation')} data-habit-id={habit.id} data-result-source={source} aria-label={habit.name}>
      <div className="habit-main">
        <span className="habit-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div className="habit-copy">
          <h3 id={`habit-${habit.id}`}>{habit.name}</h3>
          {habit.description && <p>{habit.description}</p>}
          {source === 'inferred' && <p className="habit-inferred-label">По правилу незаполненного дня · можно изменить</p>}
          {weekly && <p className="habit-schedule-label">1 раз в неделю · {formatStatisticsDate(getWeekStart(date), true)} — {formatStatisticsDate(getWeekEnd(date), true)}. Одна отметка на всю неделю.</p>}
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
            {observational ? value === 'success' ? <Coffee size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}{value === 'success' ? labels[0] : value === 'failure' ? labels[1] : label}
          </Button>
        ))}
      </fieldset>
      {pending && <span className="save-feedback" role="status"><LoaderCircle className="spin" size={12} aria-hidden="true" />Сохраняем…</span>}
      {error && <p className="habit-error" role="alert">{error}</p>}
    </li>
  )
}
