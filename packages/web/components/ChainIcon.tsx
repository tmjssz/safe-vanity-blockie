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
 * Ethereum's official mark, in Ethereum's own palette.
 *
 * The geometry is the canonical diamond: apex at the top, waist at y=12.167, base at the bottom,
 * six faces. The three greys are the brand's — light face #8A92B2, shaded face #62688F, inner
 * right #454A75 — chosen over the pastel recolouring that icon sets often ship, because the
 * violet-grey diamond is what a Safe user has seen on every Ethereum surface there is, and the
 * whole value of a mark here is being recognised without being read.
 *
 * Both tones carry enough weight to sit on this app's light and dark surfaces without a plate
 * behind them, which is why the diamond is drawn bare while the disc-shaped marks below keep the
 * discs their brands give them.
 */
function ethereumDiamond(light: string, shaded: string, inner: string): ReactNode {
  return (
    <>
      <path fill={light} d="M12 3v6.651l5.625 2.516z" />
      <path fill={shaded} d="m12 3-5.625 9.166L12 9.653z" />
      <path fill={light} d="M12 16.478V21l5.625-7.784z" />
      <path fill={shaded} d="M12 21v-4.522l-5.625-3.262z" />
      <path fill={inner} d="m12 15.43 5.625-3.263L12 9.652z" />
      <path fill={shaded} d="M6.375 12.167 12 15.43V9.652z" />
    </>
  )
}

/**
 * What to draw for each chain, keyed by the same chain IDs as `SUPPORTED_CHAINS` — which is the
 * list test/ChainIcon.test.tsx loops over, so a chain added there without a mark here fails
 * loudly rather than rendering a hole.
 *
 * Every mark is drawn on a 24×24 viewBox and in fixed brand hex, never `currentColor`: telling
 * chains apart at a glance is the entire job, and colour is most of how that happens. That does
 * mean these do not follow the theme the way every lucide icon in the app does — each one is
 * therefore a mark that carries its own contrast, either as a self-contained disc or hexagon, or
 * in tones mid-range enough to hold against both surfaces.
 *
 * Paths are the official marks, taken from @web3icons/core (MIT) rather than redrawn by hand, so
 * that no chain is represented by an approximation of its logo. The exceptions are noted below.
 *
 * A function per entry, taking the id to hang a gradient off, because only Polygon needs one and a
 * `<linearGradient>` is referenced by id — see the `useId` call in the component.
 */
const CHAIN_MARKS: Record<number, (gradientId: string) => ReactNode> = {
  // Ethereum
  1: () => ethereumDiamond('#8A92B2', '#62688F', '#454A75'),

  /**
   * Sepolia, which has no mark of its own: Ethereum's diamond, in amber.
   *
   * A testnet is Ethereum, so the shape is right and anything else would be an invention. The
   * colour is what has to say "not the real one", and it has to say it in the dropdown where the
   * two sit two rows apart. Amber does: it is the one hue no supported chain has claimed —
   * Polygon holds purple, Base and Arbitrum blue, Optimism red, Gnosis green — so it cannot be
   * misread as another chain, and warm-amber already reads as a caution rather than as a brand.
   * A desaturated grey diamond was the alternative and is the weaker one: at 16px it is a
   * slightly duller mainnet, which is exactly the confusion this exists to prevent.
   */
  11155111: () => ethereumDiamond('#F2B33D', '#D9922A', '#B0741C'),

  // Polygon
  137: (gradientId) => (
    <>
      <path
        fill={`url(#${gradientId})`}
        d="m16.364 15.217 4.27-2.435a.73.73 0 0 0 .366-.627V7.284a.72.72 0 0 0-.366-.627l-4.27-2.435a.74.74 0 0 0-.732 0l-4.27 2.435a.72.72 0 0 0-.366.627v8.704l-2.994 1.707-2.994-1.707v-3.415l2.994-1.707 1.974 1.127V9.702l-1.608-.918a.75.75 0 0 0-.732 0l-4.27 2.435a.72.72 0 0 0-.366.627v4.87c0 .258.14.498.366.627l4.27 2.436a.75.75 0 0 0 .732 0l4.27-2.436a.72.72 0 0 0 .366-.626V8.012l.053-.03 2.94-1.677 2.994 1.707v3.415l-2.994 1.707-1.972-1.124v2.291l1.606.916a.75.75 0 0 0 .732 0z"
      />
      <defs>
        <linearGradient
          id={gradientId}
          x1="2.942"
          x2="20.119"
          y1="17.194"
          y2="7.101"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#A726C1" />
          <stop offset=".88" stopColor="#803BDF" />
          <stop offset="1" stopColor="#7B3FE4" />
        </linearGradient>
      </defs>
    </>
  ),

  // Arbitrum One
  42161: () => (
    <>
      <path
        fill="#213147"
        d="M4.515 8.471v7.056c0 .45.245.867.64 1.092l6.205 3.529a1.3 1.3 0 0 0 1.28 0l6.203-3.53c.396-.224.64-.64.64-1.09V8.47c0-.45-.244-.867-.64-1.091L12.64 3.85a1.3 1.3 0 0 0-1.28 0L5.155 7.38a1.25 1.25 0 0 0-.639 1.091"
      />
      <path
        fill="#12AAFF"
        d="m13.353 13.368-.885 2.39a.3.3 0 0 0 0 .205l1.523 4.112 1.76-1.001-2.113-5.706a.152.152 0 0 0-.285 0m1.774-4.019a.152.152 0 0 0-.285 0l-.885 2.39a.3.3 0 0 0 0 .205l2.494 6.732 1.761-1.001z"
      />
      <path
        fill="#9DCCED"
        d="M11.998 4.115a.3.3 0 0 1 .126.033l6.715 3.818a.25.25 0 0 1 .126.214v7.635c0 .089-.048.17-.126.214l-6.715 3.819a.25.25 0 0 1-.126.032.3.3 0 0 1-.125-.032l-6.715-3.815a.25.25 0 0 1-.126-.215V8.182c0-.089.048-.17.126-.215l6.715-3.818a.26.26 0 0 1 .125-.034m0-1.115c-.238 0-.478.06-.692.183L4.593 7A1.36 1.36 0 0 0 3.9 8.182v7.635c0 .487.264.938.693 1.181l6.714 3.819a1.41 1.41 0 0 0 1.386 0l6.714-3.818a1.36 1.36 0 0 0 .693-1.182V8.182A1.36 1.36 0 0 0 19.407 7l-6.716-3.817A1.4 1.4 0 0 0 11.998 3"
      />
      <path fill="#213147" d="m7.559 18.685.617-1.666 1.244 1.018-1.163 1.046z" />
      <path
        fill="#fff"
        d="M11.433 7.635H9.731a.3.3 0 0 0-.285.197l-3.649 9.852 1.761 1.001 4.018-10.849a.15.15 0 0 0-.143-.2m2.979-.001h-1.703a.3.3 0 0 0-.284.197l-4.167 11.25 1.761 1 4.535-12.246a.15.15 0 0 0-.142-.2"
      />
    </>
  ),

  // OP Mainnet
  10: () => (
    <path
      fill="#FE0420"
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3.966 15.8q.979.7 2.512.7 1.854 0 2.962-.838 1.108-.85 1.559-2.562.27-1.05.464-2.163.063-.398.064-.663 0-.874-.451-1.499a2.7 2.7 0 0 0-1.237-.95Q9.053 7.5 8.062 7.5q-3.644 0-4.52 3.437a40 40 0 0 0-.477 2.163q-.058.335-.065.674 0 1.314.966 2.026m4.65-2.775c-.247.957-.926 1.58-1.958 1.58-1.02 0-1.368-.69-1.184-1.58a27 27 0 0 1 .464-2.05c.265-1.034.89-1.58 1.956-1.58 1.017 0 1.348.68 1.173 1.58a30 30 0 0 1-.451 2.05m3.902 3.385q.076.09.214.089h1.704a.38.38 0 0 0 .238-.089.36.36 0 0 0 .138-.232l.538-2.52h1.733c1.094 0 1.95-.53 2.576-1.002q.953-.707 1.266-2.186.075-.348.075-.67 0-1.117-.851-1.71-.84-.591-2.23-.591h-3.333a.38.38 0 0 0-.238.09.38.38 0 0 0-.138.232l-1.73 8.356a.3.3 0 0 0 .038.232m6.09-5.966c-.157.689-.757 1.319-1.462 1.319h-1.44l.496-2.369h1.503c.512 0 .94.102.94.665q0 .165-.037.385"
    />
  ),

  /**
   * Base, scaled to 78%.
   *
   * Its mark is the only solid one in the set, and drawn at the size the others are it carries far
   * more optical weight than any of them — in a list of seven rows it is the one the eye goes to
   * first, for no reason but its geometry. Every other mark is a diamond, an outline or a glyph
   * and covers roughly a third of its box; a filled square covers all of it. Matching boxes is not
   * matching weight, and it is weight the eye reads.
   *
   * A transform rather than a rewritten path, so the `d` below stays byte-identical to the
   * official mark and can still be diffed against it.
   */
  8453: () => (
    <path
      transform="translate(12 12) scale(.78) translate(-12 -12)"
      fill="#00F"
      d="M3 4.706c0-.585 0-.877.11-1.101.106-.215.28-.39.496-.495C3.83 3 4.122 3 4.706 3h14.588c.585 0 .876 0 1.101.11.215.105.389.28.494.495.111.225.111.517.111 1.101v14.588c0 .585 0 .876-.11 1.101-.106.215-.28.389-.495.494-.225.111-.517.111-1.101.111H4.706c-.585 0-.876 0-1.101-.11a1.08 1.08 0 0 1-.494-.495C3 20.17 3 19.878 3 19.294z"
    />
  ),

  // Gnosis
  100: () => (
    <path
      fill="#3E6957"
      d="m19.526 7.5.171.27A8.55 8.55 0 0 1 21 12.303c.009 2.29-.933 4.492-2.62 6.122C16.695 20.055 14.4 20.98 12 21h-.017c-4.954 0-9-3.927-8.983-8.73 0-1.611.463-3.175 1.32-4.533l.154-.245.823.793a3 3 0 0 0-.386.737 3.2 3.2 0 0 0 .121 2.544 3.45 3.45 0 0 0 1.962 1.727 3.6 3.6 0 0 0 1.59.163 3.55 3.55 0 0 0 1.496-.54L12 14.782l2.194-2.127a3.51 3.51 0 0 0 2.91.336c.48-.158.917-.417 1.277-.759a3.2 3.2 0 0 0 .979-2.683 3.2 3.2 0 0 0-.52-1.394zM6.309 9.259l2.58 2.487a1.77 1.77 0 0 1-1.114.377 1.9 1.9 0 0 1-1.302-.526 1.73 1.73 0 0 1-.533-1.25c0-.409.137-.785.369-1.088m9 2.332 2.553-2.463c.198.287.31.63.31.99 0 .982-.824 1.776-1.835 1.776a1.84 1.84 0 0 1-1.028-.303m-3.275 1.865-7.43-7.224.29-.295a9.5 9.5 0 0 1 3.192-2.173A9.9 9.9 0 0 1 11.923 3h.017c2.717 0 5.331 1.129 7.149 3.085l.283.302zM5.811 6.232l6.223 6.038 6.137-5.915a8.8 8.8 0 0 0-2.843-1.85 9.1 9.1 0 0 0-3.37-.662h-.018c-2.314 0-4.474.842-6.129 2.39"
    />
  ),
}

export interface ChainIconProps {
  /** Which chain to draw. Anything without a mark draws nothing. */
  chainId: number
  /** Overrides the default `size-4`, for the few places that want it at another size. */
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
      className={cn('size-4 shrink-0', className)}
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
 * Sized in `em` rather than at a fixed 16px, because this one is set in running text and the text
 * is not one size: it is an 18px bold dialog title in one place and a 14px muted subtitle in
 * another, and a mark that stays 16px through both is oversized in the second and lost in the
 * first. `ChainIcon`'s own default stays a fixed `size-4`, which is right for the controls it
 * leads, where it is lining up with other icons rather than with a sentence.
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
      <ChainIcon className="mr-1.5 inline size-[1em] align-[-0.125em]" chainId={chainId} />
      {children}
    </>
  )
}
