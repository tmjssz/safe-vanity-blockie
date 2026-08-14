import { bloSvg } from '@safe-vanity-blockie/core'
import { cn } from '../lib/utils'

export interface BlockieProps {
  address: string
  size?: number
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
 */
export function DecorativeBlockie({
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
      dangerouslySetInnerHTML={{ __html: bloSvg(address, size) }}
    />
  )
}

export function Blockie({ address, size = 64 }: BlockieProps) {
  // bloSvg emits a self-contained <svg> built from numeric HSL values and integer coordinates
  // derived from the address; it never echoes the address string into the markup.
  return (
    <span
      aria-label={`Identicon for ${address}`}
      role="img"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: bloSvg is this repo's pure blo port, not user input — see the comment above.
      dangerouslySetInnerHTML={{ __html: bloSvg(address, size) }}
    />
  )
}
