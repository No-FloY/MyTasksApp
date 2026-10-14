import { useEffect, useRef, type RefObject } from 'react'

/** Native dialogs provide an inert background; keep Tab within visible controls. */
export function useTaskDialog(onClose: () => void, fallbackFocus: RefObject<HTMLButtonElement | null>) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const activeElement = document.activeElement
    // Safari may leave focus on <main tabIndex={-1}> after a pointer click.
    // A page container is not the trigger; use the supplied button in that case.
    openerRef.current = activeElement instanceof HTMLElement && activeElement.tabIndex >= 0
      ? activeElement : fallbackFocus.current
    dialog?.showModal()

    function keepFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !dialog) return
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
        .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) {
        event.preventDefault()
        return
      }
      const focused = document.activeElement
      if (!controls.some((element) => element === focused)
        || (event.shiftKey ? focused === first : focused === last)) {
        event.preventDefault()
        if (event.shiftKey) last.focus()
        else first.focus()
      }
    }

    dialog?.addEventListener('keydown', keepFocus)
    return () => {
      dialog?.removeEventListener('keydown', keepFocus)
      dialog?.close()
    }
  }, [fallbackFocus])

  function finish(restoreOpener: boolean) {
    const opener = restoreOpener ? openerRef.current : fallbackFocus.current
    dialogRef.current?.close()
    onClose()
    // After saving or deleting, liveQuery may remove the old card after this
    // frame. Target the stable page button instead of that card's trigger.
    requestAnimationFrame(() => {
      if (opener?.isConnected && !opener.matches(':disabled') && opener.getClientRects().length > 0) opener.focus()
      else fallbackFocus.current?.focus()
    })
  }

  return { dialogRef, close: () => finish(true), closeAfterChange: () => finish(false) }
}
