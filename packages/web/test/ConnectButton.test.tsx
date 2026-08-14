import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectButton } from '../components/ConnectButton'

// Hoisted so each test can drive its own wagmi state — a module-scoped factory can only ever
// return one fixed state, which would mean every test rendered the same branch of ConnectButton.
const { useAccountMock, useConnectMock, useDisconnectMock, connectMock, disconnectMock } =
  vi.hoisted(() => ({
    useAccountMock: vi.fn(),
    useConnectMock: vi.fn(),
    useDisconnectMock: vi.fn(),
    connectMock: vi.fn(),
    disconnectMock: vi.fn(),
  }))

vi.mock('wagmi', () => ({
  useAccount: useAccountMock,
  useConnect: useConnectMock,
  useDisconnect: useDisconnectMock,
}))

beforeEach(() => {
  connectMock.mockReset()
  disconnectMock.mockReset()
  useAccountMock.mockReset()
  useConnectMock.mockReset()
  useDisconnectMock.mockReset().mockReturnValue({ disconnect: disconnectMock })
})

describe('ConnectButton', () => {
  // The chip is a menu now, not a button whose label doubled as its action. The address is the
  // whole label: what the header answers is "which account am I on", and disconnecting is a thing
  // you go looking for rather than something the chip has to keep announcing.
  it('when connected, shows the truncated address as a menu trigger', () => {
    const address = '0x' + 'ab'.repeat(20)
    useAccountMock.mockReturnValue({ address, isConnected: true })
    useConnectMock.mockReturnValue({ connect: connectMock, connectors: [], isPending: false })

    render(<ConnectButton />)

    const trigger = screen.getByRole('button', { name: /0xabab.*abab/i })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(disconnectMock).not.toHaveBeenCalled()
  })

  it('disconnects from the menu, not from the chip itself', async () => {
    const address = '0x' + 'ab'.repeat(20)
    useAccountMock.mockReturnValue({ address, isConnected: true })
    useConnectMock.mockReturnValue({ connect: connectMock, connectors: [], isPending: false })

    render(<ConnectButton />)

    await userEvent.click(screen.getByRole('button', { name: /0xabab.*abab/i }))
    // Opening the menu must not be the same gesture as leaving the wallet.
    expect(disconnectMock).not.toHaveBeenCalled()

    await userEvent.click(await screen.findByRole('menuitem', { name: /disconnect/i }))
    expect(disconnectMock).toHaveBeenCalledOnce()
  })

  // The chip carries the connected address, and this app's way of showing an address is its
  // identicon. It is decorative here: the address itself is right beside it in text.
  it('shows the account identicon in the chip, hidden from assistive tech', () => {
    const address = '0x' + 'ab'.repeat(20)
    useAccountMock.mockReturnValue({ address, isConnected: true })
    useConnectMock.mockReturnValue({ connect: connectMock, connectors: [], isPending: false })

    const { container } = render(<ConnectButton />)

    const identicon = container.querySelector('[data-slot="account-identicon"]')
    expect(identicon).not.toBeNull()
    expect(identicon?.getAttribute('aria-hidden')).toBe('true')
    expect(identicon?.querySelector('svg')).not.toBeNull()
  })

  it('spells the chip without an em dash', () => {
    const address = '0x' + 'ab'.repeat(20)
    useAccountMock.mockReturnValue({ address, isConnected: true })
    useConnectMock.mockReturnValue({ connect: connectMock, connectors: [], isPending: false })

    render(<ConnectButton />)

    expect(document.body.textContent ?? '').not.toContain('—')
  })

  it('when disconnected with a wallet available, connects on click', async () => {
    const connector = { uid: 'injected-1', name: 'MetaMask' }
    useAccountMock.mockReturnValue({ address: undefined, isConnected: false })
    useConnectMock.mockReturnValue({
      connect: connectMock,
      connectors: [connector],
      isPending: false,
    })

    render(<ConnectButton />)

    const button = screen.getByRole('button', { name: 'Connect MetaMask' })
    await userEvent.click(button)

    expect(connectMock).toHaveBeenCalledWith({ connector })
  })

  // The header used to render one button per connector, so a browser announcing several wallets
  // via EIP-6963 grew a row of them. lib/wagmi now pins the connector to MetaMask, but the
  // component must not go back to multiplying either — this fails the moment it maps again.
  it('renders one connect button even if several connectors are announced', () => {
    useAccountMock.mockReturnValue({ address: undefined, isConnected: false })
    useConnectMock.mockReturnValue({
      connect: connectMock,
      connectors: [
        { uid: 'injected-1', name: 'MetaMask' },
        { uid: 'injected-2', name: 'Rabby' },
      ],
      isPending: false,
    })

    render(<ConnectButton />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /rabby/i })).toBeNull()
  })

  it('when disconnected with no wallet available, shows the fallback message and no connect button', () => {
    useAccountMock.mockReturnValue({ address: undefined, isConnected: false })
    useConnectMock.mockReturnValue({ connect: connectMock, connectors: [], isPending: false })

    render(<ConnectButton />)

    expect(screen.getByText('No browser wallet detected.')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
