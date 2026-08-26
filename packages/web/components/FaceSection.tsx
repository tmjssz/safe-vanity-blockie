'use client'

import { ChevronDown, ListFilter, Smile } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FaceFilters } from '../lib/config'
import { ALL_MOUTH_NAMES } from '../lib/face-selection'
import { cn } from '../lib/utils'
import { ContrastSwatch } from './ContrastSwatch'
import { FacePicker } from './FacePicker'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

export interface FaceSectionProps {
  mouths: string[]
  filters: FaceFilters
  /**
   * Whether a run exists.
   *
   * Two things read it, and they are separate questions that happened to share an answer while
   * this card was only ever mounted on the results page. It supplies the DEFAULT for whether the
   * card starts collapsed — `defaultOpen` overrides that outright — and it decides whether
   * FacePicker asks about restarting a search, since on a screen with no run there is no
   * leaderboard and no scanned nonces for that question to be about.
   *
   * Not read after the first render unless it changes, and the user's own choice outranks it from
   * the moment they make one (see `userChose` below).
   */
  mining?: boolean
  /**
   * Whether the card starts open, when the host knows better than `mining` does.
   *
   * Three arrival states have to be told apart now that this card lives on Configure's start
   * screen as well as on the results page: a resume link that named filters wants it
   * open, because those filters decide what gets mined and nobody has seen them yet; a link that
   * named only a checkpoint wants Advanced open but this shut, because nothing was carried to look
   * at; and an ordinary visit wants both shut. One bit about whether a run exists cannot say which
   * of those it is.
   *
   * Where the card STARTS, and nothing more — `userChose` still outranks it the moment the reader
   * presses the header, because a starting point that kept reasserting itself would be a control
   * that does not hold.
   *
   * `??` rather than a competing flag: omitted, `mining` decides exactly as it always did, which
   * is what leaves the results page's call site untouched. Same precedence shape as `chainId` and
   * `mouths` in app/page.tsx.
   */
  defaultOpen?: boolean
  /**
   * Draw the header in the same voice as Configure's Advanced disclosure: a quiet muted line with
   * its chevron against the label, rather than a card header with a semibold heading, an icon of
   * its own, and the chevron thrown to the far side of the row.
   *
   * It exists because on the start screen this sits one row above that disclosure, and the two are
   * the same kind of thing — a line you press to see more. Drawn loud, it announced itself as the
   * more important of the two, which is backwards: the checkpoint field below it is the advanced
   * question, and this is half of what the form is for. Two lines that behave alike should look
   * alike.
   *
   * It also takes the card's vertical padding off, so the row sits as tight to its neighbours as
   * Advanced's does. The results page, where this really is a card among cards, passes nothing and
   * keeps every bit of its own chrome.
   */
  quiet?: boolean
  /**
   * Classes for the Card itself. Nested on Configure's start screen this sits inside another Card,
   * where its own border and shadow read as clutter rather than structure — so the host that put it
   * there says so, rather than this component guessing where it is from a prop.
   */
  className?: string
  /**
   * A request from elsewhere on the page to show these controls — the results grid's empty state,
   * whose whole advice is "relax a filter" while this card sits collapsed and scrolled off the top
   * of the screen. Each new value opens the card and scrolls it into view.
   *
   * A counter rather than a boolean, and it is the CHANGE that acts, not the value. A boolean
   * would be stuck true after the first request, so a user who closes the card again could never
   * ask a second time; reading the value rather than its change would reopen the card on every
   * unrelated re-render, of which a mining page has several a second.
   */
  revealRequest?: number
  /**
   * Reports whether the card is showing its controls, on the first render and on every change
   * after it. For the results grid's empty state, which offers to reveal this card and must not
   * offer it while it is already open — a button that reveals what is on screen does nothing, and
   * it would sit directly under a sentence naming filters the user can see.
   *
   * The card has to be the one saying so: `mining`, `revealRequest` and the header itself are
   * three separate ways it opens and closes, and a host that tried to keep its own copy would go
   * stale on whichever one it did not know about.
   */
  onOpenChange?: (open: boolean) => void
  onMouthsChange: (names: string[]) => void
  onFiltersChange: (filters: FaceFilters) => void
}

/**
 * At most four chips, and each is present only when its constraint actually constrains something.
 * A chip that says "everything is allowed" is a chip that has to be read to learn nothing, and a
 * collapsed card carrying four of those tells the user the filter is doing work it is not.
 *
 * They are rendered in the order the open card lays the controls out, and must stay that way: the
 * chips are a reading of those controls, and a summary that lists them in a different order leaves
 * the reader matching them up by name instead of by position.
 *
 * Expressions are the exception: they always constrain what the miner credits, so that chip is
 * always there. It reads off `mouths`, the APPLIED selection, not FacePicker's draft. A staged edit
 * is not what is being mined, and the collapsed card's job is to say what is.
 */
function summarise(mouths: string[], filters: FaceFilters) {
  const accepted = ALL_MOUTH_NAMES.filter((name) => mouths.includes(name))
  return {
    // Names once the list is short enough to be worth more than a count: at three or fewer, "smile,
    // open" says which, where "2 expressions" only says how many and sends the reader back into the
    // card to find out. Above three the names are longer than the row has room for, and a count is
    // the honest summary. All five accepted is the permissive default, so it counts rather than
    // listing every name the app has.
    expressions:
      accepted.length > 0 && accepted.length <= 3 && accepted.length < ALL_MOUTH_NAMES.length
        ? accepted.join(', ')
        : `${accepted.length} expressions`,
    twoColor: filters.twoColor,
    minContrast: filters.minContrast > 0 ? filters.minContrast : undefined,
    minMatch: filters.minMatch > 0 ? filters.minMatch : undefined,
  }
}

/**
 * What a candidate has to look like to be kept: which face shapes count, and which colour pairs.
 *
 * Collapsible again, and starting collapsed while a run exists. It was not, and the note that
 * replaced it argued that a collapse "only ever hid something a reader can scroll past for free".
 * That was true of a collapse with nothing in its header: the closed card said only its own name,
 * so opening it was the only way to learn anything, and the control was pure cost. The summary
 * chips are what changes the trade. Closed, the card now answers the question its contents answer
 * (what is being filtered, and how hard) in one row instead of six hundred pixels, which is worth
 * more than the scroll it saves.
 */
export function FaceSection({
  mouths,
  filters,
  mining = false,
  defaultOpen,
  quiet = false,
  className,
  revealRequest = 0,
  onOpenChange,
  onMouthsChange,
  onFiltersChange,
}: FaceSectionProps) {
  // Open when there is no run to get on with. A submitted config means the user has already said
  // what they want and is waiting for results, so the filter steps out of the way; an idle screen
  // means nobody has seen it yet, so it shows itself.
  //
  // `defaultOpen` overrides that when the host knows which of the three arrival states this is —
  // see the prop. Read once, as an initial value: it is where the card starts, not a rule it has
  // to keep obeying.
  const [open, setOpen] = useState(defaultOpen ?? !mining)
  // Set by the header, and never by anything else. Once the user has said what they want the card
  // to be, no rule here may say otherwise for the rest of the session: an auto-collapse that
  // fights a deliberate expand is a control that does not hold, which is worse than one that does
  // not exist. A ref rather than state because nothing renders differently for it.
  const userChose = useRef(false)

  // Only on the transition into mining, and only while the user has not decided for themselves.
  // Guarding on the transition rather than on `mining` being true is what keeps this from
  // re-collapsing on every unrelated re-render of the page.
  const wasMining = useRef(mining)
  useEffect(() => {
    if (mining && !wasMining.current && !userChose.current) setOpen(false)
    wasMining.current = mining
  }, [mining])

  // Answers `revealRequest`. It outranks `userChose` deliberately: the request comes from a button
  // the user has just pressed, so it IS the user choosing — a card they collapsed earlier is not a
  // standing refusal to ever see the filters again.
  //
  // Opening it is only half the job. The request comes from the results grid, which during a run
  // is what fills the viewport with this card several hundred pixels above it: expanding controls
  // off the top of the screen looks, from where the user is sitting, like nothing happened. So the
  // card scrolls itself back in. The guard is for jsdom, which implements no scrolling at all.
  const cardRef = useRef<HTMLDivElement>(null)
  const lastRequest = useRef(revealRequest)
  useEffect(() => {
    if (revealRequest === lastRequest.current) return
    lastRequest.current = revealRequest
    setOpen(true)
    cardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [revealRequest])

  // Every way this card opens and closes goes through `open`, so one effect on it covers all of
  // them: the `mining` default, an auto-collapse, a reveal request, and the header the user
  // presses. It fires on the first render too, which is the point — the initial state depends on
  // `mining`, so a host that assumed either value would be wrong half the time.
  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  const summary = summarise(mouths, filters)

  return (
    // `gap-0` because the Card's own `gap-6` sits between the header and the panel whether or not
    // the panel has any height: collapsed, it left 24px of empty card under the header. The panel
    // carries its own top padding instead, where it is only paid when there is something to pad.
    <Card ref={cardRef} className={cn('gap-0', quiet && 'py-0', className)}>
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          userChose.current = true
          setOpen(next)
        }}
        className="group/filter"
      >
        {/* One row, and the whole row is the control. `relative` for the trigger below, which is
            stretched across all of it rather than wrapping it: the title is a real <h2> and a
            heading is not phrasing content, so it cannot live inside a <button>. This is the same
            shape ResultCard uses for the same reason, and the surfaces line up because the button
            is `inset-0`.

            `min-h-8` is what stops the title moving when the card is toggled. Without it the row
            is only as tall as its tallest child, and that child changes with the state: a chip is
            22px (16px of text-xs, 4px of padding, 2px of border) where the title and the two icons
            are 16px, so `items-center` re-centred the title 3px lower the moment the chips
            appeared and back up again when they went. 32px is the same height as a `size="sm"`
            control elsewhere in the app, and it clears the chips with room to spare, so the row is
            one height in both states and the title does not move at all.

            `flex-wrap` still applies below that: align-items works per flex line, so chips wrapping
            to a second line does not drag the title down with them either. */}
        <CardHeader
          className={cn(
            'relative flex flex-row flex-wrap items-center gap-y-2',
            // Quiet, the row is tighter in both directions: `gap-x-2` because the chevron belongs
            // against its label rather than a lane away from it, and `min-h-6` because 24px is all
            // that is needed to clear a 22px chip without the label shifting as the chips come and
            // go — the jitter `min-h-8` was sized for at the louder text size.
            quiet ? 'min-h-6 gap-x-2' : 'min-h-8 gap-x-3',
          )}
        >
          {/* Quiet, the chevron IS the leading glyph, exactly as it is on Advanced's trigger — so
              the filter icon would be a second one, and this row is meant to read as one line of
              the same kind as the disclosure below it. Loud, the icon names the card and the
              chevron sits at the far end of the row (see below). */}
          {quiet ? (
            <ChevronDown
              data-slot="filter-chevron"
              aria-hidden="true"
              // `group-hover/filter:text-foreground` because Advanced's chevron carries no colour
              // of its own and simply inherits its trigger's, lifting with the label on hover. This
              // one is coloured explicitly — the whole row is the control, not a button wrapping
              // both — so it has to be told, or the label lifts and the glyph beside it does not.
              className="size-4 shrink-0 text-muted-foreground transition-[transform,color] duration-200 group-hover/filter:text-foreground group-data-[state=open]/filter:rotate-180"
            />
          ) : (
            <ListFilter aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          )}
          <CardTitle
            as="h2"
            id="filter-card-title"
            // Still an <h2> either way — the trigger takes its accessible name from it and
            // FacePicker's own <h3> hangs off it, so this is only ever a restyle. Quiet, it matches
            // the Advanced label it sits above: same size, same weight, same colour, and the same
            // lift on hover, which the whole row triggers because the whole row is the control.
            className={cn(
              quiet &&
                'text-sm font-medium text-muted-foreground transition-colors group-hover/filter:text-foreground',
            )}
          >
            Filter
          </CardTitle>

          {/* Only while closed. Open, every chip is restating a control the reader can already
              see, a few pixels below where the chip sits. */}
          {!open && (
            <div data-slot="filter-summary" className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1.5 rounded-md font-normal">
                <Smile aria-hidden="true" className="size-3.5 text-muted-foreground" />
                {summary.expressions}
              </Badge>
              {summary.twoColor && (
                <Badge variant="secondary" className="rounded-md font-normal">
                  two colours
                </Badge>
              )}
              {summary.minMatch !== undefined && (
                <Badge variant="secondary" className="rounded-md font-normal">
                  {/* The per-cent sign is what tells this chip apart from the contrast one beside
                      it, which is otherwise the same shape of number behind the same glyph. */}
                  <span aria-hidden="true">≥ {summary.minMatch}%</span>
                  <span className="sr-only">minimum match {summary.minMatch} percent</span>
                </Badge>
              )}
              {summary.minContrast !== undefined && (
                <Badge variant="secondary" className="gap-1.5 rounded-md font-normal">
                  {/* The same swatch the result tiles carry, and the slider above it, so one
                      number has one picture everywhere it appears. */}
                  <ContrastSwatch distance={summary.minContrast} className="h-3 w-6" />
                  <span aria-hidden="true">≥ {summary.minContrast}</span>
                  {/* "greater than or equal to" is what a screen reader makes of the glyph at
                      best, and nothing at worst. */}
                  <span className="sr-only">minimum contrast {summary.minContrast}</span>
                </Badge>
              )}
            </div>
          )}

          {/* Named by the title rather than by copy of its own: "Filter, button, collapsed" is
              what a screen reader should say, and a second name here would be a second name for
              the same thing. Radix puts aria-expanded and data-state on it. */}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-labelledby="filter-card-title"
              className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </CollapsibleTrigger>

          {/* Points down closed, up open. Rotated rather than swapped for a second icon so the
              transition is a turn rather than a cut, and it reads off the Root's data-state
              because the trigger it belongs to is the invisible sheet above.

              `ml-auto` throws it to the far edge, which suits a card header and not a quiet line —
              so when `quiet` this is rendered before the label instead, above. */}
          {!quiet && (
            <ChevronDown
              data-slot="filter-chevron"
              aria-hidden="true"
              className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/filter:rotate-180"
            />
          )}
        </CardHeader>

        {/* `overflow-hidden` is what makes the height animation a reveal rather than a squash: the
            panel keeps its full layout while the box around it grows. The keyframes are in
            globals.css, animating to Radix's measured `--radix-collapsible-content-height`. */}
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          {/* Quiet, half the gap: the row above it is a line rather than a card header, so 24px
              under it reads as a hole. */}
          <CardContent className={cn(quiet ? 'pt-3' : 'pt-6')}>
            {/* Unlike Configure, this never locks: none of it is an address concern, so all of it
                stays reachable while mining and the page never unmounts it — do not "fix" this
                into locking. Collapsing is not locking either: it hides the controls and changes
                nothing they hold.

                The two halves differ in when they take effect, and that is not the same thing. The
                colour filters re-filter candidates already mined, so they apply on the spot. The
                expressions are part of the run's identity, so applying one restarts the search and
                discards the board: those stage behind an Apply button and a warning. */}
            <FacePicker
              value={mouths}
              onChange={onMouthsChange}
              filters={filters}
              onFiltersChange={onFiltersChange}
              // The card already knows whether a run exists — `mining` is what decides whether it
              // starts collapsed. The picker needs the same fact for its restart question, and
              // reading it from here rather than from a prop of its own is what keeps the two from
              // disagreeing about a page that is idle.
              //
              // Boolean, not `mining` raw: the prop is optional, and an omitted one means "no run"
              // here (it is the idle screen's case, see this component's own doc) while `undefined`
              // reaching FacePicker would fall to ITS default, which is "there is a run". Two
              // optionals with opposite defaults meeting in the middle is exactly the seam to nail
              // shut.
              live={Boolean(mining)}
            />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
