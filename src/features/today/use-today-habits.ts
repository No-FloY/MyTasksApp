import { liveQuery, type Subscription } from 'dexie'
import { useEffect, useRef, useState } from 'react'
import { initializeDatabase } from '@/db/database'
import { getLocalDate, type LocalDate } from '@/lib/local-date'
import type { BooleanHabitStatus } from '@/models/habit-entry'
import {
  getTodayHabits,
  setBooleanHabitStatus,
  type BooleanHabitWithStatus,
} from '@/services/habit-service'

type ReadState =
  | { date: LocalDate; attempt: number; status: 'ready'; habits: BooleanHabitWithStatus[] }
  | { date: LocalDate; attempt: number; status: 'error' }

interface SaveState {
  pending: boolean
  error?: string
}

export function useTodayHabits(date: LocalDate) {
  const [attempt, setAttempt] = useState(0)
  const [readState, setReadState] = useState<ReadState | null>(null)
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})
  const writesInFlight = useRef(new Set<string>())

  useEffect(() => {
    let active = true
    let subscription: Subscription | undefined

    void initializeDatabase()
      .then(() => {
        if (!active) return
        subscription = liveQuery(() => getTodayHabits(date)).subscribe({
          next: (habits) => {
            if (active) setReadState({ date, attempt, status: 'ready', habits })
          },
          error: () => {
            if (active) setReadState({ date, attempt, status: 'error' })
          },
        })
      })
      .catch(() => {
        if (active) setReadState({ date, attempt, status: 'error' })
      })

    return () => {
      active = false
      subscription?.unsubscribe()
    }
  }, [date, attempt])

  function saveStatus(habitId: string, status: BooleanHabitStatus) {
    const key = `${date}:${habitId}`
    if (writesInFlight.current.has(key)) return

    if (date !== getLocalDate()) {
      setSaveStates((current) => ({
        ...current,
        [key]: { pending: false, error: 'Наступил новый день. Обновите страницу перед отметкой.' },
      }))
      return
    }

    writesInFlight.current.add(key)
    setSaveStates((current) => ({ ...current, [key]: { pending: true } }))

    void setBooleanHabitStatus(habitId, date, status)
      .then(() => {
        setSaveStates((current) => ({ ...current, [key]: { pending: false } }))
      })
      .catch(() => {
        setSaveStates((current) => ({
          ...current,
          [key]: {
            pending: false,
            error: 'Не удалось сохранить отметку. Попробуйте выбрать её ещё раз.',
          },
        }))
      })
      .finally(() => {
        writesInFlight.current.delete(key)
      })
  }

  const currentState = readState?.date === date && readState.attempt === attempt ? readState : null
  const habits = currentState?.status === 'ready' ? currentState.habits : []

  return {
    habits,
    loading: currentState === null,
    error: currentState?.status === 'error',
    retry: () => setAttempt((current) => current + 1),
    saveStatus,
    getSaveState: (habitId: string): SaveState =>
      saveStates[`${date}:${habitId}`] ?? { pending: false },
  }
}
