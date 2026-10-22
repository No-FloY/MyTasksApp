import { useId } from 'react'
import type { Habit } from '../../models/habit'
import type { HabitEntry } from '../../models/habit-entry'
import { formatDuration } from '../../services/duration-service'
import type { HabitEntryWithNote } from '../../services/habit-note-service'

const typeLabels: Record<Habit['type'], string> = {
  boolean: 'Отметки', amount: 'Количество', duration: 'Время', rating: 'Оценка',
}

function formatEntry(habit: Habit, entry: HabitEntry): string {
  switch (entry.type) {
    case 'boolean':
      return { success: 'Успех', failure: 'Неудача', 'no-data': 'Нет данных' }[entry.status]
    case 'amount':
      return `${entry.value.toLocaleString('ru-RU')}${habit.type === 'amount' ? ` ${habit.unit === 'ml' ? 'мл' : habit.unit}` : ''}`
    case 'duration':
      return formatDuration(entry.minutes)
    case 'rating':
      return entry.value.toLocaleString('ru-RU')
  }
}

/** Read-only facts and notes; restoring a habit enables its existing editors. */
export function ArchivedDayHistory({ rows }: { rows: HabitEntryWithNote[] }) {
  const id = useId()
  const archived = rows.filter(({ habit }) => habit.archivedAt !== null)
  if (archived.length === 0) return null
  return (
    <section className="day-insight-card" aria-labelledby={`${id}-archive`}>
      <h2 id={`${id}-archive`}>Архивные привычки за выбранный день</h2>
      <p className="day-insight-description">Фактические результаты и заметки сохранены. Для редактирования восстановите привычку в настройках.</p>
      <ul className="archived-day-list">
        {archived.map(({ habit, entry }) => (
          <li key={habit.id} data-archived-habit-id={habit.id}>
            <h3>{habit.name}</h3>
            <p className="archived-day-type">{typeLabels[habit.type]} · В архиве</p>
            <p className="archived-day-value">{formatEntry(habit, entry)}</p>
            {entry.note && <p className="archived-day-note">{entry.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}
