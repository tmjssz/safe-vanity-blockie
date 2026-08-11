'use client'

import { useState } from 'react'
import {
  type ConfigErrors,
  type MineConfig,
  SUPPORTED_CHAINS,
  SUPPORTED_SAFE_VERSIONS,
  validateMineConfig,
} from '../lib/config'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

export interface ConfigFormProps {
  initial?: Partial<{ owners: string; threshold: number; safeVersion: string; chainId: number }>
  onSubmit: (config: MineConfig) => void
}

export function ConfigForm({ initial, onSubmit }: ConfigFormProps) {
  const [owners, setOwners] = useState(initial?.owners ?? '')
  const [threshold, setThreshold] = useState(initial?.threshold ?? 1)
  const [safeVersion, setSafeVersion] = useState(initial?.safeVersion ?? '1.4.1')
  const [chainId, setChainId] = useState(initial?.chainId ?? 1)
  const [errors, setErrors] = useState<ConfigErrors>({})

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const result = validateMineConfig({
      owners: owners.split(',').map((owner) => owner.trim()),
      threshold,
      safeVersion,
      chainId,
    })
    setErrors(result.errors)
    if (result.config) onSubmit(result.config)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="owners">Owners (comma-separated)</Label>
        <Input
          id="owners"
          value={owners}
          onChange={(event) => setOwners(event.target.value)}
          placeholder="0x…, 0x…"
        />
        <p className="text-sm text-muted-foreground">
          Owners are part of the Safe address — changing them re-rolls every result.
        </p>
        {errors.owners && (
          <p role="alert" className="text-sm text-destructive">
            {errors.owners}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="threshold">Threshold</Label>
        <Input
          id="threshold"
          type="number"
          min={1}
          value={threshold}
          onChange={(event) => setThreshold(Number(event.target.value))}
        />
        {errors.threshold && (
          <p role="alert" className="text-sm text-destructive">
            {errors.threshold}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="safeVersion">Safe version</Label>
        <Select value={safeVersion} onValueChange={setSafeVersion}>
          <SelectTrigger id="safeVersion" aria-label="Safe version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_SAFE_VERSIONS.map((version) => (
              <SelectItem key={version} value={version}>
                {version}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.safeVersion && (
          <p role="alert" className="text-sm text-destructive">
            {errors.safeVersion}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="chainId">Chain</Label>
        <Select value={String(chainId)} onValueChange={(value) => setChainId(Number(value))}>
          <SelectTrigger id="chainId" aria-label="Chain">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_CHAINS.map((chain) => (
              <SelectItem key={chain.id} value={String(chain.id)}>
                {chain.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.chainId && (
          <p role="alert" className="text-sm text-destructive">
            {errors.chainId}
          </p>
        )}
      </div>

      <Button type="submit">Continue</Button>
    </form>
  )
}
