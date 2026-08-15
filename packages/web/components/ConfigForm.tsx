'use client'

import { useState } from 'react'
import {
  type ConfigErrors,
  type MineConfig,
  SUPPORTED_CHAINS,
  SUPPORTED_SAFE_VERSIONS,
  validateMineConfig,
} from '../lib/config'

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
    <form onSubmit={submit} noValidate>
      <label htmlFor="owners">Owners (comma-separated)</label>
      <input
        id="owners"
        value={owners}
        onChange={(event) => setOwners(event.target.value)}
        placeholder="0x…, 0x…"
      />
      <p className="hint">
        Owners are part of the Safe address — changing them re-rolls every result.
      </p>
      {errors.owners && <p role="alert">{errors.owners}</p>}

      <label htmlFor="threshold">Threshold</label>
      <input
        id="threshold"
        type="number"
        min={1}
        value={threshold}
        onChange={(event) => setThreshold(Number(event.target.value))}
      />
      {errors.threshold && <p role="alert">{errors.threshold}</p>}

      <label htmlFor="safeVersion">Safe version</label>
      <select
        id="safeVersion"
        value={safeVersion}
        onChange={(event) => setSafeVersion(event.target.value)}
      >
        {SUPPORTED_SAFE_VERSIONS.map((version) => (
          <option key={version} value={version}>
            {version}
          </option>
        ))}
      </select>
      {errors.safeVersion && <p role="alert">{errors.safeVersion}</p>}

      <label htmlFor="chainId">Chain</label>
      <select
        id="chainId"
        value={chainId}
        onChange={(event) => setChainId(Number(event.target.value))}
      >
        {SUPPORTED_CHAINS.map((chain) => (
          <option key={chain.id} value={chain.id}>
            {chain.name}
          </option>
        ))}
      </select>
      {errors.chainId && <p role="alert">{errors.chainId}</p>}

      <button type="submit">Continue</button>
    </form>
  )
}
