import { useLayoutEffect, useRef, useState } from 'react'
import { AlertCircle, Archive, ArchiveRestore, LoaderCircle, Pencil, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PwaSettings } from '@/components/pwa/PwaSettings'
import type { Habit } from '@/models/habit'
import { setHabitArchived } from '@/services/habit-settings-service'
import { BackupSettings } from './BackupSettings'
import { HabitSettingsDialog } from './HabitSettingsDialog'
import { useSettingsHabits } from './use-settings-habits'
import '@/features/tasks/tasks.css'
import './settings.css'

const typeLabels = {
  boolean: 'Отметка дня',
  amount: 'Количество',
  duration: 'Время',
  rating: 'Оценка',
}

export default function SettingsPage() {
  const { habits, loading, error, retry } = useSettingsHabits()
  const focusRef = useRef<HTMLButtonElement>(null)
  const archiveFocusRef = useRef<HTMLButtonElement | null>(null)
  const pendingRef = useRef(false)
  const [editing, setEditing] = useState<Habit | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [message, setMessage] = useState('')
  const busy = pendingId !== null || backupBusy

  useLayoutEffect(() => {
    // Restore focus after the committed DOM has re-enabled the controls.
    const target = archiveFocusRef.current
    if (busy || !target) return
    archiveFocusRef.current = null
    if (target.isConnected && !target.disabled) target.focus()
    else focusRef.current?.focus()
  })

  async function changeArchive(habit: Habit, trigger: HTMLButtonElement) {
    if (pendingRef.current || backupBusy) return
    pendingRef.current = true
    setPendingId(habit.id)
    setActionError('')
    setMessage('')
    try {
      const archived = habit.archivedAt === null
      await setHabitArchived(habit.id, archived)
      setMessage(archived ? `«${habit.name}» в архиве. История сохранена.` : `«${habit.name}» восстановлена.`)
      archiveFocusRef.current = focusRef.current
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Не удалось изменить состояние привычки. Попробуйте ещё раз.')
      archiveFocusRef.current = trigger
    } finally {
      pendingRef.current = false
      setPendingId(null)
    }
  }

  return (
    <div className="settings-page">
      <header className="tasks-page-heading">
        <div><p className="eyebrow">ПРИЛОЖЕНИЕ ПОД ВАШ РИТМ</p><h1>Настройки<span className="heading-dot" aria-hidden="true">.</span></h1><p className="page-description">Ваши привычки, цели на день и сохранность данных.</p></div>
        <Button ref={focusRef} variant="outline" disabled={busy || loading} onClick={retry}><SlidersHorizontal aria-hidden="true" />Обновить список привычек</Button>
      </header>
      {loading && <p className="task-read-state" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" />Загружаем привычки…</p>}
      {error && <div className="task-read-state task-read-error" role="alert"><AlertCircle size={20} aria-hidden="true" /><p>Не удалось загрузить привычки. Проверьте доступ к локальному хранилищу.</p><Button variant="outline" onClick={retry}>Повторить загрузку привычек</Button></div>}
      {actionError && <p className="task-error" role="alert">{actionError}</p>}
      {message && <p className="settings-feedback" role="status">{message}</p>}
      {!loading && !error && <div className="settings-habit-groups">
        {[{ archived: false, heading: 'Активные привычки' }, { archived: true, heading: 'Архивированные привычки' }].map(({ archived, heading }) => {
          const items = habits.filter((habit) => (habit.archivedAt !== null) === archived)
          const sectionId = archived ? 'settings-archived-habits' : 'settings-active-habits'
          return <section className="settings-section" key={sectionId} aria-labelledby={sectionId}>
            <div className="task-group-heading"><h2 id={sectionId}>{heading}</h2><span>{items.length}</span></div>
            {archived && <p className="settings-hint">Архив скрывает привычку из «Сегодня». Её записи остаются в календаре и статистике. Привычку можно восстановить в любой момент.</p>}
            {items.length === 0
              ? <p className="task-empty">{archived ? 'Архив пока пуст.' : 'Активных привычек нет. Вы можете восстановить привычку из архива.'}</p>
              : <ul className="settings-habit-list">{items.map((habit) => <li key={habit.id}>
                <article className="settings-habit-card" data-habit-id={habit.id} aria-labelledby={`settings-habit-${habit.id}-title`}>
                  <div className="settings-habit-heading">
                    <h3 id={`settings-habit-${habit.id}-title`}>{habit.name}</h3>
                    <span className={`settings-habit-status${archived ? ' is-archived' : ''}`}>{archived ? 'В архиве' : 'Активна'}</span>
                  </div>
                  <p className="settings-habit-type">Тип: {typeLabels[habit.type]}</p>
                  {habit.description && <p className="settings-habit-description">{habit.description}</p>}
                  {habit.type === 'amount' && <p className="settings-habit-target">Дневная цель: <strong>{habit.target.toLocaleString('ru-RU')} {habit.unit}</strong></p>}
                  {habit.type === 'duration' && <>
                    <p className="settings-habit-type">Единица: минуты</p>
                    <ul className="settings-rating-summary" aria-label="Текущие диапазоны оценок">
                      {habit.ratingRanges.map((range) => <li key={range.id}><span>{range.emoji} {range.label}</span><span>{range.maxMinutes === null ? `от ${range.minMinutes}` : `${range.minMinutes}–${range.maxMinutes}`} мин</span></li>)}
                    </ul>
                  </>}
                  <div className="settings-habit-actions">
                    <Button variant="outline" disabled={busy} aria-label={`Редактировать ${habit.name}`} onClick={() => { setEditing(habit); setMessage(''); setActionError('') }}><Pencil aria-hidden="true" />Редактировать</Button>
                    <Button variant="ghost" disabled={busy} aria-label={`${archived ? 'Восстановить' : 'Архивировать'} ${habit.name}`} onClick={(event) => { void changeArchive(habit, event.currentTarget) }}>
                      {pendingId === habit.id ? <LoaderCircle className="spin" aria-hidden="true" /> : archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                      {archived ? 'Восстановить' : 'В архив'}
                    </Button>
                  </div>
                </article>
              </li>)}</ul>}
          </section>
        })}
      </div>}
      <BackupSettings disabled={busy || loading || error} onBusyChange={setBackupBusy} />
      <PwaSettings />
      {editing && <HabitSettingsDialog habit={editing} onClose={() => setEditing(null)} onSaved={() => setMessage('Настройки привычки сохранены.')} fallbackFocus={focusRef} />}
    </div>
  )
}
