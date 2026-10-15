import { AlertCircle, ArrowLeft, ArrowUpRight, LoaderCircle, Plus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useHashParam } from '@/hooks/use-hash-param'
import { useLocalDate } from '@/hooks/use-local-date'
import type { Goal } from '@/models/goal'
import { isGoalOverdue } from '@/services/goal-service'
import { GoalDetails } from './GoalDetails'
import { GoalFormDialog } from './GoalFormDialog'
import { GoalProgress } from './GoalProgress'
import { useGoals } from './use-goals'
import '@/features/tasks/tasks.css'
import './goals.css'

const sections = [
  { key: 'overdue', title: 'Просроченные' },
  { key: 'active', title: 'В процессе' },
  { key: 'completed', title: 'Завершённые' },
  { key: 'failed', title: 'Не достигнутые' },
  { key: 'cancelled', title: 'Отменённые' },
  { key: 'archived', title: 'Архив' },
] as const
const statusLabels = { active: 'В процессе', completed: 'Завершена', failed: 'Не достигнута', cancelled: 'Отменена' }

export default function GoalsPage() {
  const today = useLocalDate()
  const selectedId = useHashParam('id')
  const { goals, details, loading, error, retry } = useGoals(selectedId)
  const focusRef = useRef<HTMLButtonElement>(null)
  const focusedId = useRef<string | null>(null)
  const [form, setForm] = useState<{ goal?: Goal } | null>(null)

  useEffect(() => {
    if (selectedId === focusedId.current || loading || error) return
    focusedId.current = selectedId
    focusRef.current?.focus()
  }, [selectedId, loading, error])

  function allGoals() { window.location.hash = 'goals' }

  return (
    <div className="goals-page">
      {selectedId ? <Button ref={focusRef} className="goal-back" variant="ghost" onClick={allGoals}><ArrowLeft aria-hidden="true" />Все цели</Button> : <header className="tasks-page-heading"><div><p className="eyebrow">ШАГ ЗА ШАГОМ К РЕЗУЛЬТАТУ</p><h1>Цели<span className="heading-dot" aria-hidden="true">.</span></h1><p className="page-description">Важные результаты, для которых нужно больше одного дня.</p></div><Button ref={focusRef} disabled={loading || error} onClick={() => setForm({})}><Plus aria-hidden="true" />Добавить цель</Button></header>}
      {loading && <p className="task-read-state" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" />Загружаем цели…</p>}
      {error && <div className="task-read-state task-read-error" role="alert"><AlertCircle size={20} aria-hidden="true" /><p>Не удалось загрузить цели. Проверьте доступ к локальному хранилищу.</p><Button variant="outline" onClick={retry}>Повторить загрузку целей</Button></div>}
      {!loading && !error && (selectedId ? details ? <GoalDetails key={details.goal.id} {...details} today={today} onEdit={() => setForm({ goal: details.goal })} onDeleted={allGoals} fallbackFocus={focusRef} /> : <p className="task-empty" role="status">Цель не найдена. Возможно, она была удалена.</p> : <div className="task-groups">
        {goals.length === 0 && <p className="task-empty">Пока целей нет. Добавьте первый результат, к которому хотите прийти.</p>}
        {sections.map((section) => {
          const items = goals.filter(({ goal }) => (goal.archived ? 'archived' : isGoalOverdue(goal, today) ? 'overdue' : goal.status) === section.key)
          return items.length > 0 && <section className={`task-group task-group-${section.key}`} key={section.key} aria-labelledby={`goals-${section.key}`}><div className="task-group-heading"><h2 id={`goals-${section.key}`}>{section.title}</h2><span>{items.length}</span></div><ul className="goal-list">{items.map(({ goal, progress, completedMilestones, totalMilestones }) => <li key={goal.id}><article className="goal-card" data-goal-id={goal.id} aria-labelledby={`goal-${goal.id}-title`}><a className="goal-card-link" href={`#goals?id=${encodeURIComponent(goal.id)}`}><h3 id={`goal-${goal.id}-title`}>{goal.title}</h3><ArrowUpRight size={18} aria-hidden="true" /></a><div className="goal-card-meta"><span className={`goal-badge goal-status-${goal.status}`}>{statusLabels[goal.status]}</span>{isGoalOverdue(goal, today) && <span className="goal-overdue">Просрочена</span>}{goal.archived && <span>В архиве</span>}</div><p className="goal-card-deadline">{goal.deadline ? <time dateTime={goal.deadline}>До {format(parseISO(goal.deadline), 'd MMMM yyyy', { locale: ru })}</time> : 'Без дедлайна'}</p><GoalProgress progress={progress} /><p className="goal-hint">{completedMilestones} / {totalMilestones} этапов · {goal.progressMode === 'auto' ? 'Автоматически' : 'Вручную'}</p></article></li>)}</ul></section>
        })}
      </div>)}
      {form && <GoalFormDialog goal={form.goal} onClose={() => setForm(null)} onCreated={(goal) => { window.location.hash = `goals?id=${encodeURIComponent(goal.id)}` }} fallbackFocus={focusRef} />}
    </div>
  )
}
