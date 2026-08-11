'use client'

import { useState } from 'react'
import { SUPPORTED_CHAINS, type MineConfig } from '../lib/config'
import { ConfigForm } from './ConfigForm'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

function summarise(config: MineConfig): string {
  const chain = SUPPORTED_CHAINS.find((entry) => entry.id === config.chainId)
  const owners = `${config.owners.length} owner${config.owners.length === 1 ? '' : 's'}`
  return `${owners} · threshold ${config.threshold} · Safe ${config.safeVersion} · ${chain?.name ?? config.chainId}`
}

export function ConfigSection({
  config,
  onSubmit,
  onStartOver,
}: {
  config: MineConfig | undefined
  onSubmit: (config: MineConfig) => void
  onStartOver: () => void
}) {
  const [open, setOpen] = useState(false)

  if (!config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Configure</CardTitle>
        </CardHeader>
        <CardContent>
          <ConfigForm onSubmit={onSubmit} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Configure</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{summarise(config)}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Start over…
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start over?</DialogTitle>
              <DialogDescription>
                Owners, threshold, Safe version and chain determine the Safe address, so
                changing them will discard every result found so far and any selected result.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Keep mining</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  setOpen(false)
                  onStartOver()
                }}
              >
                Start over
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          These fields determine the Safe address, so they are locked while mining.
        </p>
      </CardContent>
    </Card>
  )
}
