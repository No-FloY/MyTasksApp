import { liveQuery, type Subscription } from 'dexie'
import { useEffect, useState } from 'react'
import { initializeDatabase } from '@/db/database'
import { goalService } from '@/services/goal-service'

type GoalSummary = Awaited<ReturnType<typeof goalService.getGoalsWithProgress>>[number]
type GoalDetails = Awaited<ReturnType<typeof goalService.getGoalDetails>>

interface GoalReadState {
  id: string | null
  attempt: number
  goals: GoalSummary[]
  details: GoalDetails
  error: boolean
}

export function useGoals(id: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<GoalReadState | null>(null)

  useEffect(() => {
    let active = true
    let subscription: Subscription | undefined
    const fail = () => { if (active) setState({ id, attempt, goals: [], details: null, error: true }) }
    void initializeDatabase().then(() => {
      if (!active) return
      subscription = liveQuery(async () => id
        ? { goals: [], details: await goalService.getGoalDetails(id) }
        : { goals: await goalService.getGoalsWithProgress(), details: null }).subscribe({
        next: (result) => { if (active) setState({ id, attempt, ...result, error: false }) },
        error: fail,
      })
    }).catch(fail)
    return () => { active = false; subscription?.unsubscribe() }
  }, [id, attempt])

  const current = state?.id === id && state?.attempt === attempt ? state : null
  return {
    goals: current?.goals ?? [], details: current?.details ?? null,
    loading: current === null, error: current?.error ?? false,
    retry: () => setAttempt((value) => value + 1),
  }
}
