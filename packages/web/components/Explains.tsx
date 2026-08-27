'use client'

import { Info } from 'lucide-react'
import { HintPopover } from './ui/hint-popover'

/**
 * The small info icon that carries a control's explanation, one press away.
 *
 * The prose it holds is read once and then never again, but left on the page it sat between the
 * reader and the controls on every visit for the rest of the session. Behind an icon it costs a
 * press the first time and nothing after that.
 *
 * `HintPopover` opens on hover, click AND keyboard focus, so this is not a hover-only affordance a
 * touch or keyboard user cannot reach — which is the whole reason a bare `title` attribute is not
 * what this is built from.
 *
 * Extracted from FacePicker, where it was private, once Configure's "Start from saltNonce" field
 * needed the same treatment. It is the shape of the pattern rather than one instance of it: two
 * copies would be two things free to drift into looking like different affordances for the same
 * job, on two cards a user meets one after the other.
 */
export function Explains({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <HintPopover
      // Named for what it explains, not "info": a screen reader user meets a list of buttons, and
      // "About minimum match" says which one this is where "info" says only that it exists.
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
