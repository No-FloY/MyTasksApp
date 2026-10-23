import { useId, useLayoutEffect, useRef, useState } from 'react'
import { CircleCheck, LoaderCircle, RefreshCw, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { checkForUpdate, usePwa } from '@/pwa/client'
import { PwaUpdateDialog } from './PwaUpdateDialog'
import './pwa.css'

export function PwaSettings() {
  const id = useId()
  const { offline, ready, updateAvailable, error, supported } = usePwa()
  const updateRef = useRef<HTMLButtonElement>(null)
  const checkRef = useRef<HTMLButtonElement>(null)
  const pendingRef = useRef(false)
  const [confirming, setConfirming] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [checkError, setCheckError] = useState('')

  useLayoutEffect(() => {
    if (checkError && !checking) checkRef.current?.focus()
  }, [checkError, checking])

  async function check() {
    if (pendingRef.current) return
    pendingRef.current = true
    setChecking(true)
    setChecked(false)
    setCheckError('')
    try {
      await checkForUpdate()
      setChecked(true)
    } catch (cause) {
      setCheckError(cause instanceof Error ? cause.message : 'Не удалось проверить обновления. Попробуйте ещё раз.')
    } finally {
      pendingRef.current = false
      setChecking(false)
    }
  }

  return (
    <section className="pwa-settings" aria-labelledby={`${id}-heading`}>
      <div className="pwa-settings-heading"><Smartphone size={23} aria-hidden="true" /><h2 id={`${id}-heading`}>Приложение на устройстве</h2></div>
      <p>На iPhone откройте приложение в Safari, нажмите «Поделиться» → «На экран „Домой“». Затем запустите его с новой иконки.</p>
      <p>Первый раз откройте установленное приложение с интернетом и дождитесь сообщения о готовности к работе без подключения.</p>
      <details className="pwa-storage-help">
        <summary>Как перенести данные из Safari</summary>
        <p>Safari и приложение с экрана «Домой» могут использовать отдельные хранилища. Если в установленном приложении нет ваших записей, скачайте резервную копию в Safari и восстановите её в настройках установленного приложения. Данные в Safari останутся.</p>
      </details>
      {ready
        ? <p className="pwa-ready" role="status"><CircleCheck size={18} aria-hidden="true" /><span>Приложение готово к работе без подключения в этом браузере или установленной копии.</span></p>
        : <p className="pwa-readiness" role="status">{!supported
          ? 'Подготовка автономного запуска недоступна. Локальные функции приложения продолжают работать.'
          : offline
            ? 'Для подготовки автономного запуска нужно подключение к интернету.'
            : 'Автономный запуск ещё не готов. Оставьте приложение открытым с подключением к интернету.'}</p>}
      {supported && <div className="pwa-settings-actions">
        {updateAvailable && <Button ref={updateRef} onClick={() => setConfirming(true)}><RefreshCw aria-hidden="true" />Обновить приложение</Button>}
        <Button ref={checkRef} variant="outline" disabled={checking || offline} onClick={() => { void check() }}>
          {checking ? <LoaderCircle className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Проверить обновления
        </Button>
      </div>}
      {checking && <p className="pwa-readiness" role="status">Проверяем обновления…</p>}
      {checked && !checking && !updateAvailable && !error && !checkError && <p className="pwa-readiness" role="status">Проверка обновлений выполнена.</p>}
      {(checkError || error) && <p className="pwa-error" role="alert">{checkError || error}</p>}
      {confirming && <PwaUpdateDialog onClose={() => setConfirming(false)} fallbackFocus={updateRef} />}
    </section>
  )
}
