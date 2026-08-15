'use client'

import type { MineConfig } from '../lib/config'
import { AboutDialog } from './AboutDialog'
import { ConfigForm, type ConfigFormProps } from './ConfigForm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

/**
 * The Configure card's measure. Narrower than the content column the results grid uses, because
 * this is a short stack of one-line answers rather than a field of cards.
 */
export const CARD_WIDTH = 'mx-auto w-full max-w-[520px]'

export function ConfigSection({
  initial,
  chainId,
  onSubmit,
}: {
  /**
   * Prefill for the form: a `?config=…` share link's decoded owners, or the config of the run
   * that "Start over" just discarded. Passed straight to ConfigForm.
   */
  initial?: ConfigFormProps['initial']
  /** The chain chosen in the header, which the form submits as part of the config. */
  chainId: number
  onSubmit: (config: MineConfig) => void
}) {
  return (
    // Narrow and centred, rather than the full content width the results grid uses. The card is a
    // short column of one-line answers; stretched to 1152px its inputs become long empty troughs
    // and the eye has to travel the width of the page between a label and its field.
    <Card className={CARD_WIDTH}>
      <CardHeader>
        <CardTitle as="h2">Safe configuration</CardTitle>
        {/* This card is the whole of the starting screen, so its subtitle is where a first-time
            visitor learns what the app does at all. It replaced a line about the fields re-rolling
            every result, which described the card as it was when it stayed mounted through a run:
            idle means no results on screen now, so that warning pointed at something no longer
            reachable from here. What determines the address is still said — in the dialog, along
            with everything else a sentence cannot hold. */}
        <CardDescription>
          Find a Safe address whose identicon renders as a face. <AboutDialog />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConfigForm initial={initial} chainId={chainId} onSubmit={onSubmit} />
      </CardContent>
    </Card>
  )
}
