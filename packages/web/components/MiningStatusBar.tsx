'use client'

import { formatScore } from '@safe-vanity-blockie/core'
import { Info, Pause, Play, RotateCcw } from 'lucide-react'
import type { MineConfig } from '../lib/config'
import { formatDuration } from '../lib/format-duration'
import { DecorativeBlockie } from './Blockie'
import { CopyButton } from './CopyButton'
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

function formatRate(rate: number): string {
  return rate >= 1e6 ? `${(rate / 1e6).toFixed(2)}M/s` : `${Math.round(rate / 1000)}k/s`
}

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** An owner as a chip: the identicon it produces, then the address it is. */
function OwnerChip({ address }: { address: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-1.5 py-0.5">
      <DecorativeBlockie
        address={address}
        size={16}
        slot="summary-identicon"
        className="size-4 rounded-sm"
      />
      <span className="font-mono text-xs">{truncate(address)}</span>
    </span>
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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
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
}: {
  status: MiningStatus
  /** The config being mined, summarised on the bar's second line. */
  config: MineConfig
  /** How many results are on screen — the number the confirmation puts at stake. */
  resultCount: number
  onPauseToggle: () => void
  /** Throws the run away and brings the Configure card back. */
  onStartOver: () => void
}) {
  // The question, and the rule about when it is worth asking, are shared with the app title in the
  // header — the other door onto this same reset. See StartOverDialog.
  const { request, dialog } = useStartOverConfirm(onStartOver)
  const hasBest = status.bestScore !== undefined && status.bestMaxScore !== undefined
  const started = status.running || status.paused || status.scanned > 0

  return (
    // `top-14` matches the sticky header's `h-14` in app/layout.tsx: with `top-0` the bar would
    // pin underneath it and be invisible for the whole run. z-40 keeps it below the header.
    <div className="sticky top-14 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2">
        <div data-slot="status-row" className="flex flex-wrap items-center gap-3 text-sm">
          {/* No progress bar, and the percentage is labelled: a filled track next to a bare "90.2%"
              reads as "the run is 90% done", which is not a number this search can have — the
              keyspace is 2^256 wide and nothing is being counted down. What the number actually
              measures is how close the best result found is to a perfect match. */}
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

          <span className="text-muted-foreground">
            {status.scanned.toLocaleString('en-US')} nonces
          </span>
          {/* Zero while paused, and not the average of the segment that just ended: nothing is
              being scanned, so a speed is a claim about work that is not happening — sitting
              unchanged next to a button offering to resume it. The count and the clock beside it
              are cumulative facts about the run and stay where they are; this is the one figure on
              the bar that describes the current moment. */}
          <span className="text-muted-foreground">
            {formatRate(status.paused ? 0 : status.rate)}
          </span>
          <span className="text-muted-foreground">{status.workers} workers</span>
          {/* Gated on `started` — the same condition the controls use — because a clock reading
              "0s elapsed" before anything has been mined claims a run that does not exist. The
              count and rate can honestly read zero; a duration cannot. */}
          {started && (
            <span className="text-muted-foreground tabular-nums">
              {`${formatDuration(status.elapsedMs)} elapsed`}
            </span>
          )}

          {started && (
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onPauseToggle}>
                {status.paused ? (
                  <>
                    <Play className="mr-1 size-3" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="mr-1 size-3" /> Pause
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Both controls hard right, one per row. Pause sits with the counters it acts on; Start
            over sits a row below with the config it discards, and one step quieter. Side by side
            they were a pixel apart in position and a whole run apart in consequence. The resume
            point joins that row rather than the counters above: it belongs with the things you
            reach for when you are done with this run, not with the figures that tick. */}
        <div data-slot="status-row" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ConfigSummary config={config} />
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Gated on `scanned`, not on the value: the blocks are handed out before any nonce
                is tried, so `nextStartFrom` already stands a whole block per worker above the
                configured start when nothing has been reported — "Resume from 4,041,200,000,000"
                over a run that has mined nothing is a claim about progress that has not
                happened, and the size of the number makes it a worse one. */}
            {status.scanned > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span>Resume from</span>
                {/* Grouped for the eye and monospaced so the digits line up between publishes;
                    `tabular-nums` stops the number jittering as it grows. What goes on the
                    clipboard is the bare digits — see the CopyButton below. */}
                <span className="font-mono tabular-nums text-foreground">
                  {status.nextStart.toLocaleString('en-US')}
                </span>
                <CopyButton
                  // Digits only. This value's destination is `--start`, and the CLI parses that
                  // with Number: a grouped "4,200,500" would be read as 4 and silently rescan
                  // the whole run.
                  value={String(status.nextStart)}
                  label="Copy resume point"
                  copiedMessage="Resume point copied"
                  failedMessage="Could not copy automatically. Select the number and copy it manually."
                />
                <HintPopover
                  label="What the resume point means"
                  side="top"
                  align="end"
                  content={
                    <p className="max-w-xs text-sm">
                      Where a follow-up run should pick this search up: the highest end position any
                      one of this run's {status.workers} worker
                      {status.workers === 1 ? '' : 's'} reached. Nothing already scanned is
                      rescanned — but this is not a measure of how far the search got, and it sits
                      far above the nonce count beside it, because the workers' blocks lie side by
                      side rather than end to end. Coverage is not complete either: each worker
                      keeps to a block of its own, so whatever its neighbours had not reached when
                      the run stopped is skipped rather than picked up later, and resuming with a
                      different worker count skips a different amount.
                    </p>
                  }
                >
                  <Info aria-hidden="true" className="size-3.5" />
                </HintPopover>
              </div>
            )}
            {started && (
              /* Available while paused too: it is the only route back to the form. */
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => request(resultCount)}
              >
                <RotateCcw className="mr-1 size-3" /> Start over
              </Button>
            )}
          </div>
        </div>
      </div>

      {dialog}
    </div>
  )
}
