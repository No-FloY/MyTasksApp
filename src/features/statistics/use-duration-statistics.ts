import { liveQuery, type Subscription } from 'dexie'
import { useEffect, useState } from 'react'
import { initializeDatabase } from '@/db/database'
import type { LocalDate } from '@/lib/local-date'
import { getDurationWeeklyStatistics, type DurationWeek } from '@/services/duration-statistics-service'

interface ReadState {
  date: LocalDate
  attempt: number
  weeks: DurationWeek[]
  error: boolean
}

export function useDurationStatistics(date: LocalDate) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ReadState | null>(null)
  useEffect(() => {
    let active = true
    let subscription: Subscription | undefined
    const fail = () => {
      if (active) setState({ date, attempt, weeks: [], error: true })
    }
    void initializeDatabase().then(() => {
      if (!active) return
      subscription = liveQuery(() => getDurationWeeklyStatistics(date)).subscribe({
        next: (weeks) => { if (active) setState({ date, attempt, weeks, error: false }) },
        error: fail,
      })
    }).catch(fail)
    return () => { active = false; subscription?.unsubscribe() }
  }, [date, attempt])
  const current = state?.date === date && state.attempt === attempt ? state : null
  return {
    weeks: current?.weeks ?? [], loading: current === null, error: current?.error ?? false,
    retry: () => setAttempt((value) => value + 1),
  }
}
