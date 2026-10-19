import { liveQuery, type Subscription } from 'dexie'
import { useEffect, useState } from 'react'
import { initializeDatabase } from '@/db/database'
import { getStatistics, type StatisticsDashboard } from '@/services/statistics/statistics-service'
import type { StatisticsPeriod } from '@/services/statistics/period-utils'

export function useStatistics(period: StatisticsPeriod, now: Date) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data?: StatisticsDashboard; error?: boolean } | null>(null)
  const timestamp = now.getTime()
  const key = `${period.startDate}/${period.endDate}/${period.today}/${attempt}`
  useEffect(() => {
    let active = true
    let subscription: Subscription | undefined
    const fail = () => { if (active) setState({ key, error: true }) }
    void initializeDatabase().then(() => {
      if (!active) return
      subscription = liveQuery(() => getStatistics(period, new Date(timestamp))).subscribe({
        next: (data) => { if (active) setState({ key, data }) }, error: fail,
      })
    }).catch(fail)
    return () => { active = false; subscription?.unsubscribe() }
  }, [key, period, timestamp])
  const current = state?.key === key ? state : null
  return { data: current?.data, error: current?.error ?? false, loading: current === null,
    retry: () => setAttempt((value) => value + 1) }
}
