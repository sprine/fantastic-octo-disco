import { useCallback, useState } from 'react'
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
  const clear = useCallback(() => setFailed(null), [])

  /**
   * The general form: any command, with the verb that completes "Could not …".
   * `changes` means a refresh must follow — even after a failure, which may
   * have partly landed before it threw. Resolves to whether the command did.
   */
  const run = useCallback(
    async (verb: string, command: () => Promise<unknown>, changes = false): Promise<boolean> => {
      setFailed(null)
      let ok = true
      try {
        await command()
      } catch (error) {
        ok = false
        setFailed(`Could not ${verb}: ${errorMessage(error)}`)
      } finally {
        if (changes) onChanged()
      }
      if (ok) onSuccess?.()
      return ok
    },
    [onChanged, onSuccess]
  )

  const attempt = useCallback(
    (action: ImageAction, id: number) => run(action.verb, () => action.run(id), action.changes),
    [run]
  )

  return { failed, attempt, run, clear }
}
