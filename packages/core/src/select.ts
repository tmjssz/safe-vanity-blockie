import type { Candidate } from './miner.js'

/**
 * A score as a percentage of the template's maximum, rounded to the one decimal a result is
 * displayed with. `formatScore` renders exactly this number, and `filterCandidates` compares
 * exactly this number against the match floor, so the figure on a tile and the figure the filter
 * judges it by are the same figure: 89.96% displays as "90.0%" and must not then be dropped by a
 * 90% floor over a difference nothing on screen can show.
 */
export function scorePercent(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0
  return Number(((score / maxScore) * 100).toFixed(1))
}

export function filterCandidates(
  candidates: Candidate[],
  filters: { twoColor: boolean; minContrast: number; minMatch?: number },
): Candidate[] {
  const minMatch = filters.minMatch ?? 0
  return candidates.filter(
    (candidate) =>
      (!filters.twoColor || candidate.twoColor) &&
      candidate.contrast >= filters.minContrast &&
      scorePercent(candidate.score, candidate.maxScore) >= minMatch,
  )
}

export interface SelectReportedResult {
  reported: Candidate[]
  /** How many candidates the filters removed. Zero when the fallback was used. */
  droppedCount: number
  /** True when filtering removed everything and the unfiltered list is being shown instead. */
  usedFallback: boolean
}

/**
 * Retention is score-ranked and blind to twoColor/minContrast/minMatch, which are applied here —
 * so callers must retain far more candidates than they intend to display, or the filters will
 * have nothing left to choose from.
 *
 * `fallbackWhenEmpty` defaults to true, which shows the unfiltered list rather than nothing when
 * the filters match no candidate at all. That suits a caller that can say so alongside the
 * results — the CLI prints a notice when `usedFallback` comes back true. A caller that can render
 * an explicit "nothing matches these filters" state should pass false instead: silently showing
 * everything makes the filter look ignored rather than unsatisfied. With it off, `droppedCount`
 * stops being a special case and always reports what the filters actually removed.
 */
export function selectReported(
  candidates: Candidate[],
  options: {
    twoColor: boolean
    minContrast: number
    /** Percentage floor, 0-100, judged as `scorePercent`. Omitted or 0 filters nothing. */
    minMatch?: number
    keep: number
    fallbackWhenEmpty?: boolean
  },
): SelectReportedResult {
  const filtered = filterCandidates(candidates, {
    twoColor: options.twoColor,
    minContrast: options.minContrast,
    minMatch: options.minMatch,
  })
  const usedFallback =
    (options.fallbackWhenEmpty ?? true) && filtered.length === 0 && candidates.length > 0
  const usable = usedFallback ? candidates : filtered
  const droppedCount = usedFallback ? 0 : candidates.length - filtered.length
  return { reported: usable.slice(0, options.keep), droppedCount, usedFallback }
}

/**
 * A score as a percentage of the template's maximum. One decimal, because the interesting
 * results sit in a narrow band near the top and whole percent would collapse distinct scores.
 */
export function formatScore(score: number, maxScore: number): string {
  return `${scorePercent(score, maxScore).toFixed(1)}%`
}
