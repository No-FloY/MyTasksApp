import { useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isLocalDate } from '@/lib/local-date'
import {
  canNavigateStatisticsPeriod, getStatisticsLink, getStatisticsPeriod, isStatisticsPreset,
  shiftStatisticsPeriod, type StatisticsPeriod, type StatisticsPreset,
} from '@/services/statistics/period-utils'

const primaryPresets = [
  { value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' },
] as const
const otherPresets: { value: StatisticsPreset; label: string }[] = [
  { value: '3m', label: '3 месяца' }, { value: 'year', label: 'Год' }, { value: 'custom', label: 'Произвольный' },
  { value: '7d', label: '7 дней' }, { value: 'previous-month', label: 'Предыдущий месяц' }, { value: '6m', label: '6 месяцев' },
]

function selectPeriod(period: StatisticsPeriod) {
  const params = period.preset === 'custom' ? new URLSearchParams({ period: 'custom' })
    : new URLSearchParams(getStatisticsLink(period.preset, period.anchorDate).split('?')[1])
  const section = new URLSearchParams(window.location.hash.split('?')[1]).get('section')
  if (section) params.set('section', section)
  if (period.preset === 'custom') { params.set('from', period.startDate); params.set('to', period.endDate) }
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
      selectPeriod(selected)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Проверьте даты.') }
  }
  return <form className="statistics-custom-period" onSubmit={submit} noValidate>
    <label>С даты<input type="date" value={from} max={period.today} onChange={(event) => setFrom(event.target.value)} aria-invalid={Boolean(error)} aria-describedby="statistics-date-help" /></label>
    <label>По дату<input type="date" value={to} max={period.today} onChange={(event) => setTo(event.target.value)} aria-invalid={Boolean(error)} aria-describedby="statistics-date-help" /></label>
    <Button type="submit">Применить период</Button>
    <p id="statistics-date-help" className="week-explanation">Обе даты включены. До сегодня, не более 10 лет.</p>
    {error && <p className="statistics-input-error" role="alert">{error}</p>}
  </form>
}

export function PeriodPicker({ period }: { period: StatisticsPeriod }) {
  const [error, setError] = useState('')
  const monthInput = period.preset === 'month' || period.preset === 'previous-month'
  const isPrimary = primaryPresets.some(({ value }) => value === period.preset)

  function choose(preset: StatisticsPreset) {
    setError('')
    if (preset === 'custom') {
      selectPeriod(getStatisticsPeriod('custom', period.today, { startDate: period.startDate, endDate: period.endDate }))
      return
    }
    selectPeriod(getStatisticsPeriod(preset, period.today, undefined, period.preset === 'previous-month' ? period.startDate : period.anchorDate))
  }

  function selectAnchor(value: string) {
    try {
      const date = monthInput ? `${value}-01` : value
      if (!isLocalDate(date)) throw new Error('Укажите корректную дату.')
      selectPeriod(getStatisticsPeriod(monthInput ? 'month' : period.preset, period.today, undefined, date))
      setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Проверьте дату.') }
  }

  return <section className="statistics-period" aria-label="Период статистики">
    <div className="statistics-period-top">
      <div className="statistics-period-buttons" role="group" aria-label="Выбор периода">
        {primaryPresets.map((preset) => <button key={preset.value} type="button" aria-pressed={period.preset === preset.value} onClick={() => choose(preset.value)}>{preset.label}</button>)}
      </div>
      <select className="statistics-other-period" aria-label="Другой период" value={isPrimary ? '' : period.preset}
        onChange={(event) => { if (isStatisticsPreset(event.target.value)) choose(event.target.value) }}>
        <option value="" disabled>Другой период</option>
        {otherPresets.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    {period.preset === 'custom'
      ? <CustomPeriodForm key={`${period.startDate}/${period.endDate}`} period={period} />
      : <div className="statistics-period-navigator">
        <button className="statistics-icon-button" type="button" aria-label="Предыдущий период" onClick={() => selectPeriod(shiftStatisticsPeriod(period, -1))}><ChevronLeft size={19} aria-hidden="true" /></button>
        <label className="statistics-anchor"><CalendarDays size={17} aria-hidden="true" /><span className="sr-only">{monthInput ? 'Выбранный месяц' : 'Опорная дата'}</span>
          <input type={monthInput ? 'month' : 'date'} value={monthInput ? period.startDate.slice(0, 7) : period.anchorDate}
            max={monthInput ? period.today.slice(0, 7) : period.today} onChange={(event) => selectAnchor(event.target.value)} />
        </label>
        <button className="statistics-icon-button" type="button" aria-label="Следующий период" disabled={!canNavigateStatisticsPeriod(period, 1)} onClick={() => selectPeriod(shiftStatisticsPeriod(period, 1))}><ChevronRight size={19} aria-hidden="true" /></button>
        <button className="statistics-current-period" type="button" aria-label="К текущему периоду" onClick={() => selectPeriod(getStatisticsPeriod(period.preset === 'previous-month' ? 'month' : period.preset, period.today))}><RotateCcw size={15} aria-hidden="true" /><span>К текущему периоду</span></button>
      </div>}
    <p className="statistics-period-label" data-testid="statistics-period-label" aria-live="polite">{period.label}</p>
    {error && <p className="statistics-input-error" role="alert">{error}</p>}
  </section>
}
