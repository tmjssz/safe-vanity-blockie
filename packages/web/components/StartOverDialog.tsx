'use client'

import { type ReactNode, useCallback, useState } from 'react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

/**
 * The question guarding the only route back to the Configure card, and the rule about when it is
 * worth asking.
 *
 * There are two doors onto that one action — the status bar's "Start over" and the app title in
 * the header — and this is what stops them becoming two actions. Both the wording and the
 * "nothing found yet means nothing to confirm" rule live here rather than at either call site:
 * a confirmation over an empty leaderboard is the kind that teaches people to dismiss
 * confirmations, and that judgement should not be a thing each caller re-decides.
 *
 * `request` takes the count rather than the hook: the number the user is asked about is the
 * number they answer, held still while the question is on screen even though the search behind
 * it keeps finding more. It also lets a caller that deliberately does not follow the count from
 * one tick to the next — the header — read it at the one instant it matters.
 */
export function useStartOverConfirm(onStartOver: () => void): {
  request: (resultCount: number) => void
  dialog: ReactNode
} {
  // Doubles as "is the question open": null is closed, and any number is the count it names.
  const [pending, setPending] = useState<number | null>(null)

  const request = useCallback(
    (resultCount: number) => {
      if (resultCount > 0) setPending(resultCount)
      else onStartOver()
    },
    [onStartOver],
  )

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Discard {(pending ?? 0).toLocaleString('en-US')} result{pending === 1 ? '' : 's'} and
            start over?
          </DialogTitle>
          <DialogDescription>
            The search stops and every result found so far is thrown away. Your owners, threshold
            and Safe version come back in the form, so you can change one and start again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Keep mining</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              setPending(null)
              onStartOver()
            }}
          >
            Discard and start over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { request, dialog }
}
