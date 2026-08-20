import { type Candidate, formatScore } from '@safe-vanity-blockie/core'
import { memo } from 'react'
import { Blockie } from './Blockie'
import { ContrastSwatch } from './ContrastSwatch'
import { CopyButton } from './CopyButton'
import { SpinnerOverlay } from './SpinnerOverlay'
import { Card } from './ui/card'

/**
 * Where the score badge turns from neutral to the accent colour. A wall of twenty-five blockies is
 * scanned rather than read, and the number's job there is to say "this one is worth a second look"
 * without the eye having to compare twenty-five three-digit figures. 90 is where a match stops
 * being approximate: below it at least one region has lost a whole feature.
 */
const QUALITY_THRESHOLD = 90

/**
 * Enough of the address to recognise a result by, in the width a compact tile has. The same
 * 6-and-4 split the mining status bar and the wallet chip use, so an address looks the same
 * wherever it is abbreviated. The full string is in the tile's accessible name and, in full and
 * checkable, in the detail view.
 */
function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export interface ResultCardProps {
  candidate: Candidate
  /**
   * Whether the two-colour filter is on, in which case every result on screen is two-colour and
   * marking each one distinguishes nothing. A boolean rather than the whole `FaceFilters` object
   * so the memo below keeps working: a new filters object arrives on every publish.
   */
  filterGuaranteesTwoColour: boolean
  /**
   * Whether THIS result is the one currently being deployed. One tile in the grid at most, and it
   * has to be findable without hovering anything: gas is being spent on it.
   */
  deploying?: boolean
  /** Opens the detail view for this candidate; see ResultsGrid and app/page.tsx. */
  onSelect: (candidate: Candidate) => void
}

/**
 * Memoised because the grid holds every retained candidate — up to 200 tiles, each an inline blo
 * SVG of ~64 <rect>s — and re-renders on every worker progress message, many times a second. The
 * leaderboard hands back its stored candidate objects, so a tile whose candidate did not change
 * gets the identical object and skips the redraw entirely. That only holds while the other two
 * props are stable too: `filterGuaranteesTwoColour` is a boolean for exactly that reason, and
 * ResultsGrid passes `onSelect` straight through to a state setter the page holds, so a per-tile
 * arrow function anywhere along that path would quietly undo this.
 */
export const ResultCard = memo(function ResultCard({
  candidate,
  filterGuaranteesTwoColour,
  deploying = false,
  onSelect,
}: ResultCardProps) {
  const expression = Object.values(candidate.regions).join('/') || '—'
  const percent = formatScore(candidate.score, candidate.maxScore)
  // The badge shows the number without its unit: twenty-five "%" signs to a screen are noise, and
  // the unit is in the tooltip and in the accessible name. Both the label and the threshold come
  // off the one formatted string, so the colour can never disagree with the digits above it —
  // 89.96 displays as "90.0" and must not then be coloured as though it had cleared 90.
  const value = percent.replace('%', '')
  const strong = Number.parseFloat(value) >= QUALITY_THRESHOLD
  // Marked only when it distinguishes something. With the filter on it is true of every tile.
  const markTwoColour = candidate.twoColor && !filterGuaranteesTwoColour
  // Unique per grid without useId: ResultsGrid already keys these tiles by address, so two tiles
  // with the same address cannot be on screen at once.
  const traitsId = `result-traits-${candidate.address}`
  const colourId = `result-colours-${candidate.address}`

  return (
    // A plain <div> card holding a stretched button, rather than a card that IS the button as it
    // was before: a <button> may not contain another, and the hover overlay adds a real control.
    // The surfaces still line up — the button is `inset-0` — so every pixel of the tile opens the
    // result, and `group` lets the card react to hover for it.
    <Card className="group relative gap-1.5 p-2.5 transition-colors hover:border-ring hover:bg-accent/40">
      <span className="relative block">
        {/* Dominant, and the full width of the tile: at five to a row the picture is the only
            thing being compared, so nothing else may take space from it. */}
        <Blockie
          address={candidate.address}
          className="block w-full overflow-hidden rounded-md [&>svg]:size-full"
        />
        {/* Not hover-gated, unlike the overlay below: the point is to find this tile in a wall of
            two hundred while scrolling past, without touching anything. */}
        {deploying && <SpinnerOverlay iconClassName="size-8" className="z-10 rounded-md" />}
        {/* Over the picture's top-right corner rather than beside it — a heading-sized percentage
            was most of the old tile's remaining height. The dark chrome is fixed in both themes
            because what sits behind it is a blockie's own colours, not the page. Above the hover
            overlay (z-30), so the score of the tile being deployed stays readable. */}
        <span
          data-testid="result-score"
          title={`${percent} match to the closest accepted expression`}
          className={`absolute top-1 right-1 z-30 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] leading-none font-medium tabular-nums ${
            strong ? 'text-emerald-300' : 'text-white/80'
          }`}
        >
          {value}
        </span>
        {markTwoColour && (
          // Diagonally opposite the score, in the same chrome, so the two read as one family of
          // marks on the picture rather than two inventions.
          <span
            id={colourId}
            className="absolute bottom-1 left-1 z-30 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] leading-none font-medium text-white/80"
          >
            two colours
          </span>
        )}
        {/* Nothing on a compact tile says what clicking it does — the words that said so are what
            the redesign removed — so the affordance appears on the picture itself.
            The layer itself NEVER takes a pointer — it sits above the tile's own button, so
            anything else means a click on the picture, or on the Deploy pill, lands on an inert
            span and does nothing at all. Only the copy control below opts back in. */}
        <span
          data-testid="result-overlay"
          className="pointer-events-none absolute inset-0 z-20 flex flex-row items-center justify-center gap-2 rounded-md bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {/* Decoration, not a control: it does exactly what the tile does, so a real button here
              would buy a second tab stop and a second announcement for one action. */}
          <span
            aria-hidden="true"
            className="rounded-md bg-white px-3 py-1 text-sm font-semibold text-black shadow-sm"
          >
            {/* Pressing it cannot start a second deploy — the page refuses, and says why — so
                offering to would be a lie. It goes back to the one already running. */}
            {deploying ? 'View the deploy' : 'Deploy'}
          </span>
          {/* The one thing the tile can do that opening it cannot: take the address away without
              a dialog. Beside the pill rather than under it — two rows of controls hid most of the
              picture they are drawn on. A sibling of the stretched button rather than a child, so
              a copy never also opens the result. */}
          <CopyButton
            value={candidate.address}
            label="Copy address"
            copiedMessage="Address copied"
            failedMessage="Could not copy the address. Open the result to copy it from there."
            // Light on the dimmed picture: the overlay behind it is already black, so the default
            // ghost button and a dark chip both disappeared into it.
            //
            // Interactive only while the overlay can be seen. Tailwind wraps `hover:` in
            // `@media (hover: hover)`, so on a touch device this never takes a pointer and a tap
            // aimed at the middle of the blockie reaches the tile's button — which is the point on
            // mobile, where the detail view is the deploy path.
            className="pointer-events-none bg-white/15 text-white group-hover:pointer-events-auto group-focus-within:pointer-events-auto hover:bg-white/30 hover:text-white"
          />
        </span>
      </span>
      {/* Two lines, both fixed height, so a row of tiles stays a grid rather than going ragged. */}
      <span
        id={traitsId}
        data-testid="result-meta"
        className="flex items-center justify-center gap-1 text-[11px] leading-tight"
      >
        <span className="truncate">{expression}</span>
        <span aria-hidden="true">·</span>
        <span
          className="inline-flex shrink-0 items-center gap-1"
          // The swatch carries the meaning for a sighted reader; spelling "contrast" out costs more
          // of a compact tile than the number is worth. Both audiences still get the word — this
          // on hover, the sr-only text below to a screen reader, which two rectangles tell nothing.
          title={`Colour contrast: ${candidate.contrast}`}
        >
          {/* Sized to the line it sits on, at the 2:1 shape the filter's own preview uses. */}
          <ContrastSwatch distance={candidate.contrast} className="h-[11px] w-[22px]" />
          <span className="sr-only">Colour contrast </span>
          {candidate.contrast}
        </span>
      </span>
      <code className="truncate text-center text-[11px] text-muted-foreground">
        {truncate(candidate.address)}
      </code>
      {/* Last, and stretched over the whole tile: the control the user actually clicks and focuses.
          Below the overlay (z-20) so the copy button above it stays clickable on hover. */}
      <button
        type="button"
        // Up to two hundred tiles on screen at once, so "which result is this?" has to be in the
        // name itself: the score identifies it at a glance and the address identifies it exactly.
        // The address is truncated on the tile, so the name is the only place it is complete.
        aria-label={
          deploying
            ? `View the deploy in progress for ${candidate.address}`
            : `Deploy ${percent} match ${candidate.address}`
        }
        // An explicit aria-label overrides the tile's contents, which would otherwise silence the
        // metadata below it — a screen-reader user could no longer compare contrast, or tell a
        // two-colour result from a three-colour one, without opening the detail view.
        aria-describedby={markTwoColour ? `${traitsId} ${colourId}` : traitsId}
        // Set by hand because the dialog is rendered by the page, not as a child of this
        // component, so there is no DialogTrigger to supply it. There is deliberately no
        // aria-expanded — this control has no expanded state of its own; the page owns which
        // candidate (if any) is open.
        aria-haspopup="dialog"
        className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={() => onSelect(candidate)}
      />
    </Card>
  )
})
