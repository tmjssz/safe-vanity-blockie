import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfigSection } from '../components/ConfigSection'

const CONFIG = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1' as const,
  chainId: 11155111,
}

describe('ConfigSection', () => {
  it('shows the form while no config is set', () => {
    render(<ConfigSection config={undefined} onSubmit={vi.fn()} onStartOver={vi.fn()} />)
    expect(screen.getByLabelText(/owners/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /start over/i })).toBeNull()
  })

  it('collapses to a one-line summary once a config is set', () => {
    render(<ConfigSection config={CONFIG} onSubmit={vi.fn()} onStartOver={vi.fn()} />)
    expect(screen.getByText(/1 owner/i)).toBeDefined()
    expect(screen.getByText(/threshold 1/i)).toBeDefined()
    expect(screen.getByText(/sepolia/i)).toBeDefined()
    expect(screen.queryByLabelText(/owners/i)).toBeNull()
  })

  it('pluralises the owner count', () => {
    render(
      <ConfigSection
        config={{ ...CONFIG, owners: [CONFIG.owners[0], '0x' + '22'.repeat(20)], threshold: 2 }}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/2 owners/i)).toBeDefined()
  })

  it('warns that starting over discards results, and only resets on confirmation', async () => {
    const onStartOver = vi.fn()
    render(<ConfigSection config={CONFIG} onSubmit={vi.fn()} onStartOver={onStartOver} />)

    await userEvent.click(screen.getByRole('button', { name: /start over…/i }))
    expect(screen.getByText(/discard/i)).toBeDefined()
    expect(onStartOver).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^start over$/i }))
    expect(onStartOver).toHaveBeenCalledOnce()
  })

  it('explains why the config is locked, since owners determine the address', () => {
    render(<ConfigSection config={CONFIG} onSubmit={vi.fn()} onStartOver={vi.fn()} />)
    expect(screen.getByText(/determine the safe address/i)).toBeDefined()
  })
})
