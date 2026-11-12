import { fixture, instant } from './helpers'

/** A genuine v1 shape predating categories, exercises, meals, weekly habits and coffee. */
export function legacyBackup() {
  const data = fixture()
  const habits = data.habits.filter((habit) => habit.order < 11).map((habit) => {
    const row: Record<string, unknown> = { ...habit }
    for (const field of ['category', 'quickActions', 'manualMode', 'schedule', 'missingDataPolicy', 'booleanMode']) delete row[field]
    if (habit.id === 'english') row.name = 'Мой английский'
    if (habit.id === 'reading') row.archivedAt = '2026-10-20T10:00:00.000Z'
    return row
  })
  return { app: 'zadachnik', formatVersion: 1, exportedAt: instant.toISOString(), data: { ...data, habits } }
}
