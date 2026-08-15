import type { Candidate } from '@safe-vanity-blockie/core'
import type { FaceFilters } from '../lib/config'
import { ResultCard } from './ResultCard'
import { Skeleton } from './ui/skeleton'

/**
 * The placeholder cards shown while mining hasn't turned up a candidate yet. Held as keys rather
 * than a count so the render maps over a stable list: the placeholders are interchangeable and
 * never reorder, but keying them by array index is the pattern that goes wrong the moment a list
 * does reorder, so it isn't worth writing even here.
 */
const SKELETON_KEYS = ['a', 'b', 'c', 'd'].map((suffix) => `result-skeleton-${suffix}`)

export interface ResultsGridProps {
  candidates: Candidate[]
  /**
   * How many retained candidates the filters removed. With the fallback off (see use-miner), an
   * empty `candidates` alongside a non-zero count means something quite different from an empty
   * one: candidates were found and every one of them was excluded, rather than none found yet.
   * That distinction is the only thing this is still used for — the count itself is reported to
   * the user only in the empty state, where there are no cards to count instead.
   */
  droppedCount: number
  mining: boolean
  /** The filters that produced this view, so the empty state can name what is excluding things. */
  filters: FaceFilters
  /** Highest contrast among candidates the other filters accept; see MinerState.bestContrast. */
  bestContrast?: number
  onSelect: (candidate: Candidate) => void
}

/**
 * Reads back the active filters as prose, so the empty state names the control to reach for.
 *
 * The `'the current filters'` arm is a guard, not a live path: the only caller is the empty
 * state, which cannot be on screen unless a filter excluded something, and the one input that
 * reaches this arm — `twoColor: false, minContrast: 0` — filters nothing, so `droppedCount` is 0
 * and `excludedEverything` is false. It is here so a future caller cannot produce "excluded by .".
 */
function excludingFilters(filters: FaceFilters): string {
  const criteria = [
    filters.twoColor ? 'two colours only' : undefined,
    filters.minContrast > 0 ? `minimum contrast ${filters.minContrast}` : undefined,
  ].filter((criterion): criterion is string => criterion !== undefined)
  return criteria.length > 0 ? criteria.join(' and ') : 'the current filters'
}

export function ResultsGrid({
  candidates,
  droppedCount,
  mining,
  filters,
  bestContrast,
  onSelect,
}: ResultsGridProps) {
  // Three states, and the difference between the first two is the whole point: candidates found
  // but all excluded is not "still looking". A skeleton row there would promise results that are
  // never coming, which is exactly how the filter came to look broken.
  const excludedEverything = candidates.length === 0 && droppedCount > 0
  const showSkeletons = mining && candidates.length === 0 && !excludedEverything

  return (
    <div>
      {/* How many the filters removed is no longer reported over a populated grid at all: the
          Results heading badges what is *shown*, which is the number the eye can check against
          the cards. The excluded count survives only here, where there are no cards to count. */}
      {excludedEverything && (
        <div data-testid="no-matches" className="rounded-xl border border-dashed p-6 text-sm">
          {/* The live region is the headline and nothing else. The grid emptying is exactly what
              one is for — a sighted user watches it happen — but every number below changes on
              every publish and every step of the contrast slider, and each patch inside
              aria-live queues a fresh announcement of the whole message: dozens in one drag from
              300 to 442, and up to two hundred in the first seconds of a run with a strict
              filter. The headline does not change while the condition holds, so it is announced
              once, and the detail is read by navigating to it like any other text. */}
          <p role="status" className="font-medium">
            No result matches these filters.
          </p>
          <p className="mt-1 text-muted-foreground">
            {/* Not "N candidates have been found so far": N is the retained pool, which pins at
                the retention cap once the board fills, so that phrasing sits at a suspiciously
                round 200 for the rest of the run however many millions get scored — and reads as
                a stalled search. Naming which 200 they are says the same fact without implying a
                total. */}
            {droppedCount === 1
              ? 'The only candidate found so far was excluded by '
              : `The ${droppedCount.toLocaleString('en-US')} best candidates found so far were all excluded by `}
            {excludingFilters(filters)}.
            {bestContrast !== undefined && filters.minContrast > 0 && (
              <> The best contrast found so far is {bestContrast}.</>
            )}{' '}
            {mining
              ? 'Mining continues; relax a filter to see what has been found.'
              : 'Relax a filter to see what has been found.'}
          </p>
        </div>
      )}
      {!mining && candidates.length === 0 && !excludedEverything && (
        <p className="text-sm text-muted-foreground">No results yet.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {candidates.map((candidate) => (
          <ResultCard key={candidate.address} candidate={candidate} onSelect={onSelect} />
        ))}
        {showSkeletons &&
          SKELETON_KEYS.map((key) => (
            <div key={key} data-testid="result-skeleton">
              <Skeleton className="h-72 w-full rounded-xl" />
            </div>
          ))}
      </div>
    </div>
  )
}
