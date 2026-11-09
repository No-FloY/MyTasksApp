export const STATISTICS_SECTIONS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'habits', label: 'Привычки' },
  { id: 'nutrition', label: 'Питание' },
  { id: 'training', label: 'Тренировка' },
  { id: 'screen-time', label: 'Экранное время' },
  { id: 'tasks', label: 'Задачи' },
  { id: 'goals', label: 'Цели' },
] as const

export type StatisticsSection = typeof STATISTICS_SECTIONS[number]['id']

export function getStatisticsSection(value: string | null): StatisticsSection {
  return STATISTICS_SECTIONS.find((section) => section.id === value)?.id ?? 'overview'
}

export function getStatisticsSectionLink(hash: string, section: StatisticsSection): string {
  const params = new URLSearchParams(hash.split('?')[1])
  if (section === 'overview') params.delete('section')
  else params.set('section', section)
  return `#statistics${params.size ? `?${params}` : ''}`
}
