'use client'

import { useState } from 'react'
import { DecorativeBlockie } from './Blockie'
import { CopyButton } from './CopyButton'
import { Button } from './ui/button'

/**
 * How many owners are shown before the rest go behind the expander. A Safe can have dozens, and
 * this list sits in a dialog that must not scroll: a row per owner would push the deploy button
 * off the bottom of the screen.
 */
const COLLAPSED = 5

export interface OwnerListProps {
  owners: string[]
}

/**
 * The owner set, in full.
 *
 * This is the one block on the deploy screen that may not abbreviate: the owners are what
 * determines control of the Safe, and "1 owner" or a truncated address is nothing a reader can
 * check on the one screen whose whole job is checking. So the addresses are complete and the
 * *count* is what gets deferred instead.
 */
export function OwnerList({ owners }: OwnerListProps) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? owners : owners.slice(0, COLLAPSED)

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {shown.map((owner) => (
        // `group/owner` rather than a bare `group`: the row sits inside the card's own group, and
        // an unnamed one here would capture `group-hover` intended for either.
        <span
          key={owner}
          data-testid="owner-row"
          className="group/owner flex min-w-0 items-center gap-2"
        >
          {/* A reader who recognises their own blockie has a check that reading 42 hex characters
              does not give them. Decorative: the address it depicts is right beside it. */}
          <DecorativeBlockie
            address={owner}
            size={15}
            slot="owner-identicon"
            className="size-[15px] rounded-sm"
          />
          <code className="min-w-0 truncate text-xs">{owner}</code>
          {/* Dimmer than the Safe address's copy above, and brought up on hover: an owner is worth
              copying, but this screen has exactly one address the user is here to check, and a row
              of equally loud controls would stop saying which. */}
          <CopyButton
            value={owner}
            label={`Copy owner ${owner}`}
            copiedMessage="Owner address copied"
            className="opacity-50 transition-opacity group-hover/owner:opacity-100 focus-visible:opacity-100"
          />
        </span>
      ))}
      {owners.length > COLLAPSED && (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="self-start px-0"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show fewer' : `Show all ${owners.length} owners`}
        </Button>
      )}
    </div>
  )
}
