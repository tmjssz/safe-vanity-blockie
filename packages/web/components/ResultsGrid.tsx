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
  /**
   * The run's prerequisites are still being read — Safe constants, without which mining cannot
   * start. Separate from `mining` rather than folded into it, because the two are different facts
   * and one of them is used for more than the placeholders: the excluded-everything copy promises
   * "Mining continues", which is not true yet while the constants are still being fetched.
   *
   * For the grid, though, they are the same state — work is underway and nothing has arrived — so
   * both raise the placeholders. Without this, the seconds before the first candidate showed "No
   * results yet." over an empty grid, which reads as a finished search that found nothing.
   */
  preparing?: boolean
  /** The filters that produced this view, so the empty state can name what is excluding things. */
  filters: FaceFilters
  /** Highest contrast among candidates the other filters accept; see MinerState.bestContrast. */
  bestContrast?: number
  /**
   * The Safe currently being deployed, if any. An address rather than an index: the leaderboard
   * re-sorts under the user while a deploy runs, so a position would follow the wrong picture
   * within a second.
   */
  deployingAddress?: string
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
  preparing = false,
  filters,
  bestContrast,
  deployingAddress,
  onSelect,
}: ResultsGridProps) {
  // Three states, and the difference between the first two is the whole point: candidates found
  // but all excluded is not "still looking". A skeleton row there would promise results that are
  // never coming, which is exactly how the filter came to look broken.
  const excludedEverything = candidates.length === 0 && droppedCount > 0
  // `working`, not `mining`: reading the Safe constants is the same thing to someone watching this
  // grid — the run is under way and the first tile has not landed. It stays out of
  // `excludedEverything`, which cannot be true before a single candidate has been scored.
  const working = mining || preparing
  const showSkeletons = working && candidates.length === 0 && !excludedEverything

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
      {!working && candidates.length === 0 && !excludedEverything && (
        <p className="text-sm text-muted-foreground">No results yet.</p>
      )}
      {/* Five to a row on a desktop, and a close gap, so the section reads as a wall of blockies
          rather than a list of cards — the picture is the only thing being compared here. `gap-3`
          rather than the `gap-2` this started at: at 8px the tiles read as one mass with seams in
          it, and each card already carries a border, so the gap was doing less separating than the
          border was. 12px lets each one be a thing without the grid becoming a list. The steps
          down are what stop a tile shrinking past its picture on a narrow viewport: two across is
          the floor, because one across is a list again.
          Five from `xl` rather than `2xl`: the page container caps at `max-w-6xl`, so the grid
          stops growing at 1120px however wide the window gets, and five tiles are a little over
          210px each there — the same size they would be on a 4K screen. Waiting for 1536 would
          leave every ordinary laptop on four for no gain in tile size.

          The placeholders are children of this same grid, so they inherit this gap and cannot
          drift from it — which is the point: the wait and the results are the same layout. */}
      <div
        data-testid="results-grid"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        {candidates.map((candidate) => (
          <ResultCard
            key={candidate.address}
            candidate={candidate}
            // Read here rather than inside the tile: whether "two colours" says anything about a
            // result is a property of the filters, which the tile has no reason to know about.
            filterGuaranteesTwoColour={filters.twoColor}
            // Compared here so each tile gets a boolean: a shared address string would re-render
            // every memoised tile in the grid whenever the deploy target changed.
            deploying={candidate.address === deployingAddress}
            onSelect={onSelect}
          />
        ))}
        {showSkeletons &&
          SKELETON_KEYS.map((key) => (
            // One plain box per cell, the size of a whole tile. This drew three shapes before — a
            // square for the picture and two short bars for the lines under it — which is more
            // detail than a placeholder has any way to be right about, and it read as a wireframe
            // of a card rather than as a card on its way.
            //
            // The size is not a guessed number. The spacers inside are the tile's own parts
            // wearing the tile's own classes — the square picture, then the two 11px rows — inside
            // the card's border, padding and gap. None of them paints anything, so what shows is a
            // single rounded rectangle exactly as tall as the card that replaces it. That is the
            // property worth keeping: a placeholder shorter or taller than the real thing makes
            // the whole grid jump the moment the first result lands, which is how the old tall
            // version came to be replaced.
            //
            // `border-transparent` rather than no border, because backgrounds paint under the
            // border box: it holds the card's 1px on every side without drawing it, so the box is
            // the card's full footprint and not 2px short of it.
            <Skeleton
              key={key}
              data-testid="result-skeleton"
              className="flex flex-col gap-1.5 rounded-xl border border-transparent p-2.5"
            >
              <span className="aspect-square w-full" />
              <span className="text-[11px] leading-tight">&nbsp;</span>
              {/* A <code>, like the address row it stands in for: `text-[11px]` sets the size and
                  leaves the line height to the cascade, so the row's height depends on the font in
                  it — and the real row is monospace. A <span> here was a pixel or two short. */}
              <code className="text-[11px]">&nbsp;</code>
            </Skeleton>
          ))}
      </div>
    </div>
  )
}
