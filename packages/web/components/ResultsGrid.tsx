import type { Candidate } from '@safe-vanity-blockie/core'
import type { FaceFilters } from '../lib/config'
import { ResultCard } from './ResultCard'
import { Skeleton } from './ui/skeleton'

/** How many placeholder cards to show while mining hasn't turned up a candidate yet. */
const SKELETON_COUNT = 4

export interface ResultsGridProps {
  candidates: Candidate[]
  /**
   * How many retained candidates the filters removed. With the fallback off (see use-miner), an
   * empty `candidates` alongside a non-zero count means something quite different from an empty
   * one: candidates were found and every one of them was excluded, rather than none found yet.
   */
  droppedCount: number
  mining: boolean
  /** The filters that produced this view, so the empty state can name what is excluding things. */
  filters: FaceFilters
  /** Highest contrast among candidates the other filters accept; see MinerState.bestContrast. */
  bestContrast?: number
  onSelect: (candidate: Candidate) => void
}

/** Reads back the active filters as prose, so the empty state names the control to reach for. */
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
      {/* Not shown over an empty grid: the empty state below carries the same number, and two
          counts for one population read as two populations. */}
      {droppedCount > 0 && candidates.length > 0 && (
        <p className="mb-2 text-sm text-muted-foreground">
          {droppedCount.toLocaleString('en-US')} filtered out
        </p>
      )}
      {excludedEverything && (
        // role="status" so the announcement follows a filter change: dragging the contrast slider
        // past the last match empties the grid, and a sighted user sees that happen.
        <div role="status" className="rounded-xl border border-dashed p-6 text-sm">
          <p className="font-medium">No result matches these filters.</p>
          <p className="mt-1 text-muted-foreground">
            {droppedCount.toLocaleString('en-US')}{' '}
            {droppedCount === 1 ? 'candidate has' : 'candidates have'} been found so far, and{' '}
            {droppedCount === 1 ? 'it was' : 'all of them were'} excluded by{' '}
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
          Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <div key={index} data-testid="result-skeleton">
              <Skeleton className="h-72 w-full rounded-xl" />
            </div>
          ))}
      </div>
    </div>
  )
}
