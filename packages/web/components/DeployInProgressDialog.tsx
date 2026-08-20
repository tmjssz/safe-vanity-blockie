'use client'

import { DecorativeBlockie } from './Blockie'
import { CopyButton } from './CopyButton'
import { SpinnerOverlay } from './SpinnerOverlay'
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

export interface DeployInProgressDialogProps {
  open: boolean
  /** The Safe currently being deployed, which is the one in the way. */
  address: string
  onOpenChange: (open: boolean) => void
  /** Brings the deploy that is in progress back on screen. */
  onView: () => void
}

/**
 * Why activating another result did nothing.
 *
 * The page refuses a new selection while a deploy is running, and it has to: the dialog holding
 * that deploy's status would be unmounted by the swap, with a transaction still in a wallet's
 * hands. Refusing silently is the part that was wrong — a grid that stops responding reads as
 * broken rather than as a rule — so the refusal now says what it is waiting for and offers the two
 * ways out, neither of which is a button on this screen: a deploy finishes, or the wallet rejects
 * it. Nothing here can recall a transaction that has already been sent.
 */
export function DeployInProgressDialog({
  open,
  address,
  onOpenChange,
  onView,
}: DeployInProgressDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `lg` rather than `md`: at md the 42-character address fits its line to the pixel, and
          `truncate` would then hide the tail on any monospace fallback whose advance width is wider
          than the 0.6em this stack mostly shares. The extra 64px is the slack. */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>A deploy is already in progress</DialogTitle>
          <DialogDescription>
            Wait for it to finish, or reject it in your wallet, before opening another result. A
            transaction cannot be recalled once your wallet has it.
          </DialogDescription>
        </DialogHeader>
        {/* Which one, because two results can look alike at a glance and the grid behind this can
            hold two hundred. In full and copyable, as the deploy dialog shows it: an abbreviation
            is not something a user can check against the pending transaction in their wallet, which
            is the one thing they can usefully do while this is on screen.

            The spinner turns over the picture, the same mark the header pill and the result tile
            carry, so all three places a running deploy appears say it the same way. */}
        <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
          <span className="relative inline-flex size-10 shrink-0">
            <DecorativeBlockie
              address={address}
              size={40}
              slot="in-progress-identicon"
              className="size-10 rounded-md"
            />
            <SpinnerOverlay iconClassName="size-5" className="rounded-md" />
          </span>
          <code className="min-w-0 truncate font-mono text-[13px] text-foreground">{address}</code>
          <CopyButton
            value={address}
            label="Copy Safe address"
            copiedMessage="Safe address copied"
            failedMessage="Could not copy automatically. Select the address and copy it manually."
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            {/* The deploy dialog's own words for the same act, because it is the same act: leaving
                does not stop what the wallet is doing. */}
            <Button type="button" variant="ghost">
              Close and keep waiting
            </Button>
          </DialogClose>
          {/* The useful action: the deploy it is talking about, with its status and transaction. */}
          <Button type="button" onClick={onView}>
            View the deploy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
