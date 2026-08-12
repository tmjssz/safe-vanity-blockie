'use client'

import { formatScore } from '@safe-vanity-blockie/core'
import { Pause, Play } from 'lucide-react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Progress } from './ui/progress'

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
  bestScore?: number
  bestMaxScore?: number
}

function formatRate(rate: number): string {
  return rate >= 1e6 ? `${(rate / 1e6).toFixed(2)}M/s` : `${Math.round(rate / 1000)}k/s`
}

export function MiningStatusBar({
  status,
  onPauseToggle,
}: {
  status: MiningStatus
  onPauseToggle: () => void
}) {
  const hasBest = status.bestScore !== undefined && status.bestMaxScore !== undefined
  const percent = hasBest
    ? Math.min(100, Math.max(0, (status.bestScore! / status.bestMaxScore!) * 100))
    : 0
  const started = status.running || status.paused || status.scanned > 0

  return (
    // `top-14` matches the sticky header's `h-14` in app/layout.tsx: with `top-0` the bar would
    // pin underneath it and be invisible for the whole run. z-40 keeps it below the header.
    <div className="sticky top-14 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        {hasBest ? (
          <>
            <Badge variant="secondary" className="font-mono">
              {formatScore(status.bestScore!, status.bestMaxScore!)}
            </Badge>
            <Progress value={percent} className="hidden h-2 w-32 sm:block" />
          </>
        ) : (
          <span className="text-muted-foreground">No candidates yet</span>
        )}

        <span className="text-muted-foreground">
          {status.scanned.toLocaleString('en-US')} nonces
        </span>
        <span className="text-muted-foreground">{formatRate(status.rate)}</span>
        <span className="text-muted-foreground">{status.workers} workers</span>

        {started && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onPauseToggle}
          >
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
        )}
      </div>
    </div>
  )
}
