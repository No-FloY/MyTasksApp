import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDialog } from '@/components/ui/use-dialog'
import type { BackupSnapshot } from '@/models/backup'
import { importBackup } from '@/services/backup-service'

interface RestoreBackupDialogProps {
  snapshot: BackupSnapshot
  filename: string
  onClose: () => void
  onRestored: () => void
  onBusyChange: (busy: boolean) => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function RestoreBackupDialog({ snapshot, filename, onClose, onRestored, onBusyChange, fallbackFocus }: RestoreBackupDialogProps) {
  const id = useId()
  const { dialogRef, close, closeAfterChange } = useDialog(onClose, fallbackFocus)
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const confirmRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (error && !pending) confirmRef.current?.focus()
  }, [error, pending])

  async function restore() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError('')
    onBusyChange(true)
    try {
      await importBackup(snapshot)
      onRestored()
      closeAfterChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось восстановить данные. Текущие данные сохранены. Попробуйте ещё раз.')
      pendingRef.current = false
      setPending(false)
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="task-dialog task-confirm-dialog settings-dialog" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) close() }}>
      <header className="task-dialog-heading">
        <h2 id={`${id}-heading`}>Заменить текущие данные?</h2>
        <p id={`${id}-description`}>Все текущие локальные данные будут заменены данными из файла «{filename}». Изменения, сделанные после создания этой копии, будут потеряны. Отменить замену можно только восстановлением другой резервной копии.</p>
        {pending && <p role="status">Восстанавливаем данные… Дождитесь завершения.</p>}
        {error && <p className="task-error" role="alert">{error}</p>}
      </header>
      <footer className="task-dialog-footer">
        <Button variant="outline" disabled={pending} onClick={close}>Отмена</Button>
        <Button ref={confirmRef} variant="destructive" disabled={pending} onClick={() => { void restore() }}>{pending && <LoaderCircle className="spin" aria-hidden="true" />}Заменить данные</Button>
      </footer>
    </dialog>
  )
}
