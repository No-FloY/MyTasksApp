import { useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LocalDate } from '@/lib/local-date'
import type { Task, TaskInput, TaskPriority } from '@/models/task'
import {
  createTask, getTaskValidationErrors, MAX_TASK_DESCRIPTION_LENGTH, MAX_TASK_TITLE_LENGTH, updateTask,
} from '@/services/task-service'
import { useTaskDialog } from './use-task-dialog'

interface TaskFormDialogProps {
  task?: Task | undefined
  today: LocalDate
  onClose: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function TaskFormDialog({ task, today, onClose, fallbackFocus }: TaskFormDialogProps) {
  const id = useId()
  const { dialogRef, close, closeAfterChange } = useTaskDialog(onClose, fallbackFocus)
  const formRef = useRef<HTMLFormElement>(null)
  const savingRef = useRef(false)
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [date, setDate] = useState<string>(task?.date ?? today)
  const [time, setTime] = useState(task?.time ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [errors, setErrors] = useState<Partial<Record<keyof TaskInput, string>>>({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  function clearError(field: keyof TaskInput) {
    setErrors((current) => ({ ...current, [field]: undefined }))
    setSaveError('')
  }

  function fieldProps(field: keyof TaskInput) {
    return { id: `${id}-${field}`, name: field, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined }
  }

  function fieldError(field: keyof TaskInput) {
    return errors[field] ? <p className="task-field-error" id={`${id}-${field}-error`} role="alert">{errors[field]}</p> : null
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current) return
    const input: TaskInput = { title, description, date, time: time || null, priority }
    const validationErrors = getTaskValidationErrors(input)
    const timeField = formRef.current?.elements.namedItem('time')
    // A partially filled native time control has an empty value, just like an
    // intentionally omitted time. Preserve that distinction before saving.
    if (timeField instanceof HTMLInputElement && timeField.validity.badInput) {
      validationErrors.time = 'Введите время полностью или очистите поле.'
    }
    setErrors(validationErrors)
    const invalidField = (['title', 'description', 'date', 'time', 'priority'] as const).find((field) => validationErrors[field])
    if (invalidField) {
      const field = formRef.current?.elements.namedItem(invalidField)
      if (field instanceof HTMLElement) field.focus()
      return
    }
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    try {
      if (task) await updateTask(task.id, input)
      else await createTask(input)
      closeAfterChange()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Не удалось сохранить задачу. Попробуйте ещё раз.')
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="task-dialog" aria-labelledby={`${id}-title`} onCancel={(event) => { event.preventDefault(); if (!savingRef.current) close() }}>
      <form ref={formRef} noValidate onSubmit={(event) => { void submit(event) }}>
        <header className="task-dialog-heading">
          <h2 id={`${id}-title`}>{task ? 'Редактировать задачу' : 'Новая задача'}</h2>
          <p>Планируйте на любой день. Время и описание необязательны.</p>
        </header>
        <div className="task-form-fields">
          <div className="task-field">
            <label htmlFor={`${id}-title-field`}>Название</label>
            <input {...fieldProps('title')} id={`${id}-title-field`} value={title} maxLength={MAX_TASK_TITLE_LENGTH} required disabled={saving} onChange={(event) => { setTitle(event.target.value); clearError('title') }} />
            {fieldError('title')}
          </div>
          <div className="task-field">
            <label htmlFor={`${id}-description`}>Описание <span>необязательно</span></label>
            <textarea {...fieldProps('description')} value={description} rows={4} maxLength={MAX_TASK_DESCRIPTION_LENGTH} disabled={saving} onChange={(event) => { setDescription(event.target.value); clearError('description') }} />
            {fieldError('description')}
          </div>
          <div className="task-date-time-fields">
            <div className="task-field">
              <label htmlFor={`${id}-date`}>Дата</label>
              <input {...fieldProps('date')} type="date" value={date} required disabled={saving} onChange={(event) => { setDate(event.target.value); clearError('date') }} />
              {fieldError('date')}
            </div>
            <div className="task-field">
              <label htmlFor={`${id}-time`}>Время <span>необязательно</span></label>
              <input {...fieldProps('time')} type="time" step={60} value={time} disabled={saving} onChange={(event) => { setTime(event.target.value); clearError('time') }} />
              {fieldError('time')}
            </div>
          </div>
          <div className="task-field">
            <label htmlFor={`${id}-priority`}>Приоритет</label>
            <select {...fieldProps('priority')} value={priority} disabled={saving} onChange={(event) => { setPriority(event.target.value as TaskPriority); clearError('priority') }}>
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
            </select>
            {fieldError('priority')}
          </div>
          {saveError && <p className="task-error" role="alert">{saveError}</p>}
        </div>
        <footer className="task-dialog-footer">
          <Button variant="outline" disabled={saving} onClick={close}>Отмена</Button>
          <Button type="submit" disabled={saving}>{saving && <LoaderCircle className="spin" aria-hidden="true" />}Сохранить задачу</Button>
        </footer>
      </form>
    </dialog>
  )
}
