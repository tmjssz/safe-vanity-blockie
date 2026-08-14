import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfigSection } from '../components/ConfigSection'

// ConfigForm reads the connected account to prefill owner 1. Nothing here is about the wallet, so
// it answers "disconnected" throughout — without this the form renders with no WagmiProvider.
vi.mock('wagmi', () => ({ useAccount: () => ({ address: undefined, isConnected: false }) }))

const CONFIG = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1' as const,
  chainId: 11155111,
}

const SUBTITLE =
  'Owners, threshold and version determine the address. Changing any of them re-rolls every result.'

/**
 * Every case here renders the same card and differs in one or two props. The helper keeps each
 * test to the prop it is actually about, and means the next required prop is added in one place
 * rather than eleven.
 */
function renderSection(overrides: Partial<Parameters<typeof ConfigSection>[0]> = {}) {
  return render(
    <ConfigSection chainId={CONFIG.chainId} onSubmit={vi.fn()} {...overrides} />,
  )
}

const ownerField = (n: number) =>
  screen.getByLabelText(new RegExp(`^owner ${n}$`, 'i')) as HTMLInputElement

describe('ConfigSection', () => {
  // Exact copy, because this is the one line that tells a user why the fields lock and why a
  // result set can vanish. It sits under the heading rather than beside the owners list: it is a
  // property of every field in the card, not a footnote to one of them.
  it('states under the heading what determines the address', () => {
    renderSection()
    expect(screen.getByText(SUBTITLE)).toBeDefined()
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
    renderSection({ initial: { owners, threshold: 2, safeVersion: '1.3.0' }, chainId: 11155111 })

    // One field per owner, each holding its own entry in the link's order — the assertion the
    // joined string could not make. A link with two owners that arrived as one box of text, or as
    // two boxes in the other order, is a different Safe.
    expect(ownerField(1).value).toBe(owners[0])
    expect(ownerField(2).value).toBe(owners[1])
    expect(screen.queryByLabelText(/^owner 3$/i)).toBeNull()
    // Radix renders each Select as a combobox, so this reads the trigger's displayed value.
    expect(screen.getByRole('combobox', { name: /threshold/i }).textContent).toContain('2')
    expect(screen.getByText(/out of 2 signers/i)).toBeDefined()
    expect(screen.getByRole('combobox', { name: /safe version/i }).textContent).toContain('1.3.0')
    expect(screen.queryByRole('combobox', { name: /chain/i })).toBeNull()
  })

  // The chain it is handed still reaches the submitted config, even though it is no longer one of
  // this card's fields — a chain dropped between the header and the form would show up as the
  // wrong network on a link that names it, on the CLI command, and at the wallet.
  it('submits the chain it was given by the header', async () => {
    const onSubmit = vi.fn()
    renderSection({
      initial: { owners: [CONFIG.owners[0]], threshold: 1, safeVersion: '1.4.1' },
      chainId: 137,
      onSubmit,
    })

    await userEvent.click(screen.getByRole('button', { name: /^start mining$/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ chainId: 137 }))
  })


  // S4. CardTitle renders a <div> by default, so Configure, Face and Deploy were invisible to
  // heading navigation on a page whose whole premise is reading an address carefully.
  it('exposes its title as a real heading', () => {
    renderSection()
    expect(screen.getByRole('heading', { level: 2, name: /^configure$/i })).toBeDefined()
  })

  // The card is the idle state and nothing else: the page unmounts it the moment a run starts, so
  // it carries no run controls of its own. "Start over" belongs to the status bar, which is the
  // only thing on screen while mining.
  it('carries no run controls', () => {
    renderSection()
    expect(screen.queryByRole('button', { name: /start over/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /stop mining/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^start mining$/i })).toBeDefined()
  })
})
