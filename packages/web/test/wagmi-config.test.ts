import { describe, expect, it, vi } from 'vitest'
import { serialize } from 'wagmi'
import { wagmiConfig } from '../lib/wagmi'

// The app offers MetaMask and nothing else. Pinned here rather than left to the components,
// because this is the single place that decides it: `injected({ target: 'metaMask' })` both
// restricts the connector and switches off the EIP-6963 discovery that would otherwise add one
// connector — and, in the header, one button — per wallet the browser announces.
describe('wagmiConfig', () => {
  it('offers exactly one connector, and it is MetaMask', () => {
    expect(wagmiConfig.connectors).toHaveLength(1)
    expect(wagmiConfig.connectors[0]?.name).toMatch(/metamask/i)
  })
})

// The header's connect chip is server-rendered, and wagmi restores the previous connection from
// localStorage — which exists only in the browser. With the default `ssr: false`, that restore is
// applied while the module loads, so React's *first* client render already knows about an account
// the server's HTML could not: the header comes back as a wallet chip where the server sent a
// "Connect MetaMask" button, and hydration fails on the whole tree.
//
// `ssr: true` defers the restore to a mount effect, which is what this asserts: with a stored
// connection sitting in localStorage, the config a fresh import produces is still disconnected.
describe('wagmiConfig hydration', () => {
  it('does not restore a stored connection before the client mounts', async () => {
    const uid = 'stored-connection'
    window.localStorage.setItem(
      'wagmi.store',
      serialize({
        state: {
          chainId: 1,
          current: uid,
          connections: {
            __type: 'Map',
            value: [
              [
                uid,
                {
                  accounts: ['0x' + 'ab'.repeat(20)],
                  chainId: 1,
                  connector: { id: 'metaMask', name: 'MetaMask', type: 'injected', uid },
                },
              ],
            ],
          },
        },
        version: 3,
      }),
    )

    vi.resetModules()
    const { wagmiConfig: freshConfig } = await import('../lib/wagmi')
    // A tick, because wagmi's storage adapter is async: without `ssr: true` the restore lands in a
    // microtask, still well before React renders.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(freshConfig.state.status).toBe('disconnected')
    expect(freshConfig.state.connections.size).toBe(0)

    // And empty because the read has not happened yet, not because the fixture above went stale:
    // the restore is still pending, waiting for the mount effect to run it. That flag lives on the
    // same store wagmi's own `Hydrate` component reaches for on mount, and wagmi types it as
    // `never` from outside — hence the cast.
    const { store } = freshConfig._internal as unknown as {
      store: { persist: { hasHydrated: () => boolean } }
    }
    expect(store.persist.hasHydrated()).toBe(false)
  })
})
