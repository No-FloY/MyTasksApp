import { useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDialog } from '@/components/ui/use-dialog'
import type { Goal, GoalInput, GoalProgressMode } from '@/models/goal'
import { getGoalValidationErrors, goalService, MAX_GOAL_DESCRIPTION_LENGTH, MAX_GOAL_TITLE_LENGTH } from '@/services/goal-service'

interface GoalFormDialogProps {
  goal?: Goal | undefined
  onClose: () => void
  onCreated: (goal: Goal) => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function GoalFormDialog({ goal, onClose, onCreated, fallbackFocus }: GoalFormDialogProps) {
  const id = useId()
  const { dialogRef, close, closeAfterChange } = useDialog(onClose, fallbackFocus)
  const formRef = useRef<HTMLFormElement>(null)
  const savingRef = useRef(false)
  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [deadline, setDeadline] = useState<string>(goal?.deadline ?? '')
  const [progressMode, setProgressMode] = useState<GoalProgressMode>(goal?.progressMode ?? 'auto')
  const [manualProgress, setManualProgress] = useState(String(goal?.manualProgress ?? 0))
  const [errors, setErrors] = useState<Partial<Record<keyof GoalInput, string>>>({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  function clearError(field: keyof GoalInput) {
    setErrors((current) => ({ ...current, [field]: undefined }))
    setSaveError('')
  }

  function fieldProps(field: keyof GoalInput) {
    return { id: `${id}-${field}`, name: field, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined }
  }

  function fieldError(field: keyof GoalInput) {
    return errors[field] ? <p className="task-field-error" id={`${id}-${field}-error`} role="alert">{errors[field]}</p> : null
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current) return
    // A hidden invalid manual draft must not block saving an automatic goal.
    const input: GoalInput = {
      title, description, deadline: deadline || null, progressMode,
      manualProgress: progressMode === 'manual' ? Number(manualProgress) : goal?.manualProgress ?? 0,
    }
    const validation = getGoalValidationErrors(input)
    const dateInput = formRef.current?.elements.namedItem('deadline')
    if (dateInput instanceof HTMLInputElement && dateInput.validity.badInput) validation.deadline = 'Введите дату полностью или очистите поле.'
    const progressInput = formRef.current?.elements.namedItem('manualProgress')
    if (progressMode === 'manual' && (manualProgress.trim() === '' || progressInput instanceof HTMLInputElement && progressInput.validity.badInput)) {
      validation.manualProgress = 'Введите прогресс от 0 до 100%.'
    }
    setErrors(validation)
    const invalidField = Object.keys(validation)[0]
    if (invalidField) {
      const field = formRef.current?.elements.namedItem(invalidField)
      if (field instanceof HTMLElement) field.focus()
      return
    }
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    try {
      if (goal) await goalService.updateGoal(goal.id, input)
      else {
        const created = await goalService.createGoal(input)
        onCreated(created)
      }
      closeAfterChange()
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Не удалось сохранить цель. Попробуйте ещё раз.')
      savingRef.current = false
      setSaving(false)
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus())
    }
  }

  return (
    <dialog ref={dialogRef} className="task-dialog goal-dialog" aria-labelledby={`${id}-heading`} onCancel={(event) => { event.preventDefault(); if (!savingRef.current) close() }}>
      <form ref={formRef} noValidate onSubmit={(event) => { void submit(event) }}>
        <header className="task-dialog-heading"><h2 id={`${id}-heading`}>{goal ? 'Редактировать цель' : 'Новая цель'}</h2><p>Большой результат начинается с небольших шагов.</p></header>
        <div className="task-form-fields">
          <div className="task-field"><label htmlFor={`${id}-title`}>Название</label><input {...fieldProps('title')} value={title} maxLength={MAX_GOAL_TITLE_LENGTH} required disabled={saving} onChange={(event) => { setTitle(event.target.value); clearError('title') }} />{fieldError('title')}</div>
          <div className="task-field"><label htmlFor={`${id}-description`}>Описание <span>необязательно</span></label><textarea {...fieldProps('description')} value={description} rows={3} maxLength={MAX_GOAL_DESCRIPTION_LENGTH} disabled={saving} onChange={(event) => { setDescription(event.target.value); clearError('description') }} />{fieldError('description')}</div>
          <div className="task-field"><label htmlFor={`${id}-deadline`}>Дедлайн <span>необязательно</span></label><input {...fieldProps('deadline')} type="date" value={deadline} disabled={saving} onChange={(event) => { setDeadline(event.target.value); clearError('deadline') }} />{fieldError('deadline')}</div>
          <div className="task-field"><label htmlFor={`${id}-progressMode`}>Режим прогресса</label><select {...fieldProps('progressMode')} value={progressMode} disabled={saving} onChange={(event) => { setProgressMode(event.target.value as GoalProgressMode); clearError('progressMode') }}><option value="auto">Автоматически по этапам</option><option value="manual">Вручную</option></select></div>
          {progressMode === 'manual' ? <div className="task-field"><label htmlFor={`${id}-manualProgress`}>Ручной прогресс, %</label><input {...fieldProps('manualProgress')} type="number" inputMode="decimal" min={0} max={100} step="any" value={manualProgress} disabled={saving} onChange={(event) => { setManualProgress(event.target.value); clearError('manualProgress') }} />{fieldError('manualProgress')}</div> : <p className="goal-hint">Все этапы имеют одинаковый вес. Без этапов прогресс равен 0%.</p>}
          {saveError && <p className="task-error" role="alert">{saveError}</p>}
        </div>
        <footer className="task-dialog-footer"><Button variant="outline" disabled={saving} onClick={close}>Отмена</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="spin" aria-hidden="true" />}Сохранить цель</Button></footer>
      </form>
    </dialog>
  )
}
