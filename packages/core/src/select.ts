import type { Candidate } from './miner.js'

export function filterCandidates(
  candidates: Candidate[],
  filters: { twoColor: boolean; minContrast: number },
): Candidate[] {
  return candidates.filter(
    (candidate) =>
      (!filters.twoColor || candidate.twoColor) && candidate.contrast >= filters.minContrast,
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
 * Retention is score-ranked and blind to twoColor/minContrast, which are applied here — so
 * callers must retain far more candidates than they intend to display, or the filters will
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
    keep: number
    fallbackWhenEmpty?: boolean
  },
): SelectReportedResult {
  const filtered = filterCandidates(candidates, {
    twoColor: options.twoColor,
    minContrast: options.minContrast,
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
  if (maxScore <= 0) return '0.0%'
  return `${((score / maxScore) * 100).toFixed(1)}%`
}
