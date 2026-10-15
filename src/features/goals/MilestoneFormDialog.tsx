import { useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { useDialog } from '@/components/ui/use-dialog'
import type { GoalMilestone, MilestoneInput } from '@/models/goal'
import { getMilestoneValidationErrors, goalService, MAX_MILESTONE_TITLE_LENGTH, type MilestoneValidationErrors } from '@/services/goal-service'

interface MilestoneFormDialogProps {
  goalId: string
  milestone?: GoalMilestone | undefined
  onClose: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

export function MilestoneFormDialog({ goalId, milestone, onClose, fallbackFocus }: MilestoneFormDialogProps) {
  const id = useId()
  const { dialogRef, close, closeAfterChange } = useDialog(onClose, fallbackFocus)
  const formRef = useRef<HTMLFormElement>(null)
  const pendingRef = useRef(false)
  const [title, setTitle] = useState(milestone?.title ?? '')
  const [type, setType] = useState<'boolean' | 'amount'>(milestone?.type ?? 'boolean')
  const [current, setCurrent] = useState(String(milestone?.type === 'amount' ? milestone.current : 0))
  const [target, setTarget] = useState(String(milestone?.type === 'amount' ? milestone.target : 1))
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<MilestoneValidationErrors>({})
  const [pending, setPending] = useState(false)

  function clearError(field: keyof MilestoneValidationErrors) {
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }))
    setError('')
  }

  function fieldProps(field: keyof MilestoneValidationErrors) {
    return { id: `${id}-${field}`, name: field, 'aria-invalid': Boolean(fieldErrors[field]), 'aria-describedby': fieldErrors[field] ? `${id}-${field}-error` : undefined }
  }

  function fieldError(field: keyof MilestoneValidationErrors) {
    return fieldErrors[field] ? <p className="task-field-error" id={`${id}-${field}-error`} role="alert">{fieldErrors[field]}</p> : null
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pendingRef.current) return
    const input: MilestoneInput = type === 'boolean'
      ? { type, title, completed: milestone?.type === 'boolean' ? milestone.completed : false }
      : { type, title, current: Number(current), target: Number(target) }
    const validation = getMilestoneValidationErrors(input)
    if (type === 'amount') {
      for (const field of ['current', 'target'] as const) {
        const element = formRef.current?.elements.namedItem(field)
        const draft = field === 'current' ? current : target
        if (draft.trim() === '' || element instanceof HTMLInputElement && element.validity.badInput) {
          validation[field] = field === 'current' ? 'Введите текущее значение, включая явный ноль.' : 'Введите целевое значение больше нуля.'
        }
      }
    }
    setFieldErrors(validation)
    const invalidField = Object.keys(validation)[0]
    if (invalidField) {
      const field = formRef.current?.elements.namedItem(invalidField)
      if (field instanceof HTMLElement) field.focus()
      return
    }
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      if (milestone) await goalService.updateMilestone(milestone.id, input)
      else await goalService.addMilestone(goalId, input)
      closeAfterChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить этап. Попробуйте ещё раз.')
      pendingRef.current = false
      setPending(false)
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus())
    }
  }

  return (
    <dialog ref={dialogRef} className="task-dialog goal-dialog" aria-labelledby={`${id}-heading`} onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) close() }}>
      <form ref={formRef} noValidate onSubmit={(event) => { void submit(event) }}>
        <header className="task-dialog-heading"><h2 id={`${id}-heading`}>{milestone ? 'Редактировать этап' : 'Новый этап'}</h2><p>Отметка результата или количество — выбирайте подходящий способ.</p></header>
        <div className="task-form-fields">
          <div className="task-field"><label htmlFor={`${id}-title`}>Название этапа</label><input {...fieldProps('title')} maxLength={MAX_MILESTONE_TITLE_LENGTH} value={title} required disabled={pending} onChange={(event) => { setTitle(event.target.value); clearError('title') }} />{fieldError('title')}</div>
          <div className="task-field"><label htmlFor={`${id}-type`}>Тип этапа</label><select {...fieldProps('type')} value={type} disabled={pending || Boolean(milestone)} onChange={(event) => { setType(event.target.value as 'boolean' | 'amount'); clearError('type') }}><option value="boolean">Отметка выполнения</option><option value="amount">Числовой</option></select>{fieldError('type')}{milestone && <p className="goal-hint">Тип созданного этапа сохраняется.</p>}</div>
          {type === 'amount' && <div className="task-date-time-fields">
            <div className="task-field"><label htmlFor={`${id}-current`}>Текущее значение</label><input {...fieldProps('current')} type="number" inputMode="decimal" min={0} step="any" value={current} disabled={pending} onChange={(event) => { setCurrent(event.target.value); clearError('current') }} />{fieldError('current')}</div>
            <div className="task-field"><label htmlFor={`${id}-target`}>Целевое значение</label><input {...fieldProps('target')} type="number" inputMode="decimal" min={0} step="any" value={target} disabled={pending} onChange={(event) => { setTarget(event.target.value); clearError('target') }} />{fieldError('target')}</div>
          </div>}
          {error && <p className="task-error" role="alert">{error}</p>}
        </div>
        <footer className="task-dialog-footer"><Button variant="outline" disabled={pending} onClick={close}>Отмена</Button><Button type="submit" disabled={pending}>Сохранить этап</Button></footer>
      </form>
    </dialog>
  )
}
