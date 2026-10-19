import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { getStatisticsPeriod, type StatisticsPeriod, type StatisticsPreset } from '@/services/statistics/period-utils'

const statisticsPresets: { value: StatisticsPreset; label: string }[] = [
  { value: '7d', label: '7 дней' }, { value: 'month', label: 'Месяц' },
  { value: 'previous-month', label: 'Предыдущий месяц' }, { value: '3m', label: '3 месяца' },
  { value: '6m', label: '6 месяцев' }, { value: 'year', label: 'Год' }, { value: 'custom', label: 'Свой период' },
]

function selectPeriod(preset: StatisticsPreset, startDate?: string, endDate?: string) {
  const params = new URLSearchParams({ period: preset })
  if (preset === 'custom' && startDate && endDate) { params.set('from', startDate); params.set('to', endDate) }
  window.location.hash = `statistics?${params}`
}

function CustomPeriodForm({ period }: { period: StatisticsPeriod }) {
  const [from, setFrom] = useState<string>(period.startDate)
  const [to, setTo] = useState<string>(period.endDate)
  const [error, setError] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const selected = getStatisticsPeriod('custom', period.today, { startDate: from, endDate: to })
      setError('')
      selectPeriod('custom', selected.startDate, selected.endDate)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Проверьте даты.') }
  }
  return <form className="statistics-custom-period" onSubmit={submit} noValidate>
    <label>С даты<input type="date" value={from} max={period.today} onChange={(event) => setFrom(event.target.value)} aria-invalid={Boolean(error)} aria-describedby="statistics-date-help" /></label>
    <label>По дату<input type="date" value={to} max={period.today} onChange={(event) => setTo(event.target.value)} aria-invalid={Boolean(error)} aria-describedby="statistics-date-help" /></label>
    <Button type="submit">Применить период</Button>
    <p id="statistics-date-help" className="week-explanation">Обе даты включены. До сегодняшнего дня, не более 10 лет (3660 дней).</p>
    {error && <p className="statistics-input-error" role="alert">{error}</p>}
  </form>
}

export function PeriodPicker({ period }: { period: StatisticsPeriod }) {
  const [editing, setEditing] = useState(false)
  return <section className="statistics-period" aria-label="Период статистики">
    <div className="statistics-period-buttons" role="group" aria-label="Выбор периода">
      {statisticsPresets.map((preset) => <button key={preset.value} type="button" aria-pressed={period.preset === preset.value}
        onClick={() => { if (preset.value === 'custom') setEditing((value) => !value); else { setEditing(false); selectPeriod(preset.value) } }}>
        {preset.label}
      </button>)}
    </div>
    {(editing || period.preset === 'custom') && <CustomPeriodForm key={`${period.startDate}/${period.endDate}`} period={period} />}
    <p className="statistics-period-label" data-testid="statistics-period-label">{period.label}</p>
    <p className="week-explanation">Месяц — с первого числа по сегодня. 3 и 6 месяцев, год — скользящий период по сегодня. Будущие дни не учитываются.</p>
  </section>
}
