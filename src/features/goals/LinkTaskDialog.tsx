import { useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { useDialog } from '@/components/ui/use-dialog'
import { useTasks } from '@/features/tasks/use-tasks'
import { goalService } from '@/services/goal-service'
import { taskStatusLabels } from '@/services/task-service'

interface LinkTaskDialogProps {
  goalId: string
  onClose: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function LinkTaskDialog({ goalId, onClose, fallbackFocus }: LinkTaskDialogProps) {
  const id = useId()
  const { dialogRef, close, closeAfterChange } = useDialog(onClose, fallbackFocus)
  const { tasks, loading, error: readError, retry } = useTasks()
  const selectRef = useRef<HTMLSelectElement>(null)
  const pendingRef = useRef(false)
  const [taskId, setTaskId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const available = tasks.filter((task) => !task.goalId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pendingRef.current) return
    if (!taskId || !available.some((task) => task.id === taskId)) {
      setError('Выберите доступную задачу.')
      selectRef.current?.focus()
      return
    }
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      await goalService.linkTask(goalId, taskId)
      closeAfterChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось привязать задачу. Попробуйте ещё раз.')
      pendingRef.current = false
      setPending(false)
      requestAnimationFrame(() => selectRef.current?.focus())
    }
  }

  return (
    <dialog ref={dialogRef} className="task-dialog goal-dialog" aria-labelledby={`${id}-heading`} onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) close() }}>
      <form noValidate onSubmit={(event) => { void submit(event) }}>
        <header className="task-dialog-heading"><h2 id={`${id}-heading`}>Привязать задачу</h2><p>Выберите существующую задачу. Одна задача может относиться к одной цели.</p></header>
        <div className="task-form-fields">
          {loading && <p role="status">Загружаем задачи…</p>}
          {readError && <div role="alert"><p className="task-error">Не удалось загрузить задачи.</p><Button variant="outline" onClick={retry}>Повторить загрузку задач</Button></div>}
          {!loading && !readError && (available.length ? <div className="task-field"><label htmlFor={`${id}-task`}>Задача</label><select ref={selectRef} id={`${id}-task`} value={taskId} disabled={pending} onChange={(event) => { setTaskId(event.target.value); setError('') }}><option value="">Выберите задачу</option>{available.map((task) => <option key={task.id} value={task.id}>{task.title} · {task.date}{task.status !== 'active' ? ` · ${taskStatusLabels[task.status].toLowerCase()}` : ''}</option>)}</select></div> : <p className="goal-hint">Свободных задач нет. Создайте задачу в разделе «Задачи» или отвяжите её от другой цели.</p>)}
          {error && <p className="task-error" role="alert">{error}</p>}
        </div>
        <footer className="task-dialog-footer"><Button variant="outline" disabled={pending} onClick={close}>Отмена</Button><Button type="submit" disabled={pending || loading || readError || available.length === 0}>Привязать</Button></footer>
      </form>
    </dialog>
  )
}
