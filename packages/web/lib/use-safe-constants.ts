'use client'

import { loadSafeConstants, type SafeSetup } from '@safe-vanity-blockie/safe-config'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MineConfig } from './config'
import { chainById } from './wagmi'

/**
 * Reads chainId and the three CREATE2 constants once per config. Everything protocol-kit
 * touches stays on the main thread; workers receive plain hex.
 *
 * Keyed on the config OBJECT, so a caller that rebuilds it re-reads. The one config change that
 * happens under a live search is the header's chain picker, and for that the read is genuine — the
 * new chain's own RPC, its own singleton — while the answer, for the six chains that share a
 * singleton, comes back identical in value. Which is why what is already in hand is kept for the
 * length of the read (below) rather than being replaced by a loading state: the caller keeps
 * mining on constants that are still true instead of watching its worker pool torn down and the
 * grid replaced by a placeholder for an RPC round trip. What it must NOT do is outlive a failure —
 * see the catch — which is why the failure comes with `reload`.
 */
export function useSafeConstants(config: MineConfig | undefined): {
  data?: SafeSetup
  error?: string
  loading: boolean
  /**
   * Reads again for the same config. Exists because a re-read now happens under a live search
   * (the header's chain picker), and these are unauthenticated public RPCs: a rate-limited read
   * leaves a caller with a perfectly good run it is no longer allowed to mine, and the only way
   * out without one of these is a reload — which is precisely what throws the run away.
   */
  reload: () => void
} {
  const [state, setState] = useState<{ data?: SafeSetup; error?: string; loading: boolean }>({
    loading: false,
  })
  // Bumped by reload(), and a dependency of the read below, so asking again is the same code path
  // as asking the first time rather than a second one that could drift from it.
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is never read in here — it is the trigger, per the note above. Dropping it from the list makes reload() a no-op.
  useEffect(() => {
    if (!config) {
      setState({ loading: false })
      return
    }
    let cancelled = false
    // The previous config's constants stay on offer while this read is in flight. On the first
    // read there is nothing to keep, so this is the plain loading state it always was.
    setState((previous) => ({ data: previous.data, loading: true }))

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
        // The kept constants go here, deliberately: they belong to a config nobody is on any
        // more, and this hook has just failed to find out whether the current one agrees with
        // them. Reporting the failure with no data is what stops a caller mining on for a chain
        // whose constants were never read.
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
  }, [config, attempt])

  return useMemo(() => ({ ...state, reload }), [state, reload])
}
