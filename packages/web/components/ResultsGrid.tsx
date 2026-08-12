import type { Candidate } from '@safe-vanity-blockie/core'
import { ResultCard } from './ResultCard'
import { Skeleton } from './ui/skeleton'

/** How many placeholder cards to show while mining hasn't turned up a candidate yet. */
const SKELETON_COUNT = 4

export interface ResultsGridProps {
  candidates: Candidate[]
  droppedCount: number
  mining: boolean
  onSelect: (candidate: Candidate) => void
}

export function ResultsGrid({ candidates, droppedCount, mining, onSelect }: ResultsGridProps) {
  const showSkeletons = mining && candidates.length === 0

  return (
    <div>
      {droppedCount > 0 && (
        <p className="mb-2 text-sm text-muted-foreground">
          {droppedCount.toLocaleString('en-US')} filtered out
        </p>
      )}
      {!mining && candidates.length === 0 && (
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
