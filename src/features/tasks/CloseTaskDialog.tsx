import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import type { Task } from '@/models/task'
import { cancelTask, failTask } from '@/services/task-service'
import { useTaskDialog } from './use-task-dialog'

interface CloseTaskDialogProps {
  task: Task
  status: 'failed' | 'cancelled'
  onClose: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function CloseTaskDialog({ task, status, onClose, fallbackFocus }: CloseTaskDialogProps) {
  const id = useId()
  const { dialogRef, close, closeAfterChange } = useTaskDialog(onClose, fallbackFocus)
  const pendingRef = useRef(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const failed = status === 'failed'

  useLayoutEffect(() => {
    // Focus only after React has re-enabled the button in the committed DOM.
    if (error && !pending) confirmRef.current?.focus()
  }, [error, pending])

  async function confirm() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      if (failed) await failTask(task.id)
      else await cancelTask(task.id)
      closeAfterChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось закрыть задачу. Попробуйте ещё раз.')
      pendingRef.current = false
      setPending(false)
    }
  }

  return <dialog ref={dialogRef} className="task-dialog task-confirm-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) close() }}>
    <header className="task-dialog-heading">
      <h2 id={`${id}-title`}>{failed ? 'Отметить задачу как не выполненную?' : 'Отменить задачу?'}</h2>
      <p id={`${id}-description`}>«{task.title}» будет {failed ? 'закрыта как не выполненная' : 'отменена'}. Это конечное состояние: вернуть задачу в активные нельзя. {failed ? 'Результат войдёт в отклонения статистики.' : 'Задача не будет участвовать в показателях выполнения вовремя и отклонений.'}</p>
      {error && <p className="task-error" role="alert">{error}</p>}
    </header>
    <footer className="task-dialog-footer">
      <Button variant="outline" disabled={pending} onClick={close}>Оставить задачу</Button>
      <Button ref={confirmRef} variant="destructive" disabled={pending} onClick={() => { void confirm() }}>{failed ? 'Отметить как не выполненную' : 'Отменить задачу'}</Button>
    </footer>
  </dialog>
}
