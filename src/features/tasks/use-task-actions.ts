import { useRef, useState } from 'react'
import type { Task } from '@/models/task'
import { completeTask, reopenTask } from '@/services/task-service'

export function useTaskActions() {
  const busyIds = useRef(new Set<string>())
  const [pendingIds, setPendingIds] = useState(new Set<string>())
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function toggleTask(task: Task): Promise<boolean> {
    if (busyIds.current.has(task.id)) return false
    busyIds.current.add(task.id)
    setPendingIds(new Set(busyIds.current))
    setErrors((current) => ({ ...current, [task.id]: '' }))
    try {
      if (task.status === 'completed') await reopenTask(task.id)
      else await completeTask(task.id)
      return true
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [task.id]: error instanceof Error ? error.message : 'Не удалось изменить задачу. Попробуйте ещё раз.',
      }))
      return false
    } finally {
      busyIds.current.delete(task.id)
      setPendingIds(new Set(busyIds.current))
    }
  }

  return { toggleTask, pendingIds, errors }
}
