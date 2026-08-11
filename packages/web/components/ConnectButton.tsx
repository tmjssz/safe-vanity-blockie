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

  return (
    <>
      {connectors.map((connector) => (
        <Button
          key={connector.uid}
          type="button"
          variant="default"
          size="sm"
          disabled={isPending}
          onClick={() => connect({ connector })}
        >
          Connect {connector.name}
        </Button>
      ))}
      {connectors.length === 0 && <p className="text-sm text-muted-foreground">No browser wallet detected.</p>}
    </>
  )
}
