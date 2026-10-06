import { useKeyboard, usePaste } from "@opentui/solid"
import { blocked } from "../state"

type KeyHandler = Parameters<typeof useKeyboard>[0]
type PasteHandler = Parameters<typeof usePaste>[0]

/**
 * useKeyboard for panels and dialogs: ignores keys while an approval or a question covers
 * them, so they can stay mounted (keeping their state) under the prompt.
 */
export function useKeys(handler: KeyHandler, isBlocked: () => boolean = blocked) {
  useKeyboard((evt) => {
    if (isBlocked()) return
    handler(evt)
  })
}

export function usePasteWhenFree(handler: PasteHandler, isBlocked: () => boolean = blocked) {
  usePaste((evt) => {
    if (isBlocked()) return
    handler(evt)
  })
}
