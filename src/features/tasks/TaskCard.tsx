import { Check, Circle, LoaderCircle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useId, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { formatLocalDate, type LocalDate } from '@/lib/local-date'
import type { Task } from '@/models/task'
import { isTaskOverdue } from '@/services/task-service'
import './tasks.css'

const priorityLabels = { low: 'Низкий', medium: 'Средний', high: 'Высокий' }

interface TaskCardProps {
  task: Task
  today: LocalDate
  onToggle?: ((task: Task) => void) | undefined
  pending?: boolean
  error?: string | undefined
  onEdit?: (task: Task) => void
  onDelete?: (task: Task) => void
  compact?: boolean
}

export function TaskCard({ task, today, onToggle, pending, error, onEdit, onDelete, compact = false }: TaskCardProps) {
  const titleId = useId()
  const actionsRef = useRef<HTMLDetailsElement>(null)
  const completed = task.status === 'completed'
  const overdue = isTaskOverdue(task, today)

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
    <article className={`task-card${completed ? ' is-completed' : ''}${compact ? ' is-compact' : ''}`} data-task-id={task.id} aria-labelledby={titleId}>
      <div className="task-card-main">
        {onToggle && (
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
            {completed && <span className="task-status">Выполнена</span>}
            {overdue && <span className="task-overdue">Просрочена</span>}
            {!onToggle && !completed && !overdue && <span className="task-status">Активная</span>}
          </div>
        </div>
        {(onEdit || onDelete) && (
          <details ref={actionsRef} className="task-actions">
            <summary role="button" aria-label={`Действия для задачи «${task.title}»`}><MoreHorizontal size={21} aria-hidden="true" /></summary>
            <div className="task-action-list">
              {onEdit && <Button variant="ghost" disabled={pending} onClick={() => openAction(onEdit)}><Pencil aria-hidden="true" />Редактировать</Button>}
              {onDelete && <Button variant="ghost" className="task-delete-action" disabled={pending} onClick={() => openAction(onDelete)}><Trash2 aria-hidden="true" />Удалить</Button>}
            </div>
          </details>
        )}
      </div>
      {!compact && task.description && <p className="task-description">{task.description}</p>}
      {error && <p className="task-error" role="alert">{error}</p>}
    </article>
  )
}
