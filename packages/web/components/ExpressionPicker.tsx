'use client'

import { useEffect, useState } from 'react'
import { ALL_MOUTH_NAMES } from '../lib/face-selection'
import { cn } from '../lib/utils'
import { Explains } from './Explains'
import { TargetPreview } from './TargetPreview'
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

export interface ExpressionPickerProps {
  value: string[]
  onChange: (mouthNames: string[]) => void
  /**
   * Whether there is a run for an apply to restart.
   *
   * It gates the confirmation below, and only that. The question is about a run: a leaderboard
   * discarded, the scanned total back to zero, the search begun again. On a screen with no run
   * there is none of that, so a click applies on the spot and Apply and Reset have nothing left to
   * govern (see `stage`).
   *
   * Defaults to true: a host that says nothing gets the question, because the cost it warns about
   * is the normal case.
   */
  live?: boolean
}

/**
 * Whether two selections would mine the same thing. Compared as sets: the face spec is built from
 * which expressions are accepted, not from the order they were clicked in, so a list that differs
 * only in order is not a change and must not offer to restart the search over nothing.
 */
function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((name, i) => name === [...b].sort()[i])
}

/**
 * The five expression tiles, and everything that acts on the selection.
 *
 * A section of Configure in its own right now, rather than half of the Filter card. What it asks is
 * not the same KIND of question as the colour filters it used to sit beside: those re-filter
 * candidates already mined, so each applies the moment it moves, while an expression change is what
 * the miner is looking FOR, and applying one during a run discards the board. Putting the cheap
 * three behind a disclosure and leaving this always visible says which is which by where they are,
 * instead of relying on a warning dialog to say it after the fact.
 */
export function ExpressionPicker({ value, onChange, live = true }: ExpressionPickerProps) {
  const [error, setError] = useState<string | undefined>()
  const [confirming, setConfirming] = useState(false)

  // The selection being *edited*, which is not yet the selection being mined.
  //
  // Changing the accepted expressions changes the face spec, and the face spec is part of a run's
  // identity (see MiningView's `sameRun`): a new one throws the leaderboard away and resets the
  // scanned total to zero. That used to happen on a single click of a tile, silently, while the
  // two colour filters beside it — which only re-filter candidates already mined — were equally
  // one click and cost nothing. Two controls an inch apart, one free and one destructive, with
  // nothing to tell them apart.
  //
  // So a click stages, and applying is a separate, announced act. The tiles show the draft,
  // because the draft is what the user is choosing.
  const [draft, setDraft] = useState(value)
  // The host applying a selection is what ends the pending state: it hands back a new `value`,
  // and the draft catches up to it. This also covers a `value` that changes for any other reason,
  // rather than leaving the tiles showing a selection nothing is mining.
  useEffect(() => setDraft(value), [value])

  // Only a live run can have a staged edit. With no run, `stage` below hands changes straight to
  // the host and never touches the draft, so this could only ever be false anyway — saying so
  // outright is what makes Apply and Reset provably unreachable there rather than incidentally so.
  const pending = live && !sameSelection(draft, value)

  /**
   * Where a new selection goes: onto the draft, or straight to the host.
   *
   * Staging exists for one reason — to put a warning between a click and a restarted search, since
   * changing the accepted expressions wipes the leaderboard and resets the scanned total. With no
   * run there is nothing to restart and nothing to discard, so the warning has nothing to warn
   * about and the click can simply take effect. Apply and Reset then have no staged edit left to
   * govern, and stop rendering on their own (see `pending`).
   *
   * The draft is not written in that case, deliberately: the host owns the value, hands it back,
   * and the effect above syncs the draft to it. Writing both would be two sources for one fact.
   */
  const stage = (next: string[]) => {
    setError(undefined)
    if (live) {
      setDraft(next)
      return
    }
    onChange(next)
  }

  const toggle = (name: string) => {
    if (draft.includes(name)) {
      if (draft.length === 1) {
        setError('Keep at least one expression: a face needs a mouth to score against.')
        return
      }
      stage(draft.filter((entry) => entry !== name))
      return
    }
    stage([...draft, name])
  }

  const allAccepted = ALL_MOUTH_NAMES.every((name) => draft.includes(name))

  return (
    <>
      <section className="flex flex-col gap-3">
        <div
          data-slot="expressions-heading-row"
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          {/* h3 nests correctly under the card's h2 title. */}
          <h3 id="face-expressions" className="text-sm font-medium">
            Face expressions
          </h3>
          <Explains label="face expressions">
            Click a shape to accept or reject that expression. Each is what the miner is aiming at,
            not a blockie of any real address, since none exists yet.
          </Explains>

          {/* Everything that acts on the selection, with its heading rather than trailing the
            tiles. Left to right they run from the least consequential to the most: widen the
            selection, discard the edit, restart the search. Only Apply has consequences, and it
            is the only one that looks like it does.

            Each is absent rather than disabled when it would do nothing. Two of the three come
            and go with a staged change in any case, so a permanently present but greyed-out
            third would be the one dead control in a row that is otherwise never dead.

            With no run those two are never here at all: nothing stages, so there is no edit to
            discard and no restart to announce, and Select all is left as the only control on the
            row (see `stage`). Two buttons that could never do anything would be worst on exactly
            that screen, where the reader has the least context for working out what they were
            for. */}
          <div className="ml-auto flex items-center gap-2">
            {!allAccepted && (
              // Rejecting is one click per expression; getting back is one click total.
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-muted-foreground no-underline hover:text-foreground hover:no-underline"
                // Through `stage` like every other change here, so it stages during a run and
                // takes effect on the spot when there is none. It is not a staging control
                // itself — it widens the selection — so it stays on screen either way.
                onClick={() => stage([...ALL_MOUTH_NAMES])}
              >
                Select all
              </Button>
            )}
            {pending && (
              <>
                {/* The way out that costs nothing: Apply restarts the search, this only drops
                  edits that never took effect, so it asks no question. Outlined rather than
                  plain text — it acts on the form, where Select all beside it only widens the
                  selection — but not filled, because only Apply has consequences for the run. */}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    // The complaint belongs to the draft being discarded, so it goes with it.
                    setError(undefined)
                    setDraft(value)
                  }}
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  size="xs"
                  // Straight through when there is nothing to restart. Deliberately the same
                  // control either way rather than two: what Apply MEANS is unchanged — the draft
                  // becomes what is mined — and only the question in front of it goes away.
                  onClick={() => (live ? setConfirming(true) : onChange(draft))}
                >
                  Apply
                </Button>
              </>
            )}
          </div>
        </div>

        {/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> is not a drop-in here — it wants its label as a <legend> inside it, whereas this group's heading is the card's own <h3 id="face-expressions">, which sits above the Reset/Apply row rather than inside the grid. */}
        <div role="group" aria-labelledby="face-expressions" className="grid grid-cols-5 gap-2">
          {ALL_MOUTH_NAMES.map((name) => {
            const accepted = draft.includes(name)
            return (
              // role="checkbox" on a real <button> is what Radix's own Checkbox renders, so this
              // stays a toggle for assistive tech — and its accessible name is the caption below
              // the preview, which is why the preview itself is decorative here.
              //
              // biome-ignore lint/a11y/useSemanticElements: see above — an <input type="checkbox"> cannot host the preview tile this control is made of.
              <button
                key={name}
                type="button"
                role="checkbox"
                aria-checked={accepted}
                onClick={() => toggle(name)}
                className={cn(
                  'relative flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  // Inverted from what this used to do. Everything starts accepted, so the
                  // remarkable state is the rejected one: accepted tiles are simply normal, and
                  // rejection is what the eye should catch. Ringing all five by default made the
                  // whole row shout and left "rejected" as the quiet absence of a ring.
                  accepted
                    ? 'border-border bg-muted/40'
                    : 'border-border/40 opacity-45 hover:opacity-70',
                )}
              >
                {/* No mark over the pattern. It sat in the tile's top-right corner, which is
                    the pattern's own corner — a glyph drawn on top of the 8x8 grid at 40px is
                    covering the thing being chosen. Acceptance is carried by the tile not being
                    dimmed, which is opacity rather than colour and so survives any colour-vision
                    difference, and by `aria-checked` on the button, which is what a screen reader
                    has always read: the glyph was aria-hidden and never spoke to one. */}
                <TargetPreview mouthName={name} size={40} decorative />
                <span className={cn('text-xs', !accepted && 'text-muted-foreground')}>{name}</span>
              </button>
            )
          })}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      {/* Asked every time, without checking whether the board happens to be empty yet. Restarting
        also throws away the nonces already scanned, so there is something to lose from the first
        second of a run — and this control sits among filters that cost nothing, which is exactly
        where a silent exception would be least expected. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart the search with these expressions?</DialogTitle>
            <DialogDescription>
              The face pattern is part of what the miner searches for, so changing it starts the
              search again from the beginning. Every result found so far is discarded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep mining</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false)
                onChange(draft)
              }}
            >
              Restart the search
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
