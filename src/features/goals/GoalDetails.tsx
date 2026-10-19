import { Check, Circle, Link, Pencil, Plus, Trash2 } from 'lucide-react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useId, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import type { LocalDate } from '@/lib/local-date'
import type { Goal, GoalMilestone, GoalStatus } from '@/models/goal'
import type { Task } from '@/models/task'
import { calculateGoalProgress, goalService, isGoalOverdue, isMilestoneCompleted } from '@/services/goal-service'
import { taskStatusLabels } from '@/services/task-service'
import { DeleteGoalItemDialog } from './DeleteGoalItemDialog'
import { GoalProgress } from './GoalProgress'
import { LinkTaskDialog } from './LinkTaskDialog'
import { MilestoneFormDialog } from './MilestoneFormDialog'

const statusLabels: Record<GoalStatus, string> = { active: 'В процессе', completed: 'Завершена', failed: 'Не достигнута', cancelled: 'Отменена' }
type DialogState = { kind: 'add-milestone' | 'link-task' | 'delete-goal' } | { kind: 'edit-milestone' | 'delete-milestone'; milestone: GoalMilestone }

interface GoalDetailsProps {
  goal: Goal
  milestones: GoalMilestone[]
  tasks: Task[]
  today: LocalDate
  onEdit: () => void
  onDeleted: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function GoalDetails({ goal, milestones, tasks, today, onEdit, onDeleted, fallbackFocus }: GoalDetailsProps) {
  const id = useId()
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const pendingRef = useRef(false)
  const retryRef = useRef<(() => Promise<unknown>) | null>(null)
  const progress = calculateGoalProgress(goal, milestones)
  const completedCount = milestones.filter(isMilestoneCompleted).length
  const days = goal.deadline ? differenceInCalendarDays(parseISO(goal.deadline), parseISO(today)) : null
  const overdue = isGoalOverdue(goal, today)

  async function mutate(action: () => Promise<unknown>) {
    if (pendingRef.current) return
    pendingRef.current = true
    retryRef.current = action
    setPending(true)
    setError('')
    try { await action(); retryRef.current = null }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменение. Попробуйте ещё раз.') }
    finally {
      pendingRef.current = false
      setPending(false)
      requestAnimationFrame(() => { if (document.activeElement === document.body) fallbackFocus.current?.focus() })
    }
  }

  return (
    <article className="goal-details" data-goal-id={goal.id}>
      <section className="goal-overview" aria-labelledby={`${id}-heading`}>
        <div className="goal-badges"><span className={`goal-badge goal-status-${goal.status}`}>{statusLabels[goal.status]}</span>{overdue && <span className="goal-badge goal-overdue">Просрочена</span>}{goal.archived && <span className="goal-badge">В архиве</span>}</div>
        <h1 id={`${id}-heading`}>{goal.title}</h1>
        {goal.description && <p className="goal-description">{goal.description}</p>}
        <div className="goal-deadline">{goal.deadline ? <><time dateTime={goal.deadline}>До {format(parseISO(goal.deadline), 'd MMMM yyyy', { locale: ru })}</time>{goal.status === 'active' && days !== null && <span className={overdue ? 'goal-overdue' : ''}>{days > 0 ? `Осталось дней: ${days}` : days === 0 ? 'Дедлайн сегодня' : `Просрочено дней: ${Math.abs(days)}`}</span>}</> : <span>Без дедлайна</span>}</div>
        <GoalProgress progress={progress} />
        <p className="goal-hint">{goal.progressMode === 'auto' ? `Автоматически по этапам · ${completedCount} / ${milestones.length} выполнено` : 'Прогресс задан вручную'}{goal.progressMode === 'auto' && milestones.length === 0 ? '. Добавьте первый этап, чтобы отслеживать прогресс.' : ''}</p>
        <p className="goal-hint">Статус цели меняется отдельно и сохраняет фактический прогресс.</p>
        <div className="goal-controls">
          <div className="task-field goal-status-field"><label htmlFor={`${id}-status`}>Статус цели</label><select id={`${id}-status`} value={goal.status} disabled={pending} onChange={(event) => { const status = event.target.value as GoalStatus; void mutate(() => goalService.setGoalStatus(goal.id, status)) }}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <Button variant="outline" disabled={pending} onClick={onEdit}><Pencil aria-hidden="true" />Редактировать цель</Button>
          <Button variant="outline" disabled={pending} onClick={() => { void mutate(() => goalService.setGoalArchived(goal.id, !goal.archived)) }}>{goal.archived ? 'Вернуть из архива' : 'В архив'}</Button>
          <Button variant="ghost" className="task-delete-action" disabled={pending} onClick={() => setDialog({ kind: 'delete-goal' })}><Trash2 aria-hidden="true" />Удалить цель</Button>
        </div>
      </section>
      {error && <div className="goal-action-error" role="alert"><p className="task-error">{error}</p><Button variant="outline" disabled={pending} onClick={() => { if (retryRef.current) void mutate(retryRef.current) }}>Повторить действие</Button></div>}
      <section className="goal-section" aria-labelledby={`${id}-milestones`}>
        <header className="goal-section-heading"><div><h2 id={`${id}-milestones`}>Этапы</h2><p>{completedCount} / {milestones.length} выполнено</p></div><Button variant="outline" disabled={pending} onClick={() => setDialog({ kind: 'add-milestone' })}><Plus aria-hidden="true" />Добавить этап</Button></header>
        {milestones.length === 0 ? <p className="task-empty">Пока этапов нет. Разбейте цель на небольшие шаги.</p> : <ol className="goal-milestones">{milestones.map((milestone) => {
          const completed = isMilestoneCompleted(milestone)
          return <li className={`goal-milestone${completed ? ' is-completed' : ''}`} key={milestone.id} data-milestone-id={milestone.id}>
            <div className="goal-milestone-main">
              {milestone.type === 'boolean' ? <Button variant="ghost" size="icon" className="task-completion" aria-pressed={completed} aria-label={completed ? `Вернуть этап «${milestone.title}» в работу` : `Выполнить этап «${milestone.title}»`} disabled={pending} onClick={() => { void mutate(() => goalService.setMilestoneCompleted(milestone.id, !milestone.completed)) }}>{completed ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}</Button> : <span className="goal-amount-mark" aria-hidden="true">{completed ? <Check size={20} /> : <span>#</span>}</span>}
              <div className="goal-milestone-copy"><h3>{milestone.title}</h3><p>{milestone.type === 'amount' ? `${milestone.current} / ${milestone.target} · ` : ''}{completed ? 'Выполнен' : 'В работе'}</p></div>
            </div>
            <div className="goal-row-actions"><Button variant="ghost" size="icon" aria-label={`Редактировать этап «${milestone.title}»`} disabled={pending} onClick={() => setDialog({ kind: 'edit-milestone', milestone })}><Pencil aria-hidden="true" /></Button><Button variant="ghost" size="icon" className="task-delete-action" aria-label={`Удалить этап «${milestone.title}»`} disabled={pending} onClick={() => setDialog({ kind: 'delete-milestone', milestone })}><Trash2 aria-hidden="true" /></Button></div>
          </li>
        })}</ol>}
      </section>
      <section className="goal-section" aria-labelledby={`${id}-tasks`}>
        <header className="goal-section-heading"><div><h2 id={`${id}-tasks`}>Связанные задачи</h2><p>Конкретные действия на пути к результату</p></div><Button variant="outline" disabled={pending} onClick={() => setDialog({ kind: 'link-task' })}><Link aria-hidden="true" />Привязать задачу</Button></header>
        {tasks.length === 0 ? <p className="task-empty">Связанных задач пока нет.</p> : <ul className="goal-task-list">{tasks.map((task) => <li className="goal-linked-task" key={task.id}><div className="goal-linked-task-copy"><a href={`#tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</a><p><time dateTime={task.date}>{format(parseISO(task.date), 'd MMMM yyyy', { locale: ru })}</time> · {taskStatusLabels[task.status]}</p></div><Button variant="ghost" disabled={pending} aria-label={`Отвязать задачу «${task.title}»`} onClick={() => { void mutate(() => goalService.unlinkTask(goal.id, task.id)) }}>Отвязать</Button></li>)}</ul>}
        <p className="goal-hint">Задачи сохраняются отдельно. Их выполнение не меняет прогресс цели.</p>
      </section>
      {(dialog?.kind === 'add-milestone' || dialog?.kind === 'edit-milestone') && <MilestoneFormDialog goalId={goal.id} milestone={dialog.kind === 'edit-milestone' ? dialog.milestone : undefined} onClose={() => setDialog(null)} fallbackFocus={fallbackFocus} />}
      {dialog?.kind === 'link-task' && <LinkTaskDialog goalId={goal.id} onClose={() => setDialog(null)} fallbackFocus={fallbackFocus} />}
      {dialog?.kind === 'delete-goal' && <DeleteGoalItemDialog kind="goal" title={goal.title} remove={() => goalService.deleteGoal(goal.id)} onDeleted={onDeleted} onClose={() => setDialog(null)} fallbackFocus={fallbackFocus} />}
      {dialog?.kind === 'delete-milestone' && <DeleteGoalItemDialog kind="milestone" title={dialog.milestone.title} remove={() => goalService.deleteMilestone(dialog.milestone.id)} onClose={() => setDialog(null)} fallbackFocus={fallbackFocus} />}
    </article>
  )
}
