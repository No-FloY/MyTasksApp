import { liveQuery, type Subscription } from 'dexie'
import { useEffect, useRef, useState } from 'react'
import { initializeDatabase } from '@/db/database'
import { getLocalDate, type LocalDate } from '@/lib/local-date'
import type { BooleanHabitStatus } from '@/models/habit-entry'
import {
  getDurationInput, getTodayDurationHabits, parseDurationInput, setHabitDuration,
  type DurationHabitWithRating, type DurationInput,
} from '@/services/duration-service'
import {
  addHabitAmount,
  getTodayAmountHabits,
  getTodayHabits,
  parseAmountInput,
  setBooleanHabitStatus,
  type AmountHabitWithProgress,
  type BooleanHabitWithStatus,
} from '@/services/habit-service'

type ReadState =
  | {
      date: LocalDate
      attempt: number
      status: 'ready'
      habits: BooleanHabitWithStatus[]
      amountHabits: AmountHabitWithProgress[]
      durationHabits: DurationHabitWithRating[]
    }
  | { date: LocalDate; attempt: number; status: 'error' }

interface SaveState {
  pending: boolean
  error?: string
}

export function useTodayHabits(date: LocalDate) {
  const [attempt, setAttempt] = useState(0)
  const [readState, setReadState] = useState<ReadState | null>(null)
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({})
  const [durationInputs, setDurationInputs] = useState<Record<string, DurationInput>>({})
  const writesInFlight = useRef(new Set<string>())

  useEffect(() => {
    let active = true
    let subscription: Subscription | undefined

    void initializeDatabase()
      .then(() => {
        if (!active) return
        subscription = liveQuery(() => Promise.all([
          getTodayHabits(date),
          getTodayAmountHabits(date),
          getTodayDurationHabits(date),
        ])).subscribe({
          next: ([habits, amountHabits, durationHabits]) => {
            if (active) setReadState({ date, attempt, status: 'ready', habits, amountHabits, durationHabits })
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

  function persist(
    habitId: string,
    write: () => Promise<void>,
    errorMessage: string,
    onSuccess?: () => void,
  ) {
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

    void write()
      .then(() => {
        setSaveStates((current) => ({ ...current, [key]: { pending: false } }))
        onSuccess?.()
      })
      .catch(() => {
        setSaveStates((current) => ({
          ...current,
          [key]: {
            pending: false,
            error: errorMessage,
          },
        }))
      })
      .finally(() => {
        writesInFlight.current.delete(key)
      })
  }

  function saveStatus(habitId: string, status: BooleanHabitStatus) {
    persist(
      habitId,
      () => setBooleanHabitStatus(habitId, date, status),
      'Не удалось сохранить отметку. Попробуйте выбрать её ещё раз.',
    )
  }

  function addAmount(habitId: string, amount: number, onSuccess?: () => void) {
    persist(
      habitId,
      () => addHabitAmount(habitId, date, amount),
      'Не удалось сохранить количество. Попробуйте добавить его ещё раз.',
      onSuccess,
    )
  }

  function changeAmountInput(habitId: string, input: string) {
    const key = `${date}:${habitId}`
    if (writesInFlight.current.has(key)) return
    setAmountInputs((current) => ({ ...current, [key]: input }))
    setSaveStates((current) => ({ ...current, [key]: { pending: false } }))
  }

  function submitAmount(habitId: string) {
    const key = `${date}:${habitId}`
    if (writesInFlight.current.has(key)) return
    let amount: number
    try {
      amount = parseAmountInput(amountInputs[key] ?? '')
    } catch (error) {
      setSaveStates((current) => ({
        ...current,
        [key]: {
          pending: false,
          error: error instanceof Error ? error.message : 'Проверьте введённое количество.',
        },
      }))
      return
    }
    addAmount(habitId, amount, () => {
      setAmountInputs((current) => ({ ...current, [key]: '' }))
    })
  }

  const currentState = readState?.date === date && readState.attempt === attempt ? readState : null
  const habits = currentState?.status === 'ready' ? currentState.habits : []
  const durationHabits = currentState?.status === 'ready' ? currentState.durationHabits : []

  function getDurationDraft(habitId: string): DurationInput {
    return durationInputs[`${date}:${habitId}`]
      ?? getDurationInput(durationHabits.find((item) => item.habit.id === habitId)?.minutes ?? null)
  }

  function changeDurationInput(habitId: string, field: keyof DurationInput, value: string) {
    const key = `${date}:${habitId}`
    if (writesInFlight.current.has(key)) return
    const draft = { ...getDurationDraft(habitId), [field]: value }
    setDurationInputs((current) => ({ ...current, [key]: draft }))
    setSaveStates((current) => ({ ...current, [key]: { pending: false } }))
  }

  function submitDuration(habitId: string) {
    const key = `${date}:${habitId}`
    if (writesInFlight.current.has(key)) return
    const input = getDurationDraft(habitId)
    let minutes: number
    try {
      minutes = parseDurationInput(input.hours, input.minutes)
    } catch (error) {
      setSaveStates((current) => ({ ...current, [key]: {
        pending: false,
        error: error instanceof Error ? error.message : 'Проверьте введённое время.',
      } }))
      return
    }
    persist(habitId, () => setHabitDuration(habitId, date, minutes),
      'Не удалось сохранить время. Введённое значение осталось в форме. Попробуйте ещё раз.',
      () => setDurationInputs((current) => {
        const next = { ...current }
        delete next[key]
        return next
      }))
  }

  return {
    habits,
    amountHabits: currentState?.status === 'ready' ? currentState.amountHabits : [],
    durationHabits,
    getDurationDraft,
    changeDurationInput,
    submitDuration,
    loading: currentState === null,
    error: currentState?.status === 'error',
    retry: () => setAttempt((current) => current + 1),
    saveStatus,
    addAmount,
    submitAmount,
    changeAmountInput,
    getAmountInput: (habitId: string): string => amountInputs[`${date}:${habitId}`] ?? '',
    getSaveState: (habitId: string): SaveState =>
      saveStates[`${date}:${habitId}`] ?? { pending: false },
  }
}
