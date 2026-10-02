import {
  CalendarDays,
  ChartNoAxesCombined,
  CircleCheck,
  ListTodo,
  Settings2,
  Target,
} from 'lucide-react'

export const navigation = [
  { id: 'today', label: 'Сегодня', icon: CircleCheck },
  { id: 'calendar', label: 'Календарь', icon: CalendarDays },
  { id: 'tasks', label: 'Задачи', icon: ListTodo },
  { id: 'goals', label: 'Цели', icon: Target },
  { id: 'statistics', label: 'Статистика', icon: ChartNoAxesCombined },
  { id: 'settings', label: 'Настройки', icon: Settings2 },
] as const

export type PageId = (typeof navigation)[number]['id']

export function getCurrentPage(): PageId {
  const hash = window.location.hash.slice(1)
  return navigation.find((page) => page.id === hash)?.id ?? 'today'
}
