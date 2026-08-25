'use client'

import { formatScore } from '@safe-vanity-blockie/core'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { abbreviateNumber } from '../lib/abbreviate-number'
import type { MineConfig } from '../lib/config'
import { formatDuration } from '../lib/format-duration'
import { DecorativeBlockie } from './Blockie'
import { CheckpointTrigger } from './CheckpointTrigger'
import { MiningActivity } from './MiningActivity'
import { useStartOverConfirm } from './StartOverDialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { HintPopover } from './ui/hint-popover'

/**
 * The page renders an empty element with this id at the very top of the layout, and MiningView —
 * which owns the mining state this bar displays, and belongs down with the results — portals the
 * bar into it. Declared here, next to the bar itself, so the page can render the slot without
 * importing MiningView's module.
 */
export const MINING_STATUS_BAR_SLOT_ID = 'mining-status-bar-slot'

export interface MiningStatus {
  running: boolean
  paused: boolean
  scanned: number
  rate: number
  workers: number
  /** Active mining time — see use-miner: time spent paused is not counted. */
  elapsedMs: number
  /**
   * The best candidate found, from the unfiltered board. Undefined only when nothing has been
   * found at all — never merely because the filters exclude everything.
   */
  bestScore?: number
  bestMaxScore?: number
  /**
   * Where a follow-up run should begin: the highest end position any worker reached (see
   * `nextStartFrom`). Required rather than optional — a bar that silently omitted it would be a
   * run whose progress cannot be handed on, which is exactly the failure this reports against.
   */
  nextStart: number
}

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * An owner as a badge: the identicon it produces, then the address it is.
 *
 * The same `secondary` Badge the best result wears on the row above, so the two values the bar
 * carries about this run are drawn as one shape rather than each in a box of its own. No border:
 * the variant fills instead of outlining, which is what keeps a lone pill on a line of plain text
 * from reading as a control.
 *
 * `gap-1.5` over the badge's own `gap-1`, and it is the identicon that earns it: 4px is spacing
 * between words, and this is a picture set against them.
 */
function OwnerChip({ address }: { address: string }) {
  return (
    <Badge variant="secondary" className="gap-1.5">
      <DecorativeBlockie
        address={address}
        size={16}
        slot="summary-identicon"
        className="size-4 rounded-sm"
      />
      {/* The badge sets the size; this sets the face, the same way the best result's does. */}
      <span className="font-mono">{truncate(address)}</span>
    </Badge>
  )
}

/**
 * What is being mined, on a second line under the counters.
 *
 * It exists because the Configure card is unmounted for the whole run: without this there is no
 * way to check what you set without discarding the run to look, which is exactly what a user
 * watching a long search must not have to do.
 *
 * Only the first owner gets a chip. Three addresses would wrap the bar onto a third line and none
 * of them is more informative than the count beside it — but the rest stay *reachable* rather than
 * dropped, behind a "+N more" that opens on hover, click or focus. The chain is deliberately
 * absent: it is in the header, permanently and changeably, and a second copy of a live value is
 * two things to keep in step.
 */
function ConfigSummary({ config }: { config: MineConfig }) {
  const [first, ...rest] = config.owners
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
      <span>Mining for</span>
      {first && <OwnerChip address={first} />}
      {rest.length > 0 && (
        <HintPopover
          label={`Show ${rest.length} more owner${rest.length === 1 ? '' : 's'}`}
          side="bottom"
          align="start"
          className="underline-offset-4 hover:text-foreground hover:underline"
          contentClassName="w-auto max-w-none"
          content={
            /* Each owner with the identicon it produces. Without them this is four lines of
               near-identical hex, which is the reading problem the blockie exists to solve — and
               it is the same picture the user will be checking a result against. */
            <ul className="flex flex-col gap-1.5">
              {config.owners.map((owner) => (
                <li key={owner} className="flex items-center gap-2">
                  <DecorativeBlockie
                    address={owner}
                    size={16}
                    slot="owner-list-identicon"
                    className="size-4 rounded-sm"
                  />
                  <span className="font-mono text-xs">{owner}</span>
                </li>
              ))}
            </ul>
          }
        >
          +{rest.length} more
        </HintPopover>
      )}
      <span aria-hidden="true">·</span>
      {/* Always "signers", including at 1 of 1. "N of M signers" is the standard way a multisig
          threshold is written and reads as a fixed phrase; pluralising it to "1 of 1 signer"
          makes the one-owner case look like a different kind of statement. */}
      <span>
        {config.threshold} of {config.owners.length} signers
      </span>
      <span aria-hidden="true">·</span>
      <span>Safe {config.safeVersion}</span>
    </div>
  )
}

export function MiningStatusBar({
  status,
  config,
  resultCount,
  onPauseToggle,
  onStartOver,
  onShowCommand,
}: {
  status: MiningStatus
  /** The config being mined, summarised on the bar's second line. */
  config: MineConfig
  /** How many results are on screen — the number the confirmation puts at stake. */
  resultCount: number
  onPauseToggle: () => void
  /** Throws the run away and brings the Configure card back. */
  onStartOver: () => void
  /**
   * Raises the "Run on your machine" dialog, which the checkpoint panel links to. The bar owns
   * neither the dialog nor the state that opens it — both belong to MiningView, which renders
   * this bar and the handoff alike — so this is the hop between them.
   */
  onShowCommand: () => void
}) {
  // The question, and the rule about when it is worth asking, are shared with the app title in
  // the header, the other door onto this same reset. See StartOverDialog.
  const { request, dialog } = useStartOverConfirm(onStartOver)
  const hasBest = status.bestScore !== undefined && status.bestMaxScore !== undefined
  const started = status.running || status.paused || status.scanned > 0
  const scannedTitle = `${status.scanned.toLocaleString('en-US')} nonces checked`
  // The abbreviated figure and the exact one come from the same number, so the tooltip cannot
  // drift from what it is explaining.
  const scannedAbbrev = abbreviateNumber(status.scanned)
  // Guards the same way abbreviateNumber does: the rate is `(scanned / elapsedMs) * 1000`, which
  // is NaN on a tick where no time has passed. Without this guard the abbreviated figure reads
  // "0/s" while the tooltip beside it reads "NaN nonces per second".
  const exactRate = Number.isFinite(status.rate) && status.rate > 0 ? Math.round(status.rate) : 0
  const rateTitle = `${exactRate.toLocaleString('en-US')} nonces per second`

  return (
    // `top-14` matches the sticky header's `h-14` in app/layout.tsx: with `top-0` the bar would
    // pin underneath it and be invisible for the whole run. z-40 keeps it below the header.
    <div className="sticky top-14 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* `gap-2` between the rows rather than the 4px they had: the second line is a different
          kind of statement from the first — what is being mined, against how it is going — and at
          4px the two read as one block of text that happens to wrap. It is a fixed gap, so it
          costs the same in every state and cannot reintroduce the shift `min-h-6` below removes. */}
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2">
        <div data-slot="status-row" className="flex flex-wrap items-center gap-3 text-sm">
          {started && (
            /* The row reads left to right as "what you can do about this run", then "what the
               run has done". The controls lead because they are the half a user acts on, and
               they sit at the edge a pointer travels least to reach. Pause is the nearer of the
               two, because it is the one reached for dozens of times a run and Start over is the
               one that ends it — which is also why there is a whole `gap-4` between them rather
               than the 8px a button group would normally take. They are not a pair of related
               actions; one of them throws the run away, and a few pixels is the whole margin for
               error on a control that does not ask twice about the results below it. */
            <div data-slot="status-controls" className="flex items-center gap-4">
              {/* One slot, two labels. `min-w-28` is what makes it one slot: "Pause" and
                  "Resume" are different lengths, and without a floor on the width Start over
                  steps sideways every time the state flips, out from under the pointer that is
                  about to click it. 24 (96px) does not clear "Resume" set in every fallback
                  sans-serif Tailwind's default stack can land on: DejaVu Sans measures ~57px
                  against a 42px fixed overhead, for ~99px total; 28 (112px) clears that with
                  room to spare. */}
              <Button
                variant={status.paused ? 'default' : 'outline'}
                size="sm"
                className="min-w-28"
                onClick={onPauseToggle}
              >
                {status.paused ? (
                  <>
                    <Play className="size-3" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="size-3" /> Pause
                  </>
                )}
              </Button>
              {/* Available while paused too: it is the only route back to the form. Quieter than
                  its neighbour, because it is the one with consequences. */}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => request(resultCount)}
              >
                <RotateCcw className="mr-1 size-3" /> Start over
              </Button>
            </div>
          )}

          {/* Everything the run has to report, as one group hard right, so the figures end at the
              same edge whatever the state adds or removes from the middle of them. */}
          <div
            data-slot="status-stats"
            className="ml-auto flex flex-wrap items-center justify-end gap-3"
          >
            {/* No progress bar, and the percentage is labelled: a filled track next to a bare
              "90.2%" reads as "the run is 90% done", which is not a number this search can have.
              The keyspace is 2^256 wide and nothing is being counted down. What the number
              actually measures is how close the best result found is to a perfect match. */}
            {hasBest ? (
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">Best result</span>
                <Badge variant="secondary" className="font-mono">
                  {formatScore(status.bestScore!, status.bestMaxScore!)}
                </Badge>
              </span>
            ) : (
              <span className="text-muted-foreground">No candidates yet</span>
            )}

            {/* Two shapes for one pair of facts. While the search works, the count is a figure
              that is still moving and the clock is a separate one moving beside it. Once it
              stops, both are finished totals about the same stopped run, and reading them as one
              sentence is what a stopped run has to say. The clock is frozen either way: see
              use-miner, which does not bill time spent paused as mining time. */}
            {status.paused ? (
              // The abbreviation and the " checked in <duration>" wording both sit inside the
              // aria-hidden span, alongside the sr-only exact figure, rather than as an exposed
              // sibling: a sibling text node is still in the accessibility tree even next to a
              // hidden one, and "nonces checked" from the sr-only span followed by an exposed
              // "checked in" would read as "nonces checked checked in" to a screen reader.
              <span data-slot="stat-scanned" title={scannedTitle} className="text-muted-foreground">
                <span aria-hidden="true">
                  <span className="font-mono tabular-nums text-foreground">{scannedAbbrev}</span>
                  {' checked in '}
                  <span className="tabular-nums">{formatDuration(status.elapsedMs)}</span>
                </span>
                <span className="sr-only">
                  {scannedTitle} in {formatDuration(status.elapsedMs)}
                </span>
              </span>
            ) : (
              <>
                {/* See the paused branch above for why the trailing " checked" is folded into the
                  aria-hidden span rather than left exposed beside the sr-only copy. */}
                <span
                  data-slot="stat-scanned"
                  title={scannedTitle}
                  className="text-muted-foreground"
                >
                  <span aria-hidden="true">
                    <span className="font-mono tabular-nums text-foreground">{scannedAbbrev}</span>
                    {' checked'}
                  </span>
                  <span className="sr-only">{scannedTitle}</span>
                </span>
                {/* Absent while paused rather than zero. Nothing is being scanned, so a speed is a
                  claim about work that is not happening, and "0k/s" is that claim with a number
                  on it: it reads as a search that is running and getting nowhere, sitting next
                  to a button offering to resume it. The count and the clock are cumulative facts
                  about the run and stay; this is the one figure on the bar that describes the
                  current moment, and while paused there is no such moment to describe. */}
                <span
                  data-slot="stat-rate"
                  title={rateTitle}
                  className="font-mono tabular-nums text-foreground"
                >
                  {/* Two decimals, where the count above takes one. The count is abbreviated
                    to stop it reflowing the row; the rate never ran to eleven digits, and it
                    is the one figure here that describes the current moment — at one decimal
                    every speed from 1.00M/s to 1.04M/s reads the same frozen "1.0M/s". */}
                  <span aria-hidden="true">{abbreviateNumber(status.rate, 2)}/s</span>
                  <span className="sr-only">{rateTitle}</span>
                </span>
              </>
            )}
            {/* The first thing to go when the row runs short, and the last thing to be missed: the
              pool size is the only figure here that cannot change for the length of a run. The
              clock goes next, at the narrower breakpoint, because it at least keeps moving. */}
            <span data-slot="stat-workers" className="hidden text-muted-foreground md:inline">
              {status.workers} workers
            </span>
            {/* Gated on `started`, the same condition the controls use, because a clock reading
              "0s" before anything has been mined claims a run that does not exist. The count and
              rate can honestly read zero; a duration cannot. While paused the clock is inside
              the item above instead, so this is the running case only. */}
            {started && !status.paused && (
              <span
                data-slot="stat-elapsed"
                className="hidden text-muted-foreground tabular-nums sm:inline"
              >
                {formatDuration(status.elapsedMs)}
              </span>
            )}
            {/* Last on the row, and never dropped: it is the one item here that reports whether
              any of the others are still being added to.

              The slot is a floor on the width because the two variants are not the same size —
              an 18px square while mining, two bars and the word "Paused" once it stops — and
              without it every figure to the left slides sideways on every pause. 20 (80px)
              clears the wider one in the fallback stacks Tailwind's default can land on: "Paused"
              measures ~57px in DejaVu Sans, against 9px of bars and a 6px gap. Its content is
              pushed right inside it, so whichever variant is showing ends at the same edge.

              Nothing at all before a run exists: an animated "mining" glyph over a search that
              has not begun, or one a worker error has stopped, is this indicator asserting
              exactly the thing it is for, wrongly. */}
            {(status.running || status.paused) && (
              <span data-slot="status-indicator" className="flex min-w-20 justify-end">
                <MiningActivity paused={status.paused} />
              </span>
            )}
          </div>
        </div>

        {/* The config being mined at the left edge, and, once the search is stopped, where it
            stopped at the right one. The checkpoint is the only thing on this line that does
            something, and pinning it right keeps it out of the dot-separated facts, which are
            all things to read rather than to click — it also ends at the same edge the stats
            group above it does, so the bar has one right margin rather than two.

            `min-h-6` holds the line at one height whatever the state puts on it. The bar is
            sticky, so a row that grows shoves the whole page down under it; the floor is what
            keeps that guarantee from depending on which items happen to be present, and on the
            22px owner badge (16px of content, 4px of padding, 2px of border) staying the tallest
            of them. FaceSection's header holds its title still the same way.

            `flex-wrap` still applies below that: align-items works per flex line, so a summary
            wrapping to a second line on a narrow viewport is unaffected by the floor.

            `text-sm` sits on the row, not on the summary inside it, the same way the stats row
            above declares its own. It is load-bearing for the checkpoint trigger: that one is a
            plain button with no size of its own, and while it lived among the summary's facts it
            inherited theirs. Pinned to the far side of the row it is a sibling of the summary,
            and without this it would fall back to the page's 16px and sit a size above every
            other word on the bar. */}
        <div
          data-slot="status-row"
          className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        >
          <ConfigSummary config={config} />
          {/* Gated on `running`, not on `paused`: a worker error clears `running` and leaves
              `paused` false (see use-miner), and that is precisely the state whose on-screen
              advice is "reload the page" — the one moment this number is the only thing that can
              carry the run across. Gated on `scanned` too, not on the value: `nextStartFrom`
              hands out a whole block per worker before any nonce is tried, so a checkpoint over a
              run that has mined nothing is a claim about progress that has not happened, and the
              size of the number makes it a worse one. */}
          {!status.running && status.scanned > 0 && (
            <div className="ml-auto flex items-center">
              <CheckpointTrigger
                nextStart={status.nextStart}
                workers={status.workers}
                onShowCommand={onShowCommand}
              />
            </div>
          )}
        </div>
      </div>

      {dialog}
    </div>
  )
}
