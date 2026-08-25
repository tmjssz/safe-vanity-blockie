import { cn } from '../lib/utils'

/**
 * Each bar's resting height, and the offset that puts it out of step with its neighbours.
 *
 * The heights are what `prefers-reduced-motion` falls back to, which is why they differ: three
 * bars of one height is a fence, and three of these is still recognisably an equalizer standing
 * still. While the animation runs it overrides all three with the same 5px-to-14px curve, and
 * the delays are what keep them apart.
 */
const RUNNING_BARS = [
  { height: 'h-[5px]', delay: '0ms' },
  { height: 'h-[14px]', delay: '150ms' },
  { height: 'h-[9px]', delay: '300ms' },
]

/**
 * Whether the search is working, at the head of the status bar's counters.
 *
 * A picture rather than a word, because it is the one thing on the bar a user glances at
 * repeatedly over a long run and never needs to read. Plain inline content, deliberately: no
 * border and no fill, so it cannot be mistaken for the controls at the other end of the same
 * row. Paused is the exception that earns a word, since a still glyph on its own is
 * indistinguishable from a decoration.
 *
 * `role="img"` with a name, so the whole thing is announced once, as one object: without it a
 * screen reader meets five empty spans while running and says nothing at all.
 */
export function MiningActivity({ paused }: { paused: boolean }) {
  if (paused) {
    return (
      <span
        data-slot="mining-activity"
        role="img"
        aria-label="Paused"
        // One colour for the glyph and the word, so `bg-current` on the bars cannot drift from
        // the text beside them. amber-600 in light mode rather than the 500 the bars could
        // carry alone: this one has to be readable as text, not just visible as a shape.
        className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400"
      >
        <span className="inline-flex h-[14px] items-center gap-[3px]">
          <span data-slot="activity-bar" className="h-[12px] w-[3px] rounded-full bg-current" />
          <span data-slot="activity-bar" className="h-[12px] w-[3px] rounded-full bg-current" />
        </span>
        Paused
      </span>
    )
  }

  return (
    <span
      data-slot="mining-activity"
      role="img"
      aria-label="Mining"
      // `items-end` is what puts the bars on a shared baseline; the fixed height is the tallest
      // the animation reaches, so the row does not resize on every frame of the loop.
      className="inline-flex h-[14px] items-end gap-[3px]"
    >
      {RUNNING_BARS.map((bar) => (
        <span
          key={bar.delay}
          data-slot="activity-bar"
          // An inline style rather than an `[animation-delay:150ms]` utility, and not for
          // convenience: `animate-equalizer` expands to the `animation` SHORTHAND, which resets
          // animation-delay to 0s. A utility only wins if it happens to be ordered after it in
          // the stylesheet, which is not something to stake the whole effect on. An inline
          // declaration wins outright.
          style={{ animationDelay: bar.delay }}
          className={cn(
            'w-[3px] rounded-full bg-emerald-500 animate-equalizer motion-reduce:animate-none dark:bg-emerald-400',
            bar.height,
          )}
        />
      ))}
    </span>
  )
}
