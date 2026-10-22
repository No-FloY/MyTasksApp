import { useId, useRef, useState, type ChangeEvent } from 'react'
import { Download, FileJson, LoaderCircle, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BackupSnapshot } from '@/models/backup'
import { exportBackup, getBackupFilename, parseBackupJson } from '@/services/backup-service'
import { RestoreBackupDialog } from './RestoreBackupDialog'

const MAX_BACKUP_FILE_BYTES = 50 * 1024 * 1024

interface BackupSettingsProps {
  disabled: boolean
  onBusyChange: (busy: boolean) => void
}

export function BackupSettings({ disabled, onBusyChange }: BackupSettingsProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreButtonRef = useRef<HTMLButtonElement>(null)
  const pendingRef = useRef(false)
  const [reading, setReading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState<{ filename: string; snapshot: BackupSnapshot } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function download() {
    if (pendingRef.current || disabled) return
    pendingRef.current = true
    setExporting(true)
    setError('')
    setMessage('')
    onBusyChange(true)
    try {
      const snapshot = await exportBackup()
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = getBackupFilename()
      link.hidden = true
      document.body.append(link)
      try {
        link.click()
      } finally {
        link.remove()
        // Safari needs the blob URL to remain valid while handing the file to Downloads.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
      setMessage('Резервная копия подготовлена. Сохраните скачанный файл в надёжном месте.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось скачать резервную копию. Попробуйте ещё раз.')
    } finally {
      pendingRef.current = false
      setExporting(false)
      onBusyChange(false)
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || pendingRef.current || disabled) return
    pendingRef.current = true
    setReading(true)
    setPreview(null)
    setError('')
    setMessage('')
    onBusyChange(true)
    try {
      if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error('Файл слишком большой. Выберите резервную копию размером до 50 МБ.')
      const snapshot = parseBackupJson(await file.text())
      setPreview({ filename: file.name, snapshot })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось прочитать файл. Выберите корректную резервную копию.')
    } finally {
      pendingRef.current = false
      setReading(false)
      onBusyChange(false)
    }
  }

  const busy = disabled || reading || exporting
  return (
    <section className="settings-backup settings-section" aria-labelledby={`${id}-heading`}>
      <div className="settings-section-heading">
        <div className="settings-section-icon"><FileJson aria-hidden="true" /></div>
        <div><h2 id={`${id}-heading`}>Резервная копия</h2><p>Сохраните привычки и их историю, задачи, цели и этапы в один файл.</p></div>
      </div>
      <p className="settings-hint">Данные хранятся в этом браузере. Скачанная копия поможет восстановить их или перенести на другое устройство.</p>
      <div className="settings-backup-actions">
        <Button disabled={busy} onClick={() => { void download() }}>{exporting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}Скачать резервную копию</Button>
        <Button ref={restoreButtonRef} variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>{reading ? <LoaderCircle className="spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}Восстановить из файла</Button>
        <input ref={inputRef} type="file" hidden accept=".json,application/json" aria-label="Файл резервной копии" disabled={busy} onChange={(event) => { void chooseFile(event) }} />
      </div>
      {reading && <p className="settings-feedback" role="status">Проверяем резервную копию…</p>}
      {message && <p className="settings-feedback" role="status">{message}</p>}
      {error && <p className="task-error" role="alert">{error}</p>}
      {preview && <div className="settings-backup-preview" role="region" aria-label="Предпросмотр резервной копии">
        <h3>Копия готова к восстановлению</h3>
        <p className="settings-backup-filename">{preview.filename}</p>
        <p className="settings-hint">Создана <time dateTime={preview.snapshot.exportedAt}>{new Date(preview.snapshot.exportedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></p>
        <dl className="settings-backup-counts">
          <div><dt>Привычек</dt><dd>{preview.snapshot.data.habits.length}</dd></div>
          <div><dt>Записей привычек</dt><dd>{preview.snapshot.data.habitEntries.length}</dd></div>
          <div><dt>Задач</dt><dd>{preview.snapshot.data.tasks.length}</dd></div>
          <div><dt>Целей</dt><dd>{preview.snapshot.data.goals.length}</dd></div>
          <div><dt>Этапов целей</dt><dd>{preview.snapshot.data.goalMilestones.length}</dd></div>
        </dl>
        <p className="settings-notice">При восстановлении текущие локальные данные будут полностью заменены. Сначала можно скачать копию текущих данных.</p>
        <div className="settings-backup-actions">
          <Button variant="outline" disabled={busy} onClick={() => { void download() }}><Download aria-hidden="true" />Скачать текущую копию</Button>
          <Button disabled={busy} onClick={() => setConfirming(true)}>Продолжить импорт</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { setPreview(null); setError(''); restoreButtonRef.current?.focus() }}>Отменить импорт</Button>
        </div>
      </div>}
      {confirming && preview && <RestoreBackupDialog
        snapshot={preview.snapshot}
        filename={preview.filename}
        onClose={() => setConfirming(false)}
        onRestored={() => { setPreview(null); setError(''); setMessage('Данные успешно восстановлены.') }}
        onBusyChange={onBusyChange}
        fallbackFocus={restoreButtonRef}
      />}
    </section>
  )
}
