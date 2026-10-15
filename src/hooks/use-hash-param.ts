import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/** Query parameters belong to the existing hash route, not the server URL. */
export function useHashParam(name: string): string | null {
  return useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.hash.split('?')[1]).get(name))
}
