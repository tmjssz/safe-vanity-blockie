import { type Candidate, formatScore } from '@safe-vanity-blockie/core'
import { memo } from 'react'
import { Blockie } from './Blockie'
import { Badge } from './ui/badge'
import { Card } from './ui/card'

export interface ResultCardProps {
  candidate: Candidate
  /** Opens the deploy dialog for this candidate; see ResultsGrid and app/page.tsx. */
  onSelect: (candidate: Candidate) => void
}

/**
 * Memoised because the grid holds every retained candidate — up to 200 cards, each an inline blo
 * SVG of ~64 <rect>s — and re-renders on every worker progress message, many times a second. The
 * leaderboard hands back its stored candidate objects, so a card whose candidate did not change
 * gets the identical object and skips the redraw entirely. That only holds while `onSelect` is
 * stable too: ResultsGrid passes the callback straight through and the page holds it in a state
 * setter, so a per-card arrow function anywhere along that path would quietly undo this.
 */
export const ResultCard = memo(function ResultCard({ candidate, onSelect }: ResultCardProps) {
  const expression = Object.values(candidate.regions).join('/') || '—'
  const score = formatScore(candidate.score, candidate.maxScore)
  // Unique per grid without useId: ResultsGrid already keys these cards by address, so two cards
  // with the same address cannot be on screen at once.
  const traitsId = `result-traits-${candidate.address}`

  return (
    // The whole card is the control: there is nothing else on it to click, so a real <button>
    // (rather than a div with an onClick) buys keyboard activation and the button role for free.
    // `asChild` keeps the card's own styling on the element the user actually clicks and focuses,
    // and every visual class goes through Card's `cn()` so the overrides here win the tailwind
    // merge — Slot only concatenates classNames, it does not resolve conflicts between them.
    <Card
      asChild
      className="w-full cursor-pointer items-stretch gap-3 py-4 text-left outline-none transition-colors hover:border-ring hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <button
        type="button"
        // Up to two hundred cards on screen at once, so "which result is this?" has to be in the
        // name itself: the score identifies it at a glance and the address identifies it exactly.
        // Falling back to the card's own contents would name it after the identicon's alt text
        // and read the address out twice.
        aria-label={`Deploy ${score} match ${candidate.address}`}
        // An explicit aria-label overrides the card's contents, which would otherwise silence the
        // three badges below — a screen-reader user could no longer tell a two-colour result from
        // a three-colour one, or compare contrast, without opening the deploy dialog. They were
        // plain text next to a separate button before; this keeps them announced, as the
        // description rather than as part of the name.
        aria-describedby={traitsId}
        // Set by hand for the same reason DeployPanel's trigger used to: the dialog is rendered
        // by the page, not as a child of this component, so there is no DialogTrigger to supply
        // it. There is deliberately no aria-expanded — this control has no expanded state of its
        // own; the page owns which candidate (if any) is open.
        aria-haspopup="dialog"
        onClick={() => onSelect(candidate)}
      >
        {/* Spans rather than CardHeader/CardContent divs: a <button>'s content model is phrasing
            content, and these are flex items either way. */}
        <span className="px-4 text-lg font-semibold">{score}</span>
        <span className="flex flex-col items-center gap-3 px-4">
          <Blockie address={candidate.address} size={128} />
          <span id={traitsId} className="flex flex-wrap items-center justify-center gap-1.5">
            <Badge variant="secondary">{expression}</Badge>
            <Badge variant={candidate.twoColor ? 'secondary' : 'outline'}>
              {candidate.twoColor ? 'two colours' : 'three colours'}
            </Badge>
            <Badge variant="outline">contrast {candidate.contrast}</Badge>
          </span>
          <code className="w-full break-all text-center text-xs text-muted-foreground">
            {candidate.address}
          </code>
          <code className="text-xs text-muted-foreground">saltNonce {candidate.saltNonce}</code>
        </span>
      </button>
    </Card>
  )
})
