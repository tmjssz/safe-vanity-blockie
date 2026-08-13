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
  it('when connected, shows the truncated address and disconnects on click', async () => {
    const address = '0x' + 'ab'.repeat(20)
    useAccountMock.mockReturnValue({ address, isConnected: true })
    useConnectMock.mockReturnValue({ connect: connectMock, connectors: [], isPending: false })

    render(<ConnectButton />)

    const button = screen.getByRole('button', { name: /0xabab.*abab.*disconnect/i })
    await userEvent.click(button)

    expect(disconnectMock).toHaveBeenCalledOnce()
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
