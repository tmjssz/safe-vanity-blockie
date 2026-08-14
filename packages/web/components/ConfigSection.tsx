'use client'

import { useState } from 'react'
import type { MineConfig } from '../lib/config'
import { ConfigForm, type ConfigFormProps } from './ConfigForm'
import { Button } from './ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

/**
 * The Configure column's measure, shared with the phishing callout below it so the two read as one
 * narrow column above the full-width results grid rather than as two arbitrary widths.
 */
export const CARD_WIDTH = 'mx-auto w-full max-w-[520px]'

export function ConfigSection({
  config,
  initial,
  chainId,
  miningPaused,
  onSubmit,
  onToggleMining,
  onStartOver,
}: {
  config: MineConfig | undefined
  /** Prefill for the form, used by `?config=…` share links. Passed straight to ConfigForm. */
  initial?: ConfigFormProps['initial']
  /** The chain chosen in the header, which the form submits as part of the config. */
  chainId: number
  /** True while the submitted run is halted. */
  miningPaused: boolean
  onSubmit: (config: MineConfig) => void
  onToggleMining: () => void
  onStartOver: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    // Narrow and centred, rather than the full content width the results grid uses. The card is a
    // short column of one-line answers; stretched to 1152px its inputs become long empty troughs
    // and the eye has to travel the width of the page between a label and its field.
    <Card className={CARD_WIDTH}>
      {/* `flex-row … space-y-0` was inert here: CardHeader is a grid, and tailwind-merge keeps
          `grid` while `flex-row` simply does not apply — so the action stacked under the title
          instead of sitting opposite it. CardAction is the grid's own second column. */}
      <CardHeader>
        <CardTitle as="h2">Configure</CardTitle>
        {/* Under the heading, not beside the owners list. It is true of every field on this card,
            and it is the reason the fields lock once a run starts — so it belongs to the step,
            not to one of its fields. */}
        <CardDescription>
          Owners, threshold and version determine the address. Changing any of them re-rolls every
          result.
        </CardDescription>
        {/* The way back to nothing at all, offered only once there is a run to throw away. It is
            no longer the only way to change a locked field — stopping unlocks them, and starting
            again with an edit discards the run with a warning that says so — but it remains the
            one action that also clears the share link and the address bar. */}
        {config && (
          <CardAction>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Start over…
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Start over?</DialogTitle>
                  {/* The chain is no longer one of these fields — it is picked in the header, and
                      switching among the chains that share a Safe singleton keeps every result, so
                      naming it here would promise a loss that switching does not always cost. The
                      switch that does cost it asks in its own words (see ChainSelector). */}
                  <DialogDescription>
                    Owners, threshold and Safe version determine the Safe address, so changing them
                    will discard every result found so far and any selected result.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Keep mining</Button>
                  </DialogClose>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setOpen(false)
                      onStartOver()
                    }}
                  >
                    Start over
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {/* The form stays mounted for the whole run rather than collapsing to a summary. It is
            where the Stop control lives, and leaving the fields on screen (locked, but readable)
            means the config being mined is always legible without reconstructing it from a
            one-line précis. */}
        <ConfigForm
          initial={initial}
          chainId={chainId}
          onSubmit={onSubmit}
          submittedConfig={config}
          miningPaused={miningPaused}
          onToggleMining={onToggleMining}
        />
      </CardContent>
    </Card>
  )
}
