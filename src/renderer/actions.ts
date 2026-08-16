import { useState } from 'react'
import { errorMessage } from '../shared/errors.js'

export type ImageAction = {
  label: string
  /** Completes "Could not …" when the action throws. */
  verb: string
  run: (id: number) => Promise<unknown>
  /** Removes a row, so the caller must re-read the library afterwards. */
  changes?: boolean
  danger?: boolean
}

/**
 * The image actions, once. The tile menu and the detail panel are two surfaces
 * onto the same four commands; drawn from one list they cannot drift into
 * different wording or a different order.
 *
 * No confirmation here: 'delete original' confirms in main, where the guarantee
 * belongs to the operation, and a second dialog would only teach the user to
 * click through the first.
 */
export const IMAGE_ACTIONS: ImageAction[] = [
  { label: 'Open original', verb: 'open', run: (id) => window.api.shell.openOriginal(id) },
  { label: 'Show in folder', verb: 'show', run: (id) => window.api.shell.showInFolder(id) },
  {
    label: 'Remove from library',
    verb: 'remove',
    run: (id) => window.api.library.remove([id], 'library'),
    changes: true
  },
  // Last, and named one word apart from the one above it: naming carries the
  // safety margin.
  {
    label: 'Delete original',
    verb: 'remove',
    run: (id) => window.api.library.remove([id], 'original'),
    changes: true,
    danger: true
  }
]

/**
 * Every action reports its failure in one place: a silent catch reads to the
 * user as the button doing nothing, which is the bug this notice exists to end.
 * `onSuccess` runs only when the action did — a menu that vanishes having done
 * nothing is indistinguishable from one that worked.
 */
export function useAttempt(onChanged: () => void, onSuccess?: () => void) {
  const [failed, setFailed] = useState<string | null>(null)

  const attempt = async (action: ImageAction, id: number) => {
    setFailed(null)
    try {
      await action.run(id)
    } catch (error) {
      return setFailed(`Could not ${action.verb}: ${errorMessage(error)}`)
    }
    onSuccess?.()
    if (action.changes) onChanged()
  }

  return [failed, attempt] as const
}
