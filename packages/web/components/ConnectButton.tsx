'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { Button } from './ui/button'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => disconnect()}>
        {address.slice(0, 6)}…{address.slice(-4)} — disconnect
      </Button>
    )
  }

  // One button, not one per connector: lib/wagmi configures MetaMask alone, which also switches
  // off the EIP-6963 discovery that used to add a connector — and so a button — for every wallet
  // the browser announced. Still written defensively rather than as `connectors[0]!`, so that
  // adding a connector back shows a button instead of silently connecting the first one.
  const connector = connectors[0]
  if (!connector) return <p className="text-sm text-muted-foreground">No browser wallet detected.</p>

  return (
    <Button
      type="button"
      variant="default"
      size="sm"
      disabled={isPending}
      onClick={() => connect({ connector })}
    >
      Connect {connector.name}
    </Button>
  )
}
