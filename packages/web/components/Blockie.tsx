import { bloSvg } from '@safe-vanity-blockie/core'
import { memo } from 'react'
import { cn } from '../lib/utils'

export interface BlockieProps {
  address: string
  size?: number
  /**
   * Classes for the wrapper. The identicon carries a viewBox, so a caller that wants it to fill
   * its column asks for that here (`w-full [&>svg]:size-full`) rather than by guessing a pixel
   * `size` — which is only the intrinsic width the svg declares, and which CSS then overrides.
   */
  className?: string
}

/**
 * The same picture as `Blockie`, but unlabelled and hidden from assistive tech, for the places
 * that show an identicon *next to the address it depicts* — an owner row, the header's wallet
 * chip. There the labelled version reads the address out twice, once as text and once as
 * "Identicon for 0x…", which is noise rather than information: the blockie is a visual shortcut
 * and there is no non-visual equivalent to offer.
 *
 * `data-slot` is what tests query, since a decorative element has no accessible name to find it
 * by — that is the whole point of it.
 *
 * Memoised, and that is load-bearing rather than tidiness: the mining status bar shows the owner's
 * identicon and re-renders several times a second for the counters beside it, so an unmemoised
 * version re-ran `bloSvg` on every publish to redraw a picture of an address that cannot change
 * during a run. All four props are primitives, so the default shallow compare is exact.
 */
export const DecorativeBlockie = memo(function DecorativeBlockie({
  address,
  size,
  slot,
  className,
}: {
  address: string
  size: number
  slot: string
  className?: string
}) {
  return (
    <span
      data-slot={slot}
      aria-hidden="true"
      className={cn('inline-flex shrink-0 overflow-hidden [&>svg]:size-full', className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: bloSvg is this repo's pure blo port, not user input — see the note on Blockie below.
      dangerouslySetInnerHTML={{ __html: bloSvg(address, size) }}
    />
  )
})

/**
 * Memoised for the same load-bearing reason `DecorativeBlockie` is: `bloSvg` builds ~64 <rect>s and
 * runs on every render, so anything that re-renders a caller without changing the address redraws a
 * picture that cannot have changed. In the result grid that is two hundred of them, and the tile's
 * own memo was the only thing standing between this and a redraw per publish — a guard that any
 * state added inside a tile, for any reason, would quietly defeat.
 *
 * All three props are primitives, so the default shallow compare is exact.
 */
export const Blockie = memo(function Blockie({ address, size = 64, className }: BlockieProps) {
  // bloSvg emits a self-contained <svg> built from numeric HSL values and integer coordinates
  // derived from the address; it never echoes the address string into the markup.
  return (
    <span
      aria-label={`Identicon for ${address}`}
      role="img"
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: bloSvg is this repo's pure blo port, not user input — see the comment above.
      dangerouslySetInnerHTML={{ __html: bloSvg(address, size) }}
    />
  )
})
