import { liveQuery } from 'dexie'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/button'
import type { LocalDate } from '../../lib/local-date'
import {
  getDayHabitNotes, MAX_HABIT_NOTE_LENGTH, setHabitEntryNote, type HabitEntryWithNote,
} from '../../services/habit-note-service'
import { getBooleanHabitStatistics, type BooleanHabitStatistics } from '../../services/streak-service'
import './day-insights.css'

interface DayInsightData {
  date: LocalDate
  notes: HabitEntryWithNote[]
  statistics: BooleanHabitStatistics[]
}

interface NoteFormState {
  draft?: string
  pending?: boolean
  error?: string | undefined
  saved?: boolean
}

export function DayInsights({ date }: { date: LocalDate }) {
  const [data, setData] = useState<DayInsightData | null>(null)
  const [error, setError] = useState<{ date: LocalDate; message: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [forms, setForms] = useState<Record<string, NoteFormState>>({})
  const id = useId()

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [notes, statistics] = await Promise.all([getDayHabitNotes(date), getBooleanHabitStatistics(date)])
      return { date, notes, statistics }
    }).subscribe({
      next: (result) => { setData(result); setError(null) },
      error: (reason: unknown) => setError({
        date, message: reason instanceof Error ? reason.message : 'Не удалось загрузить заметки и серии.',
      }),
    })
    return () => subscription.unsubscribe()
  }, [date, retry])

  const rows = data?.date === date ? data.notes : []
  const selected = rows.find((row) => row.habit.id === selection[date]) ?? rows[0]
  const key = `${date}/${selected?.habit.id ?? ''}`
  const form = forms[key] ?? {}
  const value = form.draft ?? selected?.entry.note ?? ''

  function updateForm(update: Partial<NoteFormState>) {
    setForms((previous) => ({ ...previous, [key]: { ...previous[key], ...update } }))
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || form.pending) return
    updateForm({ pending: true, error: undefined, saved: false })
    try {
      await setHabitEntryNote(selected.habit.id, date, value)
      setForms((previous) => ({ ...previous, [key]: { pending: false, saved: true } }))
    } catch (reason) {
      setForms((previous) => ({
        ...previous,
        [key]: { ...previous[key], pending: false, error: reason instanceof Error ? reason.message : 'Не удалось сохранить заметку.' },
      }))
    }
  }

  if (error?.date === date) return (
    <section className="day-insights" aria-label="Заметки и серии">
      <div className="day-insight-card" role="alert">
        <p className="day-insight-error">{error.message}</p>
        <Button variant="outline" onClick={() => setRetry((previous) => previous + 1)}>Повторить загрузку</Button>
      </div>
    </section>
  )

  if (!data || data.date !== date) return <p className="day-insight-loading" role="status">Загружаем заметки и серии…</p>

  return (
    <div className="day-insights">
      <section className="day-insight-card" aria-labelledby={`${id}-notes`}>
        <h2 id={`${id}-notes`}>Заметки к привычкам</h2>
        <p className="day-insight-description">Контекст и наблюдения за выбранный день.</p>
        {selected ? (
          <form className="habit-note-form" onSubmit={(event) => { void saveNote(event) }}>
            <label htmlFor={`${id}-habit`}>Привычка для заметки</label>
            <select id={`${id}-habit`} value={selected.habit.id}
              onChange={(event) => setSelection((previous) => ({ ...previous, [date]: event.target.value }))}>
              {rows.map(({ habit }) => <option key={habit.id} value={habit.id}>{habit.name}</option>)}
            </select>
            <label htmlFor={`${id}-note`}>Заметка</label>
            <textarea id={`${id}-note`} rows={4} maxLength={MAX_HABIT_NOTE_LENGTH} value={value}
              disabled={form.pending} aria-describedby={`${id}-hint`} aria-invalid={Boolean(form.error)}
              onChange={(event) => updateForm({ draft: event.target.value, error: undefined, saved: false })} />
            <p className="habit-note-hint" id={`${id}-hint`}>
              До {MAX_HABIT_NOTE_LENGTH} символов. Чтобы удалить заметку, очистите поле и сохраните.
            </p>
            <Button type="submit" className="habit-note-save" disabled={form.pending}>
              {form.pending ? 'Сохраняем…' : 'Сохранить заметку'}
            </Button>
            {form.error && <p className="day-insight-error" role="alert">{form.error}</p>}
            {form.saved && <p className="habit-note-feedback" role="status">Заметка сохранена.</p>}
          </form>
        ) : <p className="day-insight-empty">Сначала сохраните результат любой привычки за выбранный день. Затем здесь можно добавить заметку.</p>}
      </section>

      <section className="day-insight-card" aria-labelledby={`${id}-streaks`}>
        <h2 id={`${id}-streaks`}>Серии и доля успехов</h2>
        <p className="day-insight-description">Для привычек с отметками «Успех / Неудача», по всей истории до выбранной даты включительно.</p>
        <p className="day-streak-explanation">Серия — успехи в календарные дни подряд. Пропуск, «Неудача» и «Нет данных» прерывают серию. Доля успехов учитывает только «Успех» и «Неудача».</p>
        {data.statistics.length === 0 ? <p className="day-insight-empty">Нет активных привычек с отметками «Успех / Неудача».</p> : (
          <ul className="day-streak-list">
            {data.statistics.map((row) => (
              <li className="day-streak-row" key={row.habit.id}>
                <h3>{row.habit.name}</h3>
                <dl>
                  <div><dt>Серия на выбранную дату</dt><dd>{row.currentStreak} дн.</dd></div>
                  <div><dt>Лучшая серия</dt><dd>{row.bestStreak} дн.</dd></div>
                  <div><dt>Доля успехов</dt><dd>{row.successRate === null ? 'Нет данных' : `${Math.round(row.successRate)}%`}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
