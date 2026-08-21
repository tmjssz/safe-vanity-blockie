import type { ReactNode } from 'react'
import { useId } from 'react'
import { cn } from '../lib/utils'

/**
 * Marks the rendered `<svg>` with the chain it draws, so a test can find an icon that is — by
 * design — invisible to every accessible query. Exported rather than a bare string so the tests
 * that assert an icon is present cannot drift from the attribute the component actually writes.
 */
export const CHAIN_ICON_ATTR = 'data-chain-icon'

/**
 * A brand-coloured disc with the chain's glyph knocked out of it in white.
 *
 * One shape for all seven, which is what makes them a set rather than seven logos that happen to
 * be adjacent. Drawn bare, these marks have wildly different geometry — a diamond, an outline, a
 * pair of letterforms, a solid square — and so wildly different optical weight and contrast: the
 * square pulled the eye across the whole list, while Gnosis's dark green all but disappeared
 * against the dark theme. The disc settles both at once. Every mark covers the same area, and
 * every glyph is white on a colour picked to carry it, so none of them depends on the surface
 * behind it. That is also why these need no theme handling while every lucide icon in the app
 * follows `currentColor`: a disc brings its own background.
 *
 * `scale` insets the glyph. It defaults to what suits a glyph drawn to fill its square, which is
 * what the source artwork is; the marks that are denser or sparser than that say so.
 */
function disc(fill: string, glyph: ReactNode, scale = 0.78): ReactNode {
  return (
    <>
      <circle cx="12" cy="12" r="12" fill={fill} />
      {/* No clip. Every glyph here is drawn inside a 4..20 box, whose far corner is 11.3 from the
          centre and so already inside a disc of radius 12 — the inset below pulls it further in
          still. A clip was tried and removed: `circle(50%)` is resolved against the clipped
          element's OWN bounding box, not the disc's, so it turned Base's square into a circle
          rather than guarding anything. A glyph drawn wider than that box needs its own `scale`,
          which is what that argument is for. */}
      <g fill="#fff" transform={`translate(12 12) scale(${scale}) translate(-12 -12)`}>
        {glyph}
      </g>
    </>
  )
}

/**
 * Ethereum's diamond, white, with its facets carried by opacity rather than by a second colour.
 *
 * This is the mark as it is drawn everywhere it sits on a coloured disc: the front faces at full
 * white, the receding ones at 60%, the inner right at 20%. Shading it this way rather than in
 * greys is what lets one glyph serve both the mainnet disc and Sepolia's, because it then takes
 * its colour from whatever it is knocked out of.
 */
const ETHEREUM_DIAMOND: ReactNode = (
  <>
    <path fillOpacity=".6" d="M12 4v5.912l5 2.237z" />
    <path d="M12 4 7 12.149l5-2.237z" />
    <path fillOpacity=".6" d="M12 15.98V20l5-6.92z" />
    <path d="M12 20v-4.021l-5-2.898z" />
    <path fillOpacity=".2" d="m12 15.049 5-2.9-5-2.236z" />
    <path fillOpacity=".6" d="m7 12.149 5 2.9V9.913z" />
  </>
)

/**
 * What to draw for each chain, keyed by the same chain IDs as `SUPPORTED_CHAINS` — which is the
 * list test/ChainIcon.test.tsx loops over, so a chain added there without a mark here fails
 * loudly rather than rendering a hole.
 *
 * Glyphs are the official marks, taken from @web3icons/core (MIT) rather than redrawn by hand, so
 * that no chain is represented by an approximation of its logo. Discs are each brand's own colour,
 * with the exceptions noted below.
 *
 * A function per entry, taking an id to hang a gradient off, because only Polygon needs one and a
 * `<linearGradient>` is referenced by id — see the `useId` call in the component.
 */
const CHAIN_MARKS: Record<number, (gradientId: string) => ReactNode> = {
  // Ethereum, on the periwinkle its badge has always used.
  1: () => disc('#627EEA', ETHEREUM_DIAMOND),

  /**
   * Sepolia, which has no mark of its own: Ethereum's diamond, on amber.
   *
   * A testnet is Ethereum, so the glyph is right and anything else would be an invention. The disc
   * is what has to say "not the real one", and it has to say it in the dropdown where the two sit
   * two rows apart. Amber does: it is the one hue no supported chain has claimed — Polygon holds
   * purple, Base and Arbitrum blue, Optimism red, Gnosis green — so it cannot be misread as
   * another chain, and warm amber already reads as a caution rather than as a brand. A grey disc
   * was the alternative and is the weaker one: at 16px it is a slightly duller mainnet, which is
   * exactly the confusion this exists to prevent.
   */
  11155111: () => disc('#D9922A', ETHEREUM_DIAMOND),

  // Polygon, on the gradient its own mark is drawn in.
  137: (gradientId) => (
    <>
      {disc(
        `url(#${gradientId})`,
        <path d="m15.88 14.86 3.794-2.165a.64.64 0 0 0 .326-.558v-4.33a.64.64 0 0 0-.326-.556L15.88 5.086a.66.66 0 0 0-.65 0L11.432 7.25a.64.64 0 0 0-.325.557v7.737l-2.662 1.517-2.661-1.517v-3.036l2.661-1.517 1.755 1.001V9.958l-1.43-.816a.66.66 0 0 0-.65 0l-3.796 2.165a.64.64 0 0 0-.325.557v4.33c0 .229.124.442.325.557l3.796 2.165c.2.114.45.114.65 0l3.796-2.165a.64.64 0 0 0 .325-.557V8.455l.048-.026 2.613-1.49 2.661 1.516v3.036l-2.661 1.517-1.753-.999v2.037l1.427.814a.66.66 0 0 0 .651 0z" />,
      )}
      <defs>
        <linearGradient
          id={gradientId}
          x1="3.948"
          x2="19.217"
          y1="16.617"
          y2="7.645"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#A726C1" />
          <stop offset=".88" stopColor="#803BDF" />
          <stop offset="1" stopColor="#7B3FE4" />
        </linearGradient>
      </defs>
    </>
  ),

  // Arbitrum One, on its navy.
  42161: () =>
    disc(
      '#213147',
      <>
        <path d="m13.203 13.216-.787 2.124a.27.27 0 0 0 0 .183l1.354 3.655 1.565-.89-1.879-5.072c-.042-.117-.21-.117-.253 0m1.577-3.573a.135.135 0 0 0-.253 0l-.787 2.124a.27.27 0 0 0 0 .183l2.217 5.985 1.565-.89z" />
        <path d="M11.999 4.991a.24.24 0 0 1 .111.03l5.969 3.393a.22.22 0 0 1 .112.19v6.787a.22.22 0 0 1-.112.19l-5.969 3.395a.2.2 0 0 1-.111.029.24.24 0 0 1-.113-.03l-5.968-3.39a.22.22 0 0 1-.112-.19v-6.79a.22.22 0 0 1 .112-.19l5.969-3.393a.23.23 0 0 1 .111-.03m0-.991c-.213 0-.426.054-.616.163L5.416 7.556a1.21 1.21 0 0 0-.616 1.05v6.787c0 .433.234.834.616 1.05l5.968 3.394a1.25 1.25 0 0 0 1.232 0l5.968-3.394a1.21 1.21 0 0 0 .616-1.05V8.606a1.21 1.21 0 0 0-.616-1.05l-5.97-3.393A1.24 1.24 0 0 0 11.998 4" />
        <path d="m8.052 17.943.55-1.482 1.105.905-1.034.93zm3.445-9.823H9.984a.27.27 0 0 0-.254.175l-3.243 8.757 1.565.89L11.623 8.3a.132.132 0 0 0-.127-.179" />
        <path d="M14.144 8.12h-1.513a.27.27 0 0 0-.253.175l-3.704 10 1.565.89 4.032-10.886a.133.133 0 0 0-.127-.179" />
      </>,
    ),

  // OP Mainnet, on its red.
  10: () =>
    disc(
      '#FE0420',
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.859 15.378q.87.622 2.233.622 1.647 0 2.633-.745.984-.754 1.385-2.277.24-.933.413-1.923.056-.353.056-.59 0-.776-.4-1.331a2.4 2.4 0 0 0-1.1-.845Q9.381 7.999 8.5 8q-3.238 0-4.018 3.055a36 36 0 0 0-.423 1.923 4 4 0 0 0-.058.6q0 1.166.859 1.8m4.133-2.467c-.22.851-.824 1.405-1.74 1.405-.907 0-1.216-.613-1.053-1.405q.206-1.078.412-1.822c.236-.919.792-1.405 1.74-1.405.903 0 1.198.605 1.042 1.405a26 26 0 0 1-.401 1.822m3.469 3.01a.24.24 0 0 0 .19.078h1.514a.33.33 0 0 0 .212-.079.33.33 0 0 0 .122-.206l.479-2.24h1.54c.973 0 1.733-.471 2.29-.891q.848-.63 1.125-1.943.068-.309.067-.595 0-.992-.756-1.52Q18.496 8 17.26 8h-2.962a.33.33 0 0 0-.212.08.33.33 0 0 0-.122.206l-1.538 7.428a.28.28 0 0 0 .034.206m5.413-5.304c-.14.612-.673 1.172-1.3 1.172h-1.28l.441-2.105h1.336c.455 0 .835.09.835.59q0 .148-.032.343"
      />,
    ),

  /**
   * Base, on its blue, at 60% rather than the usual inset.
   *
   * Its glyph is a filled square — the only solid one in the set — and at the scale that suits the
   * others it very nearly inscribes the circle, leaving a rim of blue so thin the mark reads as a
   * white disc with a blue edge. Pulled in, it reads as what it is: Base's square, on Base's blue.
   */
  8453: () =>
    disc(
      '#0000FF',
      <path d="M4 5.517c0-.52 0-.78.098-.98a.96.96 0 0 1 .44-.44C4.738 4 4.998 4 5.517 4h12.966c.52 0 .78 0 .98.098a.97.97 0 0 1 .439.44c.098.2.098.46.098.979v12.966c0 .52 0 .78-.098.98a.96.96 0 0 1-.44.439c-.2.098-.46.098-.979.098H5.517c-.52 0-.78 0-.98-.098a.96.96 0 0 1-.439-.44C4 19.263 4 19.002 4 18.484z" />,
      0.6,
    ),

  // Gnosis, on its green — the colour that was too dark to draw a mark IN, and is exactly right to
  // draw one ON.
  100: () =>
    disc(
      '#3E6957',
      <path d="m18.69 8 .152.24A7.6 7.6 0 0 1 20 12.269c.008 2.037-.83 3.993-2.329 5.442-1.498 1.448-3.537 2.272-5.67 2.289h-.016c-4.404 0-8-3.491-7.985-7.76 0-1.433.412-2.822 1.174-4.029l.137-.219.731.706a2.7 2.7 0 0 0-.343.655 2.85 2.85 0 0 0 .108 2.262c.346.71.973 1.262 1.744 1.534a3.2 3.2 0 0 0 1.413.146 3.15 3.15 0 0 0 1.33-.48L12 14.473l1.95-1.891a3.12 3.12 0 0 0 2.587.298c.426-.14.815-.37 1.135-.673a2.84 2.84 0 0 0 .87-2.386 2.8 2.8 0 0 0-.462-1.239zM6.94 9.563l2.294 2.211c-.283.222-.632.34-.991.336a1.7 1.7 0 0 1-1.156-.469 1.53 1.53 0 0 1-.474-1.11c0-.364.122-.698.327-.968m8 2.074 2.27-2.19c.176.255.275.56.275.88 0 .873-.732 1.578-1.631 1.578-.343 0-.648-.095-.914-.268m-2.91 1.657L5.425 6.873l.259-.262a8.5 8.5 0 0 1 2.837-1.932A8.8 8.8 0 0 1 11.93 4h.016c2.414 0 4.738 1.004 6.354 2.742l.252.269zM6.499 6.873l5.532 5.367 5.454-5.258a7.8 7.8 0 0 0-2.526-1.645 8.1 8.1 0 0 0-2.997-.588h-.015c-2.057 0-3.977.749-5.448 2.124" />,
    ),
}

export interface ChainIconProps {
  /** Which chain to draw. Anything without a mark draws nothing. */
  chainId: number
  /** Overrides the default `size-4.5`, for the few places that want it at another size. */
  className?: string
}

/**
 * A chain's brand mark, for the places that name a chain: the header selector and its options, the
 * switch-chain confirmation, the deploy dialog's wrong-chain button, and the deploy outcome.
 *
 * Always `aria-hidden`. Every one of those places already says the chain's name in text right
 * beside the mark, so exposing it would read the chain twice and tell a screen-reader user nothing
 * they did not already have. It is decoration on a label that is doing the actual work.
 *
 * Draws nothing at all for a chain it has no mark for. Not reachable through the UI — the selector
 * only offers SUPPORTED_CHAINS — but every other per-chain lookup in this app degrades rather than
 * throws (`?? chain ${chainId}`, `explorerFor` returning undefined), and an ornament is the last
 * thing that should be the exception.
 */
export function ChainIcon({ chainId, className }: ChainIconProps) {
  // Before the early return, because hooks cannot be conditional. Only Polygon reads it, and it is
  // per-instance so that two marks on screen at once — the switch dialog shows the chain being
  // left and the one being taken — cannot collide on one gradient id.
  const gradientId = useId()

  const mark = CHAIN_MARKS[chainId]
  if (!mark) return null

  return (
    <svg
      viewBox="0 0 24 24"
      // 18px rather than the 16 that every lucide icon in this app uses. Those are line
      // drawings, and a line drawing reads at 16; these are discs with a glyph inside, and at 16
      // the glyph — Polygon's outline, Arbitrum's A, the Gnosis owl — is too fine to tell apart at
      // a glance, which is the only thing a chain mark is for. 20px was the other candidate and
      // crowds the h-8 header trigger.
      className={cn('size-4.5 shrink-0', className)}
      aria-hidden="true"
      focusable="false"
      {...{ [CHAIN_ICON_ATTR]: String(chainId) }}
    >
      {mark(gradientId)}
    </svg>
  )
}

export interface ChainLabelProps {
  /** Which chain to mark. */
  chainId: number
  /** The chain's name, as the calling screen words it. */
  children: ReactNode
}

/**
 * A chain's mark followed by its name, for the places where the chain is named inside a longer
 * phrase — "Switch to Ethereum?", "Live on Base and ready to use." The mark has to sit against the
 * name it marks there; leading the whole sentence it would read as an icon for the sentence.
 *
 * Where the chain IS the label — a list row, a button — use `ChainIcon` as a direct child instead,
 * which is how every other icon in this app leads its control.
 *
 * Sized in `em` rather than at a fixed pixel size, because this one is set in running text and the
 * text is not one size: it is an 18px bold dialog title in one place and a 14px muted subtitle in
 * another, and one fixed size through both is oversized in the second and lost in the first.
 * Slightly over 1em so the mark carries at the subtitle's 14px; much over and it outgrows the line
 * box of the title, which 1.3em does. `ChainIcon`'s own default stays a fixed size, which is right
 * for the controls it leads, where it lines up with other icons rather than with a sentence.
 *
 * A fragment, deliberately, with no wrapping element: the name stays a direct text child of
 * whatever heading or paragraph is being written, so the sentence is still one run of text to
 * anything reading the DOM — a selection dragged across it, and getByText, which sees only an
 * element's own text nodes and would stop finding "Live on Sepolia and ready to use." the moment
 * the chain moved inside a span.
 *
 * The name comes in as children rather than being looked up here, because the screens word the
 * fallback for an unnamed chain differently: mid-sentence it is "chain 999", and as a title it is
 * "Chain 999". One component should not have an opinion about the other's sentence.
 */
export function ChainLabel({ chainId, children }: ChainLabelProps) {
  return (
    <>
      <ChainIcon className="mr-2 inline size-[1.15em] align-[-0.125em]" chainId={chainId} />
      {children}
    </>
  )
}
