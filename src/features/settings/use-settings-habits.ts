import { liveQuery, type Subscription } from 'dexie'
import { useEffect, useState } from 'react'
import { initializeDatabase } from '@/db/database'
import type { Habit } from '@/models/habit'
import { getSettingsHabits } from '@/services/habit-settings-service'

interface SettingsReadState {
  attempt: number
  habits: Habit[]
  error: boolean
}

export function useSettingsHabits() {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<SettingsReadState | null>(null)

  useEffect(() => {
    let active = true
    let subscription: Subscription | undefined
    const fail = () => {
      if (active) setState({ attempt, habits: [], error: true })
    }
    void initializeDatabase().then(() => {
      if (!active) return
      subscription = liveQuery(getSettingsHabits).subscribe({
        next: (habits) => { if (active) setState({ attempt, habits, error: false }) },
        error: fail,
      })
    }).catch(fail)
    return () => { active = false; subscription?.unsubscribe() }
  }, [attempt])

  const current = state?.attempt === attempt ? state : null
  return {
    habits: current?.habits ?? [],
    loading: current === null,
    error: current?.error ?? false,
    retry: () => setAttempt((value) => value + 1),
  }
}
