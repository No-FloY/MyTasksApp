import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getLocalDate } from '@/lib/local-date'
import type { BooleanHabit } from '@/models/habit'
import { HabitRow } from '@/features/today/components/HabitRow'
import { ArchivedDayHistory } from '@/features/calendar/ArchivedDayHistory'

const timestamp = '2026-11-01T09:00:00.000Z'
const date = getLocalDate(new Date(2026, 10, 2))
const coffee: BooleanHabit = { id: 'coffee', name: 'Кофе', description: '', type: 'boolean', category: 'food_water',
  booleanMode: 'observation', missingDataPolicy: 'assume_not_occurred', order: 23,
  createdAt: timestamp, updatedAt: timestamp, archivedAt: null }

describe('neutral coffee presentation', () => {
  it.each(['success', 'failure', 'no-data'] as const)('shows event labels and neutral styles for %s', (status) => {
    const html = renderToStaticMarkup(createElement(HabitRow, {
      habit: coffee, status, source: 'explicit', date, index: 0, pending: false, onChange: () => {},
    }))
    expect(html).toContain('habit-observation')
    expect(html).toContain('Пил</button>')
    expect(html).toContain('Не пил</button>')
    expect(html).toContain('Нет данных</button>')
    expect(html).not.toMatch(/Успех|Неудача|lucide-x/)
  })

  it('identifies an inferred result without claiming it was saved by the user', () => {
    const html = renderToStaticMarkup(createElement(HabitRow, {
      habit: coffee, status: 'failure', source: 'inferred', date, index: 0, pending: false, onChange: () => {},
    }))
    expect(html).toContain('data-result-source="inferred"')
    expect(html).toContain('По правилу незаполненного дня · можно изменить')
  })

  it('keeps archived coffee history neutral', () => {
    const html = renderToStaticMarkup(createElement(ArchivedDayHistory, { rows: [{
      habit: { ...coffee, archivedAt: timestamp },
      entry: { habitId: 'coffee', type: 'boolean', status: 'failure', date, createdAt: timestamp, updatedAt: timestamp },
    }] }))
    expect(html).toContain('Не пил')
    expect(html).not.toContain('Неудача')
  })
})
