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

  // A `?config=…` share link exists to reproduce one exact Safe address, and all four of these
  // fields go into deriving it. If the prefill is dropped anywhere between the decoded link and
  // the form, the user retypes owners by hand — and one typo yields a different address, silently,
  // under the same blockie the link promised. So this asserts the seeding of every field, not
  // just that some prop was forwarded.
  it('seeds the form from a decoded share link, field for field', () => {
    const owners = `${CONFIG.owners[0]}, 0x${'22'.repeat(20)}`
    render(
      <ConfigSection
        config={undefined}
        initial={{ owners, threshold: 2, safeVersion: '1.3.0', chainId: 11155111 }}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )

    expect((screen.getByLabelText(/owners/i) as HTMLInputElement).value).toBe(owners)
    expect((screen.getByLabelText(/threshold/i) as HTMLInputElement).value).toBe('2')
    // Radix renders each Select as a combobox, so this reads the trigger's displayed value.
    expect(screen.getByRole('combobox', { name: /safe version/i }).textContent).toContain('1.3.0')
    expect(screen.getByRole('combobox', { name: /chain/i }).textContent).toContain('Sepolia')
  })

  // S4. CardTitle renders a <div> by default, so Configure, Face and Deploy were invisible to
  // heading navigation on a page whose whole premise is reading an address carefully.
  it('exposes its title as a real heading, in both the form and the locked state', () => {
    const { unmount } = render(
      <ConfigSection config={undefined} onSubmit={vi.fn()} onStartOver={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { level: 2, name: /^configure$/i })).toBeDefined()
    unmount()

    render(<ConfigSection config={CONFIG} onSubmit={vi.fn()} onStartOver={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 2, name: /^configure$/i })).toBeDefined()
  })

  it('explains why the config is locked, since owners determine the address', () => {
    render(<ConfigSection config={CONFIG} onSubmit={vi.fn()} onStartOver={vi.fn()} />)
    expect(screen.getByText(/determine the safe address/i)).toBeDefined()
  })
})
