'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      <button type="button" onClick={() => disconnect()}>
        {address.slice(0, 6)}…{address.slice(-4)} — disconnect
      </button>
    )
  }

  return (
    <>
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          type="button"
          disabled={isPending}
          onClick={() => connect({ connector })}
        >
          Connect {connector.name}
        </button>
      ))}
      {connectors.length === 0 && <p>No browser wallet detected.</p>}
    </>
  )
}
