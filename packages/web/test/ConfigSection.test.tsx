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
    render(
      <ConfigSection
        config={undefined}
        chainId={CONFIG.chainId}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/^owner 1$/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /start over/i })).toBeNull()
  })

  it('collapses to a one-line summary once a config is set', () => {
    render(
      <ConfigSection
        config={CONFIG}
        chainId={CONFIG.chainId}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/1 owner/i)).toBeDefined()
    expect(screen.getByText(/threshold 1/i)).toBeDefined()
    expect(screen.getByText(/sepolia/i)).toBeDefined()
    expect(screen.queryByLabelText(/^owner 1$/i)).toBeNull()
  })

  it('pluralises the owner count', () => {
    render(
      <ConfigSection
        config={{ ...CONFIG, owners: [CONFIG.owners[0], '0x' + '22'.repeat(20)], threshold: 2 }}
        chainId={CONFIG.chainId}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/2 owners/i)).toBeDefined()
  })

  it('warns that starting over discards results, and only resets on confirmation', async () => {
    const onStartOver = vi.fn()
    render(
      <ConfigSection
        config={CONFIG}
        chainId={CONFIG.chainId}
        onSubmit={vi.fn()}
        onStartOver={onStartOver}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /start over…/i }))
    expect(screen.getByText(/discard/i)).toBeDefined()
    expect(onStartOver).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^start over$/i }))
    expect(onStartOver).toHaveBeenCalledOnce()
  })

  // A `?config=…` share link exists to reproduce one exact Safe address, and all four of the
  // fields it carries go into deriving it. If the prefill is dropped anywhere between the decoded
  // link and the form, the user retypes owners by hand — and one typo yields a different address,
  // silently, under the same blockie the link promised. So this asserts the seeding of every field
  // this card owns, not just that some prop was forwarded. The fourth, the chain, is the header's
  // now: it is asserted where it is rendered (test/page.test.tsx, on the link prefill) and only
  // its absence from the form is checked here.
  it('seeds the form from a decoded share link, field for field', () => {
    const owners = [CONFIG.owners[0], `0x${'22'.repeat(20)}`]
    render(
      <ConfigSection
        config={undefined}
        initial={{ owners, threshold: 2, safeVersion: '1.3.0' }}
        chainId={11155111}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )

    // One field per owner, each holding its own entry in the link's order — the assertion the
    // joined string could not make. A link with two owners that arrived as one box of text, or as
    // two boxes in the other order, is a different Safe.
    expect((screen.getByLabelText(/^owner 1$/i) as HTMLInputElement).value).toBe(owners[0])
    expect((screen.getByLabelText(/^owner 2$/i) as HTMLInputElement).value).toBe(owners[1])
    expect(screen.queryByLabelText(/^owner 3$/i)).toBeNull()
    // Radix renders each Select as a combobox, so this reads the trigger's displayed value.
    // Threshold is one of them now, so it is read the same way rather than as an input's value.
    expect(screen.getByRole('combobox', { name: /threshold/i }).textContent).toContain('2')
    expect(screen.getByText(/out of 2 signers/i)).toBeDefined()
    expect(screen.getByRole('combobox', { name: /safe version/i }).textContent).toContain('1.3.0')
    expect(screen.queryByRole('combobox', { name: /chain/i })).toBeNull()
  })

  // The chain it is handed still reaches the submitted config, even though it is no longer one of
  // this card's fields — the locked summary above reads it back off the config, so a chain dropped
  // between the header and the form would show up there as the wrong network, on a link that
  // names it, on the CLI command, and at the wallet.
  it('submits the chain it was given by the header', async () => {
    const onSubmit = vi.fn()
    render(
      <ConfigSection
        config={undefined}
        initial={{ owners: [CONFIG.owners[0]], threshold: 1, safeVersion: '1.4.1' }}
        chainId={137}
        onSubmit={onSubmit}
        onStartOver={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /^start$/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ chainId: 137 }))
  })

  // S4. CardTitle renders a <div> by default, so Configure, Face and Deploy were invisible to
  // heading navigation on a page whose whole premise is reading an address carefully.
  it('exposes its title as a real heading, in both the form and the locked state', () => {
    const { unmount } = render(
      <ConfigSection
        config={undefined}
        chainId={CONFIG.chainId}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: /^configure$/i })).toBeDefined()
    unmount()

    render(
      <ConfigSection
        config={CONFIG}
        chainId={CONFIG.chainId}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: /^configure$/i })).toBeDefined()
  })

  it('explains why the config is locked, since owners determine the address', () => {
    render(
      <ConfigSection
        config={CONFIG}
        chainId={CONFIG.chainId}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/determine the safe address/i)).toBeDefined()
  })
})
