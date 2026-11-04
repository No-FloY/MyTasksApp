import { liveQuery, type Subscription } from 'dexie'
import { useEffect, useState } from 'react'
import { initializeDatabase } from '@/db/database'
import type { LocalDate } from '@/lib/local-date'
import { getDayScore, getWeeklyScore } from '@/services/statistics/day-score-service'

function useScore<T>(date: LocalDate, read: (date: LocalDate) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data?: T; error?: boolean } | null>(null)
  const key = `${date}/${attempt}`
  useEffect(() => {
    let active = true
    let subscription: Subscription | undefined
    const fail = () => { if (active) setState({ key, error: true }) }
    void initializeDatabase().then(() => {
      if (!active) return
      subscription = liveQuery(() => read(date)).subscribe({
        next: (data) => { if (active) setState({ key, data }) }, error: fail,
      })
    }).catch(fail)
    return () => { active = false; subscription?.unsubscribe() }
  }, [date, key, read])
  const current = state?.key === key ? state : null
  return { data: current?.data, error: current?.error ?? false, loading: current === null,
    retry: () => setAttempt((value) => value + 1) }
}

export function useDayScore(date: LocalDate) { return useScore(date, getDayScore) }
export function useWeeklyScore(date: LocalDate) { return useScore(date, getWeeklyScore) }
