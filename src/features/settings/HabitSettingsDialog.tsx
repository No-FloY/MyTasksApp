import { useId, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDialog } from '@/components/ui/use-dialog'
import type { Habit } from '@/models/habit'
import type { DurationRatingRange } from '@/models/duration-rating'
import { validateRatingRanges } from '@/services/duration-service'
import {
  MAX_HABIT_DESCRIPTION_LENGTH,
  MAX_HABIT_NAME_LENGTH,
  MAX_RATING_EMOJI_LENGTH,
  MAX_RATING_LABEL_LENGTH,
  updateHabitSettings,
} from '@/services/habit-settings-service'

interface HabitSettingsDialogProps {
  habit: Habit
  onClose: () => void
  onSaved: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}

interface RangeDraft {
  id: string
  label: string
  emoji: string
  minMinutes: string
  maxMinutes: string | null
}

type FieldErrors = Partial<Record<'name' | 'description' | 'target' | 'ranges', string>>

export function HabitSettingsDialog({ habit, onClose, onSaved, fallbackFocus }: HabitSettingsDialogProps) {
  const id = useId()
  const { dialogRef, close, closeAfterChange } = useDialog(onClose, fallbackFocus)
  const formRef = useRef<HTMLFormElement>(null)
  const savingRef = useRef(false)
  const [name, setName] = useState(habit.name)
  const [description, setDescription] = useState(habit.description)
  const [target, setTarget] = useState(habit.type === 'amount' ? String(habit.target) : '')
  const [ranges, setRanges] = useState<RangeDraft[]>(habit.type === 'duration'
    ? habit.ratingRanges.map((range) => ({
      ...range,
      minMinutes: String(range.minMinutes),
      maxMinutes: range.maxMinutes === null ? null : String(range.maxMinutes),
    })) : [])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  useLayoutEffect(() => {
    if (saveError && !saving) formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus()
  }, [saveError, saving])

  function clearError(field: keyof FieldErrors) {
    setErrors((current) => ({ ...current, [field]: undefined }))
    setSaveError('')
  }

  function fieldProps(field: keyof FieldErrors) {
    return {
      id: `${id}-${field}`,
      name: field,
      'aria-invalid': Boolean(errors[field]),
      'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined,
    }
  }

  function fieldError(field: keyof FieldErrors) {
    return errors[field]
      ? <p className="task-field-error" id={`${id}-${field}-error`} role="alert">{errors[field]}</p>
      : null
  }

  function changeRange(index: number, field: keyof Omit<RangeDraft, 'id'>, value: string) {
    setRanges((current) => current.map((range, rangeIndex) => rangeIndex === index ? { ...range, [field]: value } : range))
    clearError('ranges')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current) return
    const validation: FieldErrors = {}
    if (!name.trim() || name.trim().length > MAX_HABIT_NAME_LENGTH) validation.name = `Введите название до ${MAX_HABIT_NAME_LENGTH} символов.`
    if (description.length > MAX_HABIT_DESCRIPTION_LENGTH) validation.description = `Описание должно быть не длиннее ${MAX_HABIT_DESCRIPTION_LENGTH} символов.`
    if (habit.type === 'amount' && (!/^\d+$/.test(target.trim()) || !Number.isSafeInteger(Number(target)) || Number(target) <= 0)) {
      validation.target = 'Введите положительное целое число.'
    }
    let ratingRanges: DurationRatingRange[] = []
    if (habit.type === 'duration') {
      try {
        ratingRanges = ranges.map((range) => {
          if (!/^\d+$/.test(range.minMinutes.trim())
            || range.maxMinutes !== null && !/^\d+$/.test(range.maxMinutes.trim())) {
            throw new Error('Укажите все границы целыми неотрицательными числами минут.')
          }
          const minMinutes = Number(range.minMinutes)
          const maxMinutes = range.maxMinutes === null ? null : Number(range.maxMinutes)
          if (!Number.isSafeInteger(minMinutes)
            || maxMinutes !== null && !Number.isSafeInteger(maxMinutes)) {
            throw new Error('Границы должны быть целыми числами минут, не слишком большими.')
          }
          if (!range.label.trim() || range.label.trim().length > MAX_RATING_LABEL_LENGTH) {
            throw new Error(`У каждой категории должно быть название до ${MAX_RATING_LABEL_LENGTH} символов.`)
          }
          if (!range.emoji.trim() || range.emoji.trim().length > MAX_RATING_EMOJI_LENGTH) {
            throw new Error('Добавьте эмодзи или короткий символ для каждой категории.')
          }
          return { id: range.id, label: range.label, emoji: range.emoji, minMinutes, maxMinutes }
        })
        validateRatingRanges(ratingRanges)
      } catch (cause) {
        validation.ranges = cause instanceof Error ? cause.message : 'Проверьте диапазоны оценок.'
      }
    }
    setErrors(validation)
    const invalidField = Object.keys(validation)[0]
    if (invalidField) {
      const field = invalidField === 'ranges'
        ? formRef.current?.querySelector<HTMLInputElement>('[data-range-field]')
        : formRef.current?.elements.namedItem(invalidField)
      if (field instanceof HTMLElement) field.focus()
      return
    }

    savingRef.current = true
    setSaving(true)
    setSaveError('')
    try {
      const base = { name, description }
      if (habit.type === 'amount') await updateHabitSettings(habit.id, { ...base, type: habit.type, target: Number(target) })
      else if (habit.type === 'duration') await updateHabitSettings(habit.id, { ...base, type: habit.type, ratingRanges })
      else await updateHabitSettings(habit.id, { ...base, type: habit.type })
      onSaved()
      closeAfterChange()
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Не удалось сохранить привычку. Попробуйте ещё раз.')
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="task-dialog settings-dialog" aria-labelledby={`${id}-heading`} onCancel={(event) => { event.preventDefault(); if (!savingRef.current) close() }}>
      <form ref={formRef} noValidate onSubmit={(event) => { void submit(event) }}>
        <header className="task-dialog-heading">
          <h2 id={`${id}-heading`}>Редактировать привычку</h2>
          <p>Изменения сохранятся для «{habit.name}».</p>
        </header>
        <div className="task-form-fields">
          <div className="task-field">
            <label htmlFor={`${id}-name`}>Название</label>
            <input {...fieldProps('name')} value={name} maxLength={MAX_HABIT_NAME_LENGTH} required disabled={saving} onChange={(event) => { setName(event.target.value); clearError('name') }} />
            {fieldError('name')}
          </div>
          <div className="task-field">
            <label htmlFor={`${id}-description`}>Описание <span>необязательно</span></label>
            <textarea {...fieldProps('description')} value={description} rows={3} maxLength={MAX_HABIT_DESCRIPTION_LENGTH} disabled={saving} onChange={(event) => { setDescription(event.target.value); clearError('description') }} />
            {fieldError('description')}
          </div>
          {habit.type === 'amount' && <>
            <div className="task-field">
              <label htmlFor={`${id}-target`}>Дневная цель, {habit.unit}</label>
              <input {...fieldProps('target')} type="text" inputMode="numeric" value={target} required disabled={saving} onChange={(event) => { setTarget(event.target.value); clearError('target') }} />
              {fieldError('target')}
            </div>
            <p className="settings-notice">Новая цель применяется ко всей истории: оценки достижения за прошлые дни могут измениться. Записанные количества остаются прежними.</p>
          </>}
          {habit.type === 'duration' && <section className="settings-range-editor" aria-labelledby={`${id}-ranges-heading`}>
            <h3 id={`${id}-ranges-heading`}>Диапазоны оценок</h3>
            <p className="settings-hint" id={`${id}-ranges-help`}>Границы включены. Начните с 0 минут. Следующий диапазон начинается на минуту позже предыдущего: например, 0–120, затем 121–240. Последний диапазон — без верхней границы.</p>
            <p className="settings-notice">Новые диапазоны применяются ко всей истории: категории прошлых дней могут измениться. Записанное время остаётся прежним.</p>
            {fieldError('ranges')}
            <div className="settings-range-list">
              {ranges.map((range, index) => {
                const rangeId = `${id}-range-${index}`
                const describedBy = `${id}-ranges-help${errors.ranges ? ` ${id}-ranges-error` : ''}`
                return <fieldset className="settings-range-fields" key={range.id} disabled={saving}>
                  <legend>Диапазон {index + 1}</legend>
                  <div className="task-field">
                    <label htmlFor={`${rangeId}-label`}>Название категории {index + 1}</label>
                    <input id={`${rangeId}-label`} data-range-field value={range.label} maxLength={MAX_RATING_LABEL_LENGTH} aria-invalid={Boolean(errors.ranges)} aria-describedby={describedBy} required onChange={(event) => changeRange(index, 'label', event.target.value)} />
                  </div>
                  <div className="task-field">
                    <label htmlFor={`${rangeId}-emoji`}>Эмодзи категории {index + 1}</label>
                    <input id={`${rangeId}-emoji`} value={range.emoji} maxLength={MAX_RATING_EMOJI_LENGTH} aria-invalid={Boolean(errors.ranges)} aria-describedby={describedBy} required onChange={(event) => changeRange(index, 'emoji', event.target.value)} />
                  </div>
                  <div className="settings-range-bounds">
                    <div className="task-field">
                      <label htmlFor={`${rangeId}-min`}>От, минут — диапазон {index + 1}</label>
                      <input id={`${rangeId}-min`} type="text" inputMode="numeric" value={range.minMinutes} aria-invalid={Boolean(errors.ranges)} aria-describedby={describedBy} required onChange={(event) => changeRange(index, 'minMinutes', event.target.value)} />
                    </div>
                    {range.maxMinutes === null
                      ? <p className="settings-range-open">Без верхней границы</p>
                      : <div className="task-field">
                        <label htmlFor={`${rangeId}-max`}>До, минут — диапазон {index + 1}</label>
                        <input id={`${rangeId}-max`} type="text" inputMode="numeric" value={range.maxMinutes} aria-invalid={Boolean(errors.ranges)} aria-describedby={describedBy} required onChange={(event) => changeRange(index, 'maxMinutes', event.target.value)} />
                      </div>}
                  </div>
                </fieldset>
              })}
            </div>
          </section>}
          {saveError && <p className="task-error" role="alert">{saveError}</p>}
        </div>
        <footer className="task-dialog-footer">
          <Button variant="outline" disabled={saving} onClick={close}>Отмена</Button>
          <Button type="submit" disabled={saving}>{saving && <LoaderCircle className="spin" aria-hidden="true" />}Сохранить привычку</Button>
        </footer>
      </form>
    </dialog>
  )
}
