import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CliHandoff, npxCommandFor } from '../components/CliHandoff'

const config = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '0x' + '22'.repeat(20)],
  threshold: 2,
  safeVersion: '1.4.1' as const,
  chainId: 1,
}

describe('npxCommandFor', () => {
  it('produces a command that runs the CLI with the same config', () => {
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example' })
    expect(command).toContain('npx safe-vanity-blockie')
    expect(command).toContain(`--owners ${config.owners.join(',')}`)
    expect(command).toContain('--threshold 2')
    expect(command).toContain('--safe-version 1.4.1')
    expect(command).toContain('--rpc https://rpc.example')
  })

  it('is a single line, so it can be pasted straight into a shell', () => {
    expect(npxCommandFor(config, { rpcUrl: 'https://rpc.example' })).not.toContain('\n')
  })
})

describe('CliHandoff', () => {
  it('explains why a user would want the CLI', () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    expect(screen.getByText(/longer/i)).toBeDefined()
  })
})
