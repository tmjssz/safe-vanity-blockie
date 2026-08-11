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

  it('passes the two-color and min-contrast filters through, so the CLI search enforces the same standard', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      filters: { twoColor: true, minContrast: 250 },
    })
    expect(command).toContain('--two-color')
    expect(command).not.toContain('--no-two-color')
    expect(command).toContain('--min-contrast 250')
  })

  it('passes --no-two-color when the two-colour filter is off', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      filters: { twoColor: false, minContrast: 0 },
    })
    expect(command).toContain('--no-two-color')
  })

  it('omits filter flags entirely when no filters are given', () => {
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example' })
    expect(command).not.toContain('--two-color')
    expect(command).not.toContain('--no-two-color')
    expect(command).not.toContain('--min-contrast')
  })
})

describe('CliHandoff', () => {
  it('explains why a user would want the CLI', () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    expect(screen.getByText(/longer/i)).toBeDefined()
  })

  it('warns that a narrowed subset of expressions has no builtin CLI target', () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    expect(screen.getByText(/full set of faces/i)).toBeDefined()
  })

  it('includes the live filters in the handed-off command', () => {
    render(
      <CliHandoff
        config={config}
        rpcUrl="https://rpc.example"
        filters={{ twoColor: false, minContrast: 300 }}
      />,
    )
    expect(screen.getByText(/--no-two-color/)).toBeDefined()
    expect(screen.getByText(/--min-contrast 300/)).toBeDefined()
  })
})
