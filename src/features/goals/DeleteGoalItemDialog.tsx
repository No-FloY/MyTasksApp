import { useId, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { useDialog } from '@/components/ui/use-dialog'

interface DeleteGoalItemDialogProps {
  kind: 'goal' | 'milestone'
  title: string
  remove: () => Promise<unknown>
  onDeleted?: () => void
  onClose: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function DeleteGoalItemDialog({ kind, title, remove, onDeleted, onClose, fallbackFocus }: DeleteGoalItemDialogProps) {
  const id = useId()
  const { dialogRef, close, closeAfterChange } = useDialog(onClose, fallbackFocus)
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const label = kind === 'goal' ? 'Удалить цель' : 'Удалить этап'

  async function confirm() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      await remove()
      onDeleted?.()
      closeAfterChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить. Попробуйте ещё раз.')
      pendingRef.current = false
      setPending(false)
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus())
    }
  }

  return (
    <dialog ref={dialogRef} className="task-dialog task-confirm-dialog" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) close() }}>
      <header className="task-dialog-heading"><h2 id={`${id}-heading`}>{label}?</h2><p id={`${id}-description`}>«{title}» {kind === 'goal' ? 'будет удалена вместе с этапами. Связанные задачи останутся в разделе «Задачи».' : 'будет удалён. Прогресс цели пересчитается.'} Это действие нельзя отменить.</p>{error && <p className="task-error" role="alert">{error}</p>}</header>
      <footer className="task-dialog-footer"><Button variant="outline" disabled={pending} onClick={close}>Отмена</Button><Button variant="destructive" disabled={pending} onClick={() => { void confirm() }}>{label}</Button></footer>
    </dialog>
  )
}
