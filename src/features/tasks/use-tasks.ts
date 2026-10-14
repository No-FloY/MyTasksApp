import { liveQuery, type Subscription } from 'dexie'
import { useEffect, useState } from 'react'
import { initializeDatabase } from '@/db/database'
import type { LocalDate } from '@/lib/local-date'
import type { Task } from '@/models/task'
import { getAllTasks, getTasksForDate } from '@/services/task-service'

interface ReadState {
  date: LocalDate | undefined
  attempt: number
  tasks: Task[]
  error: boolean
}

/** The day views query the date index; the full page subscribes only to tasks. */
export function useTasks(date?: LocalDate) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ReadState | null>(null)

  useEffect(() => {
    let active = true
    let subscription: Subscription | undefined
    const fail = () => {
      if (active) setState({ date, attempt, tasks: [], error: true })
    }
    void initializeDatabase().then(() => {
      if (!active) return
      subscription = liveQuery(() => date ? getTasksForDate(date) : getAllTasks()).subscribe({
        next: (tasks) => { if (active) setState({ date, attempt, tasks, error: false }) },
        error: fail,
      })
    }).catch(fail)
    return () => { active = false; subscription?.unsubscribe() }
  }, [date, attempt])

  const current = state?.date === date && state?.attempt === attempt ? state : null
  return {
    tasks: current?.tasks ?? [],
    loading: current === null,
    error: current?.error ?? false,
    retry: () => setAttempt((value) => value + 1),
  }
}
