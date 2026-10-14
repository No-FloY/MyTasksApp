import { useEffect, useRef } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LocalDate } from '@/lib/local-date'
import type { Task } from '@/models/task'
import { TaskCard } from './TaskCard'
import { useTasks } from './use-tasks'
import { useTaskActions } from './use-task-actions'
import './tasks.css'
import './day-task-panel.css'

export function DayTaskPanel({ date, today, mode }: {
  date: LocalDate
  today: LocalDate
  mode: 'today' | 'calendar'
}) {
  const { tasks, loading, error, retry } = useTasks(date)
  const { toggleTask, pendingIds, errors } = useTaskActions()
  const completionFocus = useRef<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const displayed = mode === 'today' ? tasks.filter((task) => task.status === 'active') : tasks

  useEffect(() => {
    if (completionFocus.current && !displayed.some((task) => task.id === completionFocus.current)) {
      heading.current?.focus()
      completionFocus.current = null
    }
  }, [displayed])

  async function complete(task: Task) {
    completionFocus.current = task.id
    if (!await toggleTask(task)) completionFocus.current = null
  }

  const title = mode === 'today' ? 'Задачи на сегодня' : 'Задачи выбранного дня'
  return <section className="task-day-panel" aria-label={title}>
    <div className="task-day-heading">
      <h2 tabIndex={-1} ref={heading}>{title}</h2>
      <a href="#tasks" className="task-all-link">Все задачи<ArrowRight size={16} aria-hidden="true" /></a>
    </div>
    {loading && <p className="task-day-feedback" role="status">Загружаем задачи…</p>}
    {error && <div className="task-day-feedback" role="alert">
      <p>Не удалось загрузить задачи. Проверьте доступ к хранилищу браузера.</p>
      <Button variant="outline" onClick={retry}>Повторить загрузку задач</Button>
    </div>}
    {!loading && !error && <>
      {displayed.length > 0 ? <>
        <p className="task-day-count">{mode === 'today' ? `Задач на сегодня: ${displayed.length}`
          : `Всего: ${displayed.length} · Выполнено: ${displayed.filter((task) => task.status === 'completed').length}`}</p>
        <ul className="task-list">
          {displayed.map((task) => <li key={task.id}><TaskCard
            task={task} today={today} compact
            onToggle={mode === 'today' ? (item) => { void complete(item) } : undefined}
            pending={pendingIds.has(task.id)} error={errors[task.id]}
          /></li>)}
        </ul>
      </> : <p className="task-day-feedback">{mode === 'today' ? 'На сегодня задач нет.' : 'На эту дату задач нет.'}</p>}
    </>}
  </section>
}
