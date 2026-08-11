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

  it('when disconnected with no wallet available, shows the fallback message and no connect button', () => {
    useAccountMock.mockReturnValue({ address: undefined, isConnected: false })
    useConnectMock.mockReturnValue({ connect: connectMock, connectors: [], isPending: false })

    render(<ConnectButton />)

    expect(screen.getByText('No browser wallet detected.')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
