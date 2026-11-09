import { useRef, type KeyboardEvent } from 'react'
import { STATISTICS_SECTIONS, type StatisticsSection } from './statistics-navigation'

export function StatisticsTabs({ selected, onSelect }: { selected: StatisticsSection; onSelect: (section: StatisticsSection) => void }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % STATISTICS_SECTIONS.length
    else if (event.key === 'ArrowLeft') next = (index + STATISTICS_SECTIONS.length - 1) % STATISTICS_SECTIONS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = STATISTICS_SECTIONS.length - 1
    else return
    event.preventDefault()
    tabs.current[next]?.focus()
    onSelect(STATISTICS_SECTIONS[next]!.id)
  }
  return <div className="statistics-tabs" role="tablist" aria-label="Разделы статистики">
    {STATISTICS_SECTIONS.map(({ id, label }, index) => <button key={id} ref={(element) => { tabs.current[index] = element }}
      role="tab" id={`statistics-tab-${id}`} aria-selected={selected === id} aria-controls={selected === id ? `statistics-panel-${id}` : undefined}
      tabIndex={selected === id ? 0 : -1} onClick={() => onSelect(id)} onKeyDown={(event) => navigate(event, index)}>{label}</button>)}
  </div>
}
