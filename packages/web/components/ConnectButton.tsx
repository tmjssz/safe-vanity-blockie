'use client'

import { LogOut } from 'lucide-react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { DecorativeBlockie } from './Blockie'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      // A menu rather than a button that disconnects on click. The old chip read
      // "0x1A85…e9Ee — disconnect", which made the address and the action one label: the only way
      // to find out which account you were on was to read a control that would leave it. Splitting
      // them means the header answers "which account" at a glance and the destructive half is a
      // deliberate second step, with room for more account actions later.
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-2 font-mono">
            <DecorativeBlockie
              address={address}
              size={16}
              slot="account-identicon"
              className="size-4 rounded-sm"
            />
            {address.slice(0, 6)}…{address.slice(-4)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => disconnect()}>
            <LogOut aria-hidden="true" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
