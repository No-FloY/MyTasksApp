import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDialog } from '@/components/ui/use-dialog'
import { applyUpdate } from '@/pwa/client'
import './pwa.css'

interface PwaUpdateDialogProps {
  onClose: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function PwaUpdateDialog({ onClose, fallbackFocus }: PwaUpdateDialogProps) {
  const id = useId()
  const { dialogRef, close } = useDialog(onClose, fallbackFocus)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useLayoutEffect(() => {
    if (error && !pending) confirmRef.current?.focus()
  }, [error, pending])

  async function update() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      await applyUpdate()
      // The client reloads only after the new version is ready.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось обновить приложение. Попробуйте ещё раз.')
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="pwa-update-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) close() }}>
      <div className="pwa-dialog-copy">
        <h2 id={`${id}-title`}>Обновить приложение?</h2>
        <p id={`${id}-description`}>Сначала сохраните изменения в открытых формах. Приложение перезапустится; несохранённый ввод может потеряться. Уже сохранённые записи останутся.</p>
        {pending && <p role="status">Подготавливаем новую версию…</p>}
        {error && <p className="pwa-error" role="alert">{error}</p>}
      </div>
      <footer className="pwa-dialog-actions">
        <Button variant="outline" disabled={pending} onClick={close}>Отмена</Button>
        <Button ref={confirmRef} disabled={pending} onClick={() => { void update() }}>
          {pending && <LoaderCircle className="spin" aria-hidden="true" />}Обновить сейчас
        </Button>
      </footer>
    </dialog>
  )
}
