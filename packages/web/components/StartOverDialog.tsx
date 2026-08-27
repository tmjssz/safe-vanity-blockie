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
 * One door now: the app title in the header. The status bar carried a second one, and dropping it
 * left this the single place the question is asked. The wording and the "nothing found yet means
 * nothing to confirm" rule still live here rather than at the call site, because a confirmation over
 * an empty leaderboard is the kind that teaches people to dismiss confirmations, and that judgement
 * should not be a thing a caller re-decides.
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
          {/* What it says has to match what it does. This promised the owners, threshold and Safe
              version came back in the form, which was true while Start over handed them over so a
              single field could be changed without retyping addresses. It is a full reset now: the
              header's title is the only route back from a run, that reads as "take me to the
              beginning", and a confirmation describing the old behaviour is worse than none, because
              it is read and believed. */}
          <DialogDescription>
            The search stops and every result found so far is thrown away. Everything goes back to
            how it started: the owners, the filters and the checkpoint are all cleared.
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
