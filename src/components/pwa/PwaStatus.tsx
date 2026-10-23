import { useRef, useState } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePwa } from '@/pwa/client'
import { PwaUpdateDialog } from './PwaUpdateDialog'
import './pwa.css'

function UpdateNotice() {
  const updateRef = useRef<HTMLButtonElement>(null)
  const [dismissed, setDismissed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  if (dismissed) return null

  return (
    <>
      <div className="pwa-notice">
        <RefreshCw className="pwa-notice-icon" size={19} aria-hidden="true" />
        <div className="pwa-notice-copy">
          <p className="pwa-notice-title" role="status">Доступна новая версия приложения</p>
          <p>Обновите, когда закончите текущую работу. Обновление также доступно в настройках.</p>
        </div>
        <div className="pwa-notice-actions">
          <Button ref={updateRef} onClick={() => setConfirming(true)}>Обновить</Button>
          <Button variant="ghost" onClick={() => {
            setDismissed(true)
            requestAnimationFrame(() => document.getElementById('main-content')?.focus())
          }}>Позже</Button>
        </div>
      </div>
      {confirming && <PwaUpdateDialog onClose={() => setConfirming(false)} fallbackFocus={updateRef} />}
    </>
  )
}

export function PwaStatus() {
  const { offline, updateAvailable } = usePwa()
  if (!offline && !updateAvailable) return null
  return (
    <div className="pwa-status" aria-label="Состояние приложения">
      {offline && <p className="pwa-offline" role="status"><WifiOff size={17} aria-hidden="true" /><span><strong>Нет подключения</strong> — можно продолжать работать с локальными данными.</span></p>}
      {updateAvailable && <UpdateNotice />}
    </div>
  )
}
