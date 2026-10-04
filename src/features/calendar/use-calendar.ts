import { liveQuery, type Subscription } from 'dexie'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { initializeDatabase } from '@/db/database'
import { getCalendarMonth } from '@/lib/calendar'
import { isLocalDate, type LocalDate } from '@/lib/local-date'
import { getCalendarMonthData, type CalendarMonthData } from '@/services/calendar-service'

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useCalendarSelection(today: LocalDate) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash)
  const params = new URLSearchParams(hash.split('?')[1])
  const dateParam = params.get('date') ?? ''
  const monthParam = params.get('month') ?? ''
  const selectedDate = isLocalDate(dateParam) ? dateParam : today
  const month = getCalendarMonth(isLocalDate(monthParam) ? monthParam : selectedDate).month

  function select(date: LocalDate, visibleMonth: LocalDate = date) {
    const next = new URLSearchParams({ date, month: getCalendarMonth(visibleMonth).month })
    window.location.hash = `calendar?${next.toString()}`
  }
  return { selectedDate, month, select }
}

interface ReadState {
  month: LocalDate
  attempt: number
  data?: CalendarMonthData
  error?: boolean
}

export function useCalendarMonth(month: LocalDate) {
  const [attempt, setAttempt] = useState(0)
  const [initialized, setInitialized] = useState(false)
  const [state, setState] = useState<ReadState | null>(null)
  useEffect(() => {
    let active = true
    let subscription: Subscription | undefined
    const fail = () => { if (active) setState({ month, attempt, error: true }) }
    void initializeDatabase().then(() => {
      if (!active) return
      subscription = liveQuery(() => getCalendarMonthData(month)).subscribe({
        next: (data) => {
          if (active) {
            setState({ month, attempt, data })
            setInitialized(true)
          }
        },
        error: fail,
      })
    }).catch(fail)
    return () => { active = false; subscription?.unsubscribe() }
  }, [month, attempt])
  const current = state?.month === month && state.attempt === attempt ? state : null
  return {
    data: current?.data, loading: current === null, error: Boolean(current?.error), initialized,
    retry: () => setAttempt((value) => value + 1),
  }
}
