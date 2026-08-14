'use client'

import { Check, Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FaceFilters } from '../lib/config'
import { contrastPairForDistance, MAX_RGB_DISTANCE, rgbCss } from '../lib/contrast-preview'
import { ALL_MOUTH_NAMES } from '../lib/face-selection'
import { cn } from '../lib/utils'
import { TargetPreview } from './TargetPreview'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { HintPopover } from './ui/hint-popover'
import { Label } from './ui/label'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'

export interface FacePickerProps {
  value: string[]
  onChange: (mouthNames: string[]) => void
  filters: FaceFilters
  onFiltersChange: (filters: FaceFilters) => void
}

/** The slider's ceiling: `MAX_RGB_DISTANCE` rounded up to a whole number a label can carry. */
const CONTRAST_MAX = Math.ceil(MAX_RGB_DISTANCE)

/**
 * Whether two selections would mine the same thing. Compared as sets: the face spec is built from
 * which expressions are accepted, not from the order they were clicked in, so a list that differs
 * only in order is not a change and must not offer to restart the search over nothing.
 */
function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((name, i) => name === [...b].sort()[i])
}

/**
 * The explanations that used to be paragraphs in the card body, one press away instead.
 *
 * Each is read once and then never again, but it sat between the reader and the controls on every
 * visit for the rest of the session. Behind an icon it costs a press the first time and nothing
 * after that. HintPopover opens on hover, click and keyboard focus, so this is not a hover-only
 * affordance that a touch user cannot reach.
 */
function Explains({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <HintPopover
      label={`About ${label}`}
      side="top"
      align="start"
      className="text-muted-foreground transition-colors hover:text-foreground"
      contentClassName="max-w-xs"
      content={children}
    >
      <Info className="size-3.5" aria-hidden="true" />
    </HintPopover>
  )
}

export function FacePicker({ value, onChange, filters, onFiltersChange }: FacePickerProps) {
  const [error, setError] = useState<string | undefined>()
  const [confirming, setConfirming] = useState(false)

  // The selection being *edited*, which is not yet the selection being mined.
  //
  // Changing the accepted expressions changes the face spec, and the face spec is part of a run's
  // identity (see MiningView's `sameRun`): a new one throws the leaderboard away and resets the
  // scanned total to zero. That used to happen on a single click of a tile, silently, while the
  // two colour filters beside it — which only re-filter candidates already mined — were equally
  // one click and cost nothing. Two controls an inch apart, one free and one destructive, with
  // nothing to tell them apart.
  //
  // So a click stages, and applying is a separate, announced act. The tiles show the draft,
  // because the draft is what the user is choosing.
  const [draft, setDraft] = useState(value)
  // The host applying a selection is what ends the pending state: it hands back a new `value`,
  // and the draft catches up to it. This also covers a `value` that changes for any other reason,
  // rather than leaving the tiles showing a selection nothing is mining.
  useEffect(() => setDraft(value), [value])

  const pending = !sameSelection(draft, value)

  const toggle = (name: string) => {
    if (draft.includes(name)) {
      if (draft.length === 1) {
        setError('Keep at least one expression: a face needs a mouth to score against.')
        return
      }
      setError(undefined)
      setDraft(draft.filter((entry) => entry !== name))
      return
    }
    setError(undefined)
    setDraft([...draft, name])
  }

  const allAccepted = ALL_MOUTH_NAMES.every((name) => draft.includes(name))
  const [dark, light] = contrastPairForDistance(filters.minContrast)

  return (
    // Two columns on a wide card: the tiles need the room, the two colour controls do not. They
    // stack on a narrow one with the expressions first, because that is the filter people come
    // here to change. `1.4fr` rather than an even split so five tiles fill their column instead
    // of leaving half of it empty, which is what a single full-width row of them did.
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="flex flex-col gap-3">
        <div
          data-slot="expressions-heading-row"
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          {/* h3 nests correctly under the card's h2 title. */}
          <h3 id="face-expressions" className="text-sm font-medium">
            Face expressions
          </h3>
          <Explains label="face expressions">
            Click a shape to accept or reject that expression. Each is what the miner is aiming at,
            not a blockie of any real address, since none exists yet.
          </Explains>

          {/* Everything that acts on the selection, with its heading rather than trailing the
              tiles. Left to right they run from the least consequential to the most: widen the
              selection, discard the edit, restart the search. Only Apply has consequences, and it
              is the only one that looks like it does.

              Each is absent rather than disabled when it would do nothing. Two of the three come
              and go with a staged change in any case, so a permanently present but greyed-out
              third would be the one dead control in a row that is otherwise never dead. */}
          <div className="ml-auto flex items-center gap-2">
            {!allAccepted && (
              // Rejecting is one click per expression; getting back is one click total.
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-muted-foreground no-underline hover:text-foreground hover:no-underline"
                onClick={() => {
                  setError(undefined)
                  setDraft([...ALL_MOUTH_NAMES])
                }}
              >
                Select all
              </Button>
            )}
            {pending && (
              <>
                {/* The way out that costs nothing: Apply restarts the search, this only drops
                    edits that never took effect, so it asks no question. */}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-muted-foreground no-underline hover:text-foreground hover:no-underline"
                  onClick={() => {
                    // The complaint belongs to the draft being discarded, so it goes with it.
                    setError(undefined)
                    setDraft(value)
                  }}
                >
                  Reset
                </Button>
                <Button type="button" size="xs" onClick={() => setConfirming(true)}>
                  Apply
                </Button>
              </>
            )}
          </div>
        </div>

        <div role="group" aria-labelledby="face-expressions" className="grid grid-cols-5 gap-2">
          {ALL_MOUTH_NAMES.map((name) => {
            const accepted = draft.includes(name)
            return (
              // role="checkbox" on a real <button> is what Radix's own Checkbox renders, so this
              // stays a toggle for assistive tech — and its accessible name is the caption below
              // the preview, which is why the preview itself is decorative here.
              <button
                key={name}
                type="button"
                role="checkbox"
                aria-checked={accepted}
                onClick={() => toggle(name)}
                className={cn(
                  'relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-2 transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  // Inverted from what this used to do. Everything starts accepted, so the
                  // remarkable state is the rejected one: accepted tiles are simply normal, and
                  // rejection is what the eye should catch. Ringing all five by default made the
                  // whole row shout and left "rejected" as the quiet absence of a ring.
                  accepted
                    ? 'border-border bg-muted/40'
                    : 'border-border/40 opacity-45 hover:opacity-70',
                )}
              >
                {accepted && (
                  <Check
                    data-slot="expression-selected-mark"
                    className="absolute top-1 right-1 size-3 text-primary"
                    aria-hidden="true"
                  />
                )}
                <TargetPreview mouthName={name} size={40} decorative />
                <span className={cn('text-xs', !accepted && 'text-muted-foreground')}>{name}</span>
              </button>
            )
          })}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Colours</h3>

        <div className="flex items-center gap-2 border-b pb-3">
          <Label htmlFor="two-color-only">Two colours only</Label>
          <Explains label="two colours only">
            A blockie is two-colour only when no cell uses the spot colour. That&rsquo;s the common
            case to want. Turning it off makes more candidates qualify, but some will show a third
            colour.
          </Explains>
          <Switch
            id="two-color-only"
            className="ml-auto"
            checked={filters.twoColor}
            onCheckedChange={(checked) => onFiltersChange({ ...filters, twoColor: checked })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {/* Radix puts role="slider" on the thumb, so the name comes from aria-labelledby
                rather than a <label for>, which cannot address a thumb. */}
            <span id="min-contrast-label" className="text-sm font-medium">
              Minimum contrast
            </span>
            <Explains label="minimum contrast">
              The RGB distance required between the two blockie colours.
            </Explains>
            <div className="ml-auto flex items-center gap-2">
              {/* The number says how far apart; these say what that looks like. They are greys
                  because that is the only axis where an exact pair exists at every value the
                  slider can reach — see lib/contrast-preview. */}
              <span aria-hidden="true" className="flex overflow-hidden rounded-sm border">
                <span
                  data-slot="contrast-swatch"
                  className="size-4"
                  style={{ backgroundColor: rgbCss(dark) }}
                />
                <span
                  data-slot="contrast-swatch"
                  className="size-4"
                  style={{ backgroundColor: rgbCss(light) }}
                />
              </span>
              {/* A slider with no readout is unusable for a value this precise. */}
              <span
                data-testid="min-contrast-value"
                className="w-10 text-right font-mono text-sm tabular-nums"
              >
                {filters.minContrast}
              </span>
            </div>
          </div>
          {/* Fully controlled from `filters.minContrast` — no local echo. The number input this
              replaced needed one to survive multi-digit typing; a slider has no such failure mode,
              and the echo could only ever drift from what the miner filters by. */}
          <Slider
            aria-labelledby="min-contrast-label"
            min={0}
            max={CONTRAST_MAX}
            step={1}
            value={[filters.minContrast]}
            onValueChange={([next]) => onFiltersChange({ ...filters, minContrast: next })}
          />
          {/* What the ends of the track mean, in place of the sentence that used to say it. At the
              track's own ends, so they are read as a scale rather than as prose about one. */}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0 · any pair</span>
            <span>{CONTRAST_MAX} · black on white</span>
          </div>
        </div>
      </section>

      {/* Asked every time, without checking whether the board happens to be empty yet. Restarting
          also throws away the nonces already scanned, so there is something to lose from the first
          second of a run — and this control sits among filters that cost nothing, which is exactly
          where a silent exception would be least expected. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart the search with these expressions?</DialogTitle>
            <DialogDescription>
              The face pattern is part of what the miner searches for, so changing it starts the
              search again from the beginning. Every result found so far is discarded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep mining</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false)
                onChange(draft)
              }}
            >
              Restart the search
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
