import { useSyncExternalStore } from 'react'
import { delayUntilNextLocalDay, getLocalDate } from '@/lib/local-date'

function subscribe(onChange: () => void) {
  let midnightTimer: ReturnType<typeof setTimeout>

  function scheduleMidnight() {
    clearTimeout(midnightTimer)
    midnightTimer = setTimeout(() => {
      onChange()
      scheduleMidnight()
    }, delayUntilNextLocalDay() + 50)
  }

  function refresh() {
    onChange()
    scheduleMidnight()
  }

  // Focus and periodic checks also account for a changed system time zone.
  scheduleMidnight()
  const clockTimer = setInterval(refresh, 60_000)
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refresh)

  return () => {
    clearTimeout(midnightTimer)
    clearInterval(clockTimer)
    window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', refresh)
  }
}

export function useLocalDate() {
  return useSyncExternalStore(subscribe, getLocalDate)
}
