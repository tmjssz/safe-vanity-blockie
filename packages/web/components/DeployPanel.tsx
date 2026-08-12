'use client'

import { type Candidate, formatScore } from '@safe-vanity-blockie/core'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import type { MineConfig } from '../lib/config'
import { Blockie } from './Blockie'
import { DeployDialog } from './DeployDialog'
import { ShareConfig } from './ShareConfig'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card'

export interface DeployPanelProps {
  config: MineConfig
  candidate: Candidate
  /**
   * Passed straight through to DeployDialog, which owns the deploy sequence: mining pauses when
   * the transaction is initiated, not when this panel appears.
   */
  onDeployStart: () => void
  onDeploySettled: () => void
}

export function DeployPanel({
  config,
  candidate,
  onDeployStart,
  onDeploySettled,
}: DeployPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Deploy</CardTitle>
          <CardAction>
            <Badge variant="secondary">{formatScore(candidate.score, candidate.maxScore)}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <Blockie address={candidate.address} size={128} />
            <div className="flex min-w-0 flex-col gap-1">
              <code className="break-all text-sm">{candidate.address}</code>
              <code className="text-xs text-muted-foreground">saltNonce {candidate.saltNonce}</code>
            </div>
          </div>
          {/* role="note", not the Alert default role="alert": this caveat is always on screen
              and static, so leaving it as a live region makes it compete permanently with the
              real deploy error rendered in the dialog. `main`'s SecurityNotice was a note too. */}
          <Alert role="note">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>A matching identicon is cosmetic.</AlertTitle>
            <AlertDescription>
              Verify the full address before you send anything — a look-alike blockie is a known
              phishing vector.
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            This config is counterfactual: the address exists whether or not you deploy, so you can
            copy it and deploy it later, on any chain with the canonical Safe contracts.
          </p>
          <ShareConfig config={{ ...config, saltNonce: candidate.saltNonce }} />
        </CardContent>
        <CardFooter>
          {/* Opens the dialog only — every wallet interaction, every address guard and the
              pause/resume of mining live in DeployDialog. It is a plain Button rather than a
              DialogTrigger (the dialog is rendered as a sibling, not a child), so the two ARIA
              attributes DialogTrigger would have supplied are set by hand. */}
          <Button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            Deploy this Safe…
          </Button>
        </CardFooter>
      </Card>
      <DeployDialog
        open={open}
        candidate={candidate}
        config={config}
        onOpenChange={setOpen}
        onDeployStart={onDeployStart}
        onDeploySettled={onDeploySettled}
      />
    </>
  )
}
