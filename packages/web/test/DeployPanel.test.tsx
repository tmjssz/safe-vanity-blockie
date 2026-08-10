import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeployPanel } from '../components/DeployPanel'

vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: false, address: undefined, chainId: 1 }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useConnectorClient: () => ({ data: undefined }),
}))

const candidate = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

const config = { owners: ['0x' + '11'.repeat(20)], threshold: 1, safeVersion: '1.4.1', chainId: 1 }

describe('DeployPanel', () => {
  it('asks for a wallet before offering to deploy', () => {
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByText(/connect a wallet/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /^deploy/i })).toBeNull()
  })

  it('repeats the phishing caveat where the user is about to spend money', () => {
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByText(/cosmetic/i)).toBeDefined()
  })

  it('always shows the counterfactual alternative, so deploying is not the only path', () => {
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByText(/deploy it later/i)).toBeDefined()
  })
})
