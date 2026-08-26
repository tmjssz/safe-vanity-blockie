'use client'

import { type FaceFilters, MATCH_MAX } from '../lib/config'
import { CONTRAST_MAX } from '../lib/contrast-preview'
import { ContrastSwatch } from './ContrastSwatch'
import { Explains } from './Explains'
import { Label } from './ui/label'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'

export interface ColorFiltersProps {
  filters: FaceFilters
  onFiltersChange: (filters: FaceFilters) => void
}

/**
 * The three constraints that judge a candidate's colours rather than its pattern: whether a third
 * colour disqualifies it, how close a match it has to be, and how far apart its two colours have to
 * sit.
 *
 * Split out of FacePicker when the expressions became a section of Configure in their own right.
 * These three stay together because they share a property the expressions do not: every one of them
 * re-filters candidates ALREADY mined, so each applies the moment it moves. Changing an expression
 * changes what the miner is looking for, which is a different kind of act and now lives elsewhere
 * (see ExpressionPicker).
 */
export function ColorFilters({ filters, onFiltersChange }: ColorFiltersProps) {
  /*
   * No heading of its own. "Colours" was a label over two controls that already say "Two-color"
   * and "Minimum contrast", and there is no one word left that covers all three of them now.
   *
   * `gap-5` rather than the `gap-3` the expressions use, and deliberately not the same: this holds
   * three unrelated questions where those hold a heading and the tiles it labels. At 12px the
   * toggle read as part of the contrast control below it.
   */
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        {/* "Two-color", matching the `--two-color` flag the CLI handoff writes and the
            `two-color` param a resume link carries. One name for one filter, wherever a user
            meets it. */}
        <Label htmlFor="two-color-only">Two-color</Label>
        <Explains label="Two-color">
          A blockie is two-color only when no cell uses the spot colour. That&rsquo;s the common
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

      {/* First of the two sliders: how close the face has to be, before how far apart its
        colours have to be. This is the filter the search is actually for — the miner exists to
        find the closest face, and contrast only qualifies what it finds — so it is read first
        rather than last.

        Built like the contrast slider below it, and for the same reason: both are a floor on a
        number every result carries, and a slider with a readout is what a floor on a number
        reads as. No swatch — contrast has one because the distance between two colours is not
        a thing the number itself shows, where a percentage is already the picture. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {/* Radix puts role="slider" on the thumb, so the name comes from aria-labelledby
            rather than a <label for>, which cannot address a thumb. */}
          <span id="min-match-label" className="text-sm font-medium">
            Minimum match
          </span>
          <Explains label="minimum match">
            How closely a blockie has to reproduce the face, as a share of a perfect score — the
            same percentage each result tile shows. Leave it at 0 while a search is young: the best
            match climbs as the search runs, so a floor set early hides everything until it is
            reached.
          </Explains>
          {/* A slider with no readout is unusable for a value this precise. The unit rides with
            the number here, unlike the contrast readout, because a bare percentage is a
            quantity nobody would guess the scale of. */}
          <span
            data-testid="min-match-value"
            className="ml-auto w-12 text-right font-mono text-sm tabular-nums"
          >
            {filters.minMatch}%
          </span>
        </div>
        {/* Fully controlled from `filters.minMatch`, exactly as the contrast slider below is: an
          echo of it here could only ever drift from what the miner filters by. */}
        <Slider
          aria-labelledby="min-match-label"
          min={0}
          max={MATCH_MAX}
          step={1}
          value={[filters.minMatch]}
          onValueChange={([next]) => onFiltersChange({ ...filters, minMatch: next })}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0 · any match</span>
          <span>{MATCH_MAX} · perfect</span>
        </div>
      </div>

      {/* Second, because it qualifies the results the match floor above has already narrowed:
        "of the faces this close, in colours this far apart". */}
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
            {/* The number says how far apart; this says what that looks like. Shared with every
              result tile, which shows the same pair for the contrast it was mined at, so the
              two readings of one number cannot drift apart. */}
            <ContrastSwatch distance={filters.minContrast} className="h-4 w-8" />
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
  )
}
