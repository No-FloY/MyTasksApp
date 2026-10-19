import { useEffect, useState } from 'react'

/** Refresh just after minute deadlines, on focus, and after a suspended tab resumes. */
export function useCurrentTime(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let lastRetriedBoundary: number | null = null
    function refresh() {
      clearTimeout(timer)
      const current = new Date()
      const timestamp = current.getTime()
      setNow((previous) => previous.getTime() === timestamp ? previous : current)
      const remainder = timestamp % 60_000
      const retryBoundary = remainder === 0 && lastRetriedBoundary !== timestamp
      timer = setTimeout(() => {
        // One immediate follow-up keeps exact deadlines inclusive without
        // polling every millisecond when the wall clock remains unchanged.
        if (retryBoundary) lastRetriedBoundary = timestamp
        refresh()
      }, retryBoundary ? 1 : 60_001 - remainder)
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return now
}
