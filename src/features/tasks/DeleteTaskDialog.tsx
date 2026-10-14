import { useId, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import type { Task } from '@/models/task'
import { deleteTask } from '@/services/task-service'
import { useTaskDialog } from './use-task-dialog'

interface DeleteTaskDialogProps {
  task: Task
  onClose: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function DeleteTaskDialog({ task, onClose, fallbackFocus }: DeleteTaskDialogProps) {
  const id = useId()
  const { dialogRef, close, closeAfterChange } = useTaskDialog(onClose, fallbackFocus)
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function remove() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      await deleteTask(task.id)
      closeAfterChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить задачу. Попробуйте ещё раз.')
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="task-dialog task-confirm-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) close() }}>
      <header className="task-dialog-heading">
        <h2 id={`${id}-title`}>Удалить задачу?</h2>
        <p id={`${id}-description`}>«{task.title}» будет удалена. Это действие нельзя отменить.</p>
        {error && <p className="task-error" role="alert">{error}</p>}
      </header>
      <footer className="task-dialog-footer">
        <Button variant="outline" disabled={pending} onClick={close}>Отмена</Button>
        <Button variant="destructive" disabled={pending} onClick={() => { void remove() }}>Удалить задачу</Button>
      </footer>
    </dialog>
  )
}
