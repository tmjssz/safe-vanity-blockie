'use client'

import type { MineConfig } from '../lib/config'
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
        {/* Under the heading, not beside the owners list. It is true of every field on this card,
            and it is the reason the card is gone for the duration of a run — so it belongs to the
            step, not to one of its fields. */}
        <CardDescription>
          Owners, threshold and version determine the address. Changing any of them re-rolls every
          result.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConfigForm initial={initial} chainId={chainId} onSubmit={onSubmit} />
      </CardContent>
    </Card>
  )
}
