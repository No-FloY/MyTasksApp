import { AlertCircle, LoaderCircle, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useLocalDate } from '@/hooks/use-local-date'
import type { Task } from '@/models/task'
import { groupTasks } from '@/services/task-service'
import { DeleteTaskDialog } from './DeleteTaskDialog'
import { TaskCard } from './TaskCard'
import { TaskFormDialog } from './TaskFormDialog'
import { useTaskActions } from './use-task-actions'
import { useTasks } from './use-tasks'
import './tasks.css'

const sections = [
  { key: 'overdue', title: 'Просроченные' },
  { key: 'today', title: 'Сегодня' },
  { key: 'upcoming', title: 'Предстоящие' },
  { key: 'completed', title: 'Выполненные' },
] as const

type DialogState = { kind: 'create' } | { kind: 'edit' | 'delete'; task: Task }

export function TasksPage() {
  const today = useLocalDate()
  const { tasks, loading, error, retry } = useTasks()
  const { toggleTask, pendingIds, errors } = useTaskActions()
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const groups = groupTasks(tasks, today)

  async function toggle(task: Task) {
    await toggleTask(task)
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) addButtonRef.current?.focus()
    })
  }

  return (
    <div className="tasks-page">
      <header className="tasks-page-heading">
        <div>
          <p className="eyebrow">ВАЖНОЕ В СВОЁ ВРЕМЯ</p>
          <h1>Задачи<span className="heading-dot" aria-hidden="true">.</span></h1>
          <p className="page-description">Планы на день и дела, к которым хочется вернуться.</p>
        </div>
        <Button ref={addButtonRef} disabled={loading || error} onClick={() => setDialog({ kind: 'create' })}><Plus aria-hidden="true" />Добавить задачу</Button>
      </header>

      {loading && <p className="task-read-state" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" />Загружаем задачи…</p>}
      {error && <div className="task-read-state task-read-error" role="alert"><AlertCircle size={20} aria-hidden="true" /><p>Не удалось загрузить задачи. Проверьте доступ к локальному хранилищу.</p><Button variant="outline" onClick={retry}>Повторить загрузку задач</Button></div>}
      {!loading && !error && (
        <div className="task-groups">
          {tasks.length === 0 && <p className="task-empty">Пока задач нет. Добавьте первое дело на удобный день.</p>}
          {tasks.length > 0 && groups.today.length === 0 && <p className="task-empty task-empty-today">На сегодня задач нет.</p>}
          {sections.map(({ key, title }) => groups[key].length > 0 && (
            <section key={key} className={`task-group task-group-${key}`} aria-labelledby={`tasks-${key}`}>
              <div className="task-group-heading"><h2 id={`tasks-${key}`}>{title}</h2><span>{groups[key].length}</span></div>
              <ul className="task-list">
                {groups[key].map((task) => <li key={task.id}><TaskCard task={task} today={today} onToggle={(value) => { void toggle(value) }} pending={pendingIds.has(task.id)} error={errors[task.id]} onEdit={(value) => setDialog({ kind: 'edit', task: value })} onDelete={(value) => setDialog({ kind: 'delete', task: value })} /></li>)}
              </ul>
            </section>
          ))}
        </div>
      )}

      {dialog && dialog.kind !== 'delete' && <TaskFormDialog key={dialog.kind === 'edit' ? dialog.task.id : 'new'} task={dialog.kind === 'edit' ? dialog.task : undefined} today={today} onClose={() => setDialog(null)} fallbackFocus={addButtonRef} />}
      {dialog?.kind === 'delete' && <DeleteTaskDialog task={dialog.task} onClose={() => setDialog(null)} fallbackFocus={addButtonRef} />}
    </div>
  )
}

export default TasksPage
