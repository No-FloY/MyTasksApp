import { useSyncExternalStore } from 'react'
import { db } from '@/db/database'

interface PwaState {
  offline: boolean
  ready: boolean
  updateAvailable: boolean
  supported: boolean
  error: string | null
}

let state: PwaState = {
  offline: !navigator.onLine, ready: false, updateAvailable: false,
  supported: import.meta.env.PROD && 'serviceWorker' in navigator,
  error: null,
}
const listeners = new Set<() => void>()
let registration: ServiceWorkerRegistration | undefined
let starting: Promise<void> | undefined
let started = false
let lastCheck = 0
let applying = false

function publish(change: Partial<PwaState>) {
  state = { ...state, ...change }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function usePwa() {
  return useSyncExternalStore(subscribe, () => state)
}

function observeWorker(worker: ServiceWorker | null) {
  if (!worker) return
  const changed = () => {
    if (worker.state === 'installed' && registration?.active) {
      publish({ updateAvailable: true })
    }
    if (worker.state === 'activated') publish({ ready: true, error: null })
    if (worker.state === 'redundant' && !registration?.active) {
      publish({ error: 'Не удалось подготовить приложение для работы без сети. Подключитесь к интернету и повторите проверку.' })
    }
  }
  worker.addEventListener('statechange', changed)
  changed()
}

async function register() {
  if (!state.supported || registration) return
  if (starting) return starting
  starting = (async () => {
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      publish({ ready: registration.active?.state === 'activated', updateAvailable: Boolean(registration.waiting), error: null })
      observeWorker(registration.installing)
      observeWorker(registration.active)
      registration.addEventListener('updatefound', () => observeWorker(registration?.installing ?? null))
    } catch {
      publish({ error: 'Работа без сети пока недоступна. Подключитесь к интернету и повторите проверку.' })
    } finally {
      starting = undefined
    }
  })()
  return starting
}

export async function checkForUpdate() {
  await register()
  if (!registration || !navigator.onLine) return
  lastCheck = Date.now()
  try {
    await registration.update()
    publish({ updateAvailable: Boolean(registration.waiting), error: null })
  } catch {
    // A temporary network failure never interrupts local work or an installed cache.
    publish({ error: 'Не удалось проверить обновления. Приложение продолжает работать; повторите проверку при подключении.' })
  }
}

export function startPwa() {
  if (started) return
  started = true
  void register()
  const checkWhenVisible = () => {
    if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - lastCheck > 60_000) void checkForUpdate()
  }
  window.addEventListener('online', () => { publish({ offline: false }); checkWhenVisible() })
  window.addEventListener('offline', () => publish({ offline: true }))
  window.addEventListener('focus', checkWhenVisible)
  document.addEventListener('visibilitychange', checkWhenVisible)
  window.setInterval(checkWhenVisible, 60 * 60_000)
}

/** Called only after explicit confirmation in a modal with an inert background. */
export async function applyUpdate(): Promise<void> {
  if (applying) return
  const waiting = registration?.waiting
  if (!waiting) throw new Error('Обновление пока недоступно. Повторите проверку в настройках.')
  applying = true
  try {
    // Read across all stores waits behind already queued writes/import transactions.
    // No writes, migration, deletion or reseeding are part of a code update.
    if (db.isOpen()) await db.transaction('r', db.tables, () => db.habits.count())
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel()
      const cleanup = () => {
        window.clearTimeout(timeout)
        navigator.serviceWorker.removeEventListener('controllerchange', controlled)
        channel.port1.close()
      }
      const fail = (message: string) => { cleanup(); reject(new Error(message)) }
      const controlled = () => {
        cleanup()
        resolve()
        // Only this consenting window reloads. Initial installation never reloads.
        window.location.reload()
      }
      const timeout = window.setTimeout(() => fail('Не удалось завершить обновление. Попробуйте ещё раз.'), 30_000)
      navigator.serviceWorker.addEventListener('controllerchange', controlled)
      channel.port1.onmessage = (event: MessageEvent<{ ok: boolean; reason?: string }>) => {
        if (event.data.ok) return // Activation/control, not the message, is the reload boundary.
        fail(event.data.reason === 'other-windows'
          ? 'Закройте другие окна приложения, предварительно сохранив в них изменения. Затем повторите обновление.'
          : 'Не удалось проверить открытые окна. Закройте другие окна приложения и повторите попытку.')
      }
      try { waiting.postMessage({ type: 'SAFE_SKIP_WAITING' }, [channel.port2]) }
      catch { fail('Не удалось запустить обновление. Повторите проверку в настройках.') }
    })
  } finally {
    applying = false
  }
}
