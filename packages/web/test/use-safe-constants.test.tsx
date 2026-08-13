import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MineConfig } from '../lib/config'
import { useSafeConstants } from '../lib/use-safe-constants'

const { loadSafeConstantsMock } = vi.hoisted(() => ({ loadSafeConstantsMock: vi.fn() }))

vi.mock('@safe-vanity-blockie/safe-config', () => ({
  loadSafeConstants: loadSafeConstantsMock,
  ZKSYNC_CHAIN_IDS: new Set(),
}))

const SEPOLIA = {
  owners: ['0x' + '11'.repeat(20)],
  threshold: 1,
  safeVersion: '1.4.1',
  chainId: 11155111,
} as MineConfig
const POLYGON = { ...SEPOLIA, chainId: 137 }

const setupFor = (chainId: bigint) => ({
  chainId,
  constants: {
    initializerHash: new Uint8Array(32),
    factory: new Uint8Array(20),
    initCodeHash: new Uint8Array(32),
  },
  constantsHex: {
    initializerHash: '0x11',
    factory: '0x22',
    initCodeHash: '0x33',
  },
})

beforeEach(() => {
  loadSafeConstantsMock.mockReset()
})

describe('useSafeConstants', () => {
  it('keeps the constants it already has while it re-reads for a new config', async () => {
    let release: (setup: unknown) => void = () => {}
    loadSafeConstantsMock
      .mockResolvedValueOnce(setupFor(11155111n))
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))

    const { result, rerender } = renderHook(({ config }) => useSafeConstants(config), {
      initialProps: { config: SEPOLIA },
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const first = result.current.data

    rerender({ config: POLYGON })

    // The chain picker is in the header, so this happens under a live search. Dropping to
    // `{ loading: true }` with no data would take the worker pool down and replace the whole grid
    // with a placeholder for the length of an RPC round trip — for a read that, among the six
    // chains sharing a Safe singleton, is about to come back saying exactly the same thing.
    await waitFor(() => expect(loadSafeConstantsMock).toHaveBeenCalledTimes(2))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBe(first)

    release(setupFor(137n))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).not.toBe(first)
    expect(result.current.data?.chainId).toBe(137n)
  })

  it('drops the constants it was holding when the new read fails', async () => {
    let reject: (error: Error) => void = () => {}
    loadSafeConstantsMock
      .mockResolvedValueOnce(setupFor(11155111n))
      .mockImplementationOnce(() => new Promise((_, rejectRead) => (reject = rejectRead)))

    const { result, rerender } = renderHook(({ config }) => useSafeConstants(config), {
      initialProps: { config: SEPOLIA },
    })
    await waitFor(() => expect(result.current.data).toBeDefined())

    rerender({ config: POLYGON })
    await waitFor(() => expect(loadSafeConstantsMock).toHaveBeenCalledTimes(2))
    reject(new Error('rate limited by the public RPC'))

    // The kept constants belong to a config nobody is on any more, and whether the current one
    // agrees with them is exactly what just failed to be established. Reporting the failure with
    // no data is what stops a caller mining on regardless.
    await waitFor(() => expect(result.current.error).toMatch(/rate limited/))
    expect(result.current.data).toBeUndefined()
    expect(result.current.loading).toBe(false)
  })

  it('clears everything when there is no config to read for', async () => {
    loadSafeConstantsMock.mockResolvedValue(setupFor(11155111n))

    const { result, rerender } = renderHook(
      ({ config }: { config: MineConfig | undefined }) => useSafeConstants(config),
      { initialProps: { config: SEPOLIA as MineConfig | undefined } },
    )
    await waitFor(() => expect(result.current.data).toBeDefined())

    rerender({ config: undefined })

    expect(result.current.data).toBeUndefined()
    expect(result.current.loading).toBe(false)
  })
})
