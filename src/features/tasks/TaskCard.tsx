import { Ban, Check, Circle, LoaderCircle, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'
import { useId, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { formatLocalDate } from '@/lib/local-date'
import type { Task } from '@/models/task'
import { getTaskOutcome, taskStatusLabels } from '@/services/task-service'
import './tasks.css'

const priorityLabels = { low: 'Низкий', medium: 'Средний', high: 'Высокий' }

interface TaskCardProps {
  task: Task
  now: Date
  onToggle?: ((task: Task) => void) | undefined
  pending?: boolean
  error?: string | undefined
  onEdit?: (task: Task) => void
  onDelete?: (task: Task) => void
  onFail?: (task: Task) => void
  onCancel?: (task: Task) => void
  compact?: boolean
  highlighted?: boolean
}

export function TaskCard({ task, now, onToggle, pending, error, onEdit, onDelete, onFail, onCancel, compact = false, highlighted = false }: TaskCardProps) {
  const titleId = useId()
  const actionsRef = useRef<HTMLDetailsElement>(null)
  const completed = task.status === 'completed'
  const outcome = getTaskOutcome(task, now)
  const overdue = outcome === 'overdue'
  const canToggle = task.status === 'active' || completed

  function openAction(action: (task: Task) => void) {
    const menu = actionsRef.current
    if (menu) {
      menu.open = false
      // Restore dialog focus to the visible trigger, not a hidden menu action.
      menu.querySelector('summary')?.focus()
    }
    action(task)
  }
  return (
    <article id={compact ? undefined : `task-${task.id}`} tabIndex={-1} className={`task-card${completed ? ' is-completed' : ''}${compact ? ' is-compact' : ''}${highlighted ? ' is-highlighted' : ''}`} data-task-id={task.id} data-task-selected={highlighted || undefined} aria-labelledby={titleId}>
      <div className="task-card-main">
        {onToggle && canToggle && (
          <Button
            className="task-completion"
            variant="ghost"
            size="icon"
            aria-label={completed ? `Вернуть в активные «${task.title}»` : `Выполнить задачу «${task.title}»`}
            aria-pressed={completed}
            disabled={pending}
            onClick={() => onToggle(task)}
          >
            {pending ? <LoaderCircle className="spin" aria-hidden="true" /> : completed ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
          </Button>
        )}
        <div className="task-card-copy">
          <h3 id={titleId}>{task.title}</h3>
          <div className="task-meta">
            {!compact && <time dateTime={task.date}>{formatLocalDate(task.date)}, {task.date.slice(0, 4)}</time>}
            {task.time && <time dateTime={`${task.date}T${task.time}`}>{task.time}</time>}
            <span className={`task-priority priority-${task.priority}`}>Приоритет: {priorityLabels[task.priority].toLowerCase()}</span>
            {completed && <span className="task-status">{outcome === 'completed_on_time' ? 'Выполнена вовремя' : outcome === 'completed_late' ? 'Выполнена с опозданием' : 'Выполнена · время неизвестно'}</span>}
            {(task.status === 'failed' || task.status === 'cancelled') && <span className={task.status === 'failed' ? 'task-overdue' : 'task-status'}>{taskStatusLabels[task.status]}</span>}
            {overdue && <span className="task-overdue">Просрочена</span>}
            {!onToggle && task.status === 'active' && !overdue && <span className="task-status">Активная</span>}
          </div>
        </div>
        {(onEdit || onDelete) && (
          <details ref={actionsRef} className="task-actions">
            <summary role="button" aria-label={`Действия для задачи «${task.title}»`}><MoreHorizontal size={21} aria-hidden="true" /></summary>
            <div className="task-action-list">
              {onToggle && task.status === 'active' && <Button variant="ghost" disabled={pending} onClick={() => openAction(onToggle)}><Check aria-hidden="true" />Выполнить</Button>}
              {onFail && task.status === 'active' && <Button variant="ghost" disabled={pending} onClick={() => openAction(onFail)}><X aria-hidden="true" />Отметить как не выполненную</Button>}
              {onCancel && task.status === 'active' && <Button variant="ghost" disabled={pending} onClick={() => openAction(onCancel)}><Ban aria-hidden="true" />Отменить</Button>}
              {onEdit && <Button variant="ghost" disabled={pending} onClick={() => openAction(onEdit)}><Pencil aria-hidden="true" />Редактировать</Button>}
              {onDelete && <Button variant="ghost" className="task-delete-action" disabled={pending} onClick={() => openAction(onDelete)}><Trash2 aria-hidden="true" />Удалить</Button>}
            </div>
          </details>
        )}
      </div>
      {!compact && task.description && <p className="task-description">{task.description}</p>}
      {task.goalId && <a className="task-goal-link" href={`#goals?id=${encodeURIComponent(task.goalId)}`}>Перейти к цели</a>}
      {error && <p className="task-error" role="alert">{error}</p>}
    </article>
  )
}
