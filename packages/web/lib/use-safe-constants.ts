'use client'

import { loadSafeConstants, type SafeSetup } from '@safe-vanity-blockie/safe-config'
import { useEffect, useState } from 'react'
import type { MineConfig } from './config'
import { chainById } from './wagmi'

/**
 * Reads chainId and the three CREATE2 constants once per config. Everything protocol-kit
 * touches stays on the main thread; workers receive plain hex.
 */
export function useSafeConstants(config: MineConfig | undefined): {
  data?: SafeSetup
  error?: string
  loading: boolean
} {
  const [state, setState] = useState<{ data?: SafeSetup; error?: string; loading: boolean }>({
    loading: false,
  })

  useEffect(() => {
    if (!config) {
      setState({ loading: false })
      return
    }
    let cancelled = false
    setState({ loading: true })

    const chain = chainById(config.chainId)
    const rpcUrl = chain.rpcUrls.default.http[0]

    loadSafeConstants({
      rpcUrl,
      owners: config.owners,
      threshold: config.threshold,
      safeVersion: config.safeVersion,
    })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [config])

  return state
}
