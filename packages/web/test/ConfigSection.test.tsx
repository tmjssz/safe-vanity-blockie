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
    <ConfigSection
      config={undefined}
      chainId={CONFIG.chainId}
      miningPaused={false}
      onSubmit={vi.fn()}
      onToggleMining={vi.fn()}
      onStartOver={vi.fn()}
      {...overrides}
    />,
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

  it('shows the form, and no way to start over, before anything is submitted', () => {
    renderSection()
    expect(ownerField(1)).toBeDefined()
    expect(screen.queryByRole('button', { name: /start over/i })).toBeNull()
  })

  // Replaces "collapses to a one-line summary once a config is set". The card no longer swaps
  // itself for a précis: the Stop control lives in the form, so the form has to still be there,
  // and leaving the fields on screen means the config being mined is legible directly rather than
  // reconstructed from a summary line. What used to be expressed by REPLACING the fields is now
  // expressed by locking them.
  it('keeps the form on screen once a config is set, with its fields locked', () => {
    renderSection({ config: CONFIG, initial: { owners: CONFIG.owners } })

    expect(ownerField(1).value).toBe(CONFIG.owners[0])
    expect(ownerField(1).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /^stop mining$/i })).toBeDefined()
    // The reason the fields are locked stays on screen with them.
    expect(screen.getByText(SUBTITLE)).toBeDefined()
  })

  it('unlocks the fields once mining is stopped', () => {
    renderSection({ config: CONFIG, initial: { owners: CONFIG.owners }, miningPaused: true })
    expect(ownerField(1).disabled).toBe(false)
    expect(screen.getByRole('button', { name: /^start mining$/i })).toBeDefined()
  })

  it('offers to start over only once there is a run to discard', () => {
    renderSection({ config: CONFIG })
    expect(screen.getByRole('button', { name: /start over…/i })).toBeDefined()
  })

  it('warns that starting over discards results, and only resets on confirmation', async () => {
    const onStartOver = vi.fn()
    renderSection({ config: CONFIG, onStartOver })

    await userEvent.click(screen.getByRole('button', { name: /start over…/i }))
    expect(screen.getByText(/will discard every result found so far/i)).toBeDefined()
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

  it('halts the run from the card rather than resubmitting it', async () => {
    const onToggleMining = vi.fn()
    const onSubmit = vi.fn()
    renderSection({ config: CONFIG, onToggleMining, onSubmit })

    await userEvent.click(screen.getByRole('button', { name: /^stop mining$/i }))

    expect(onToggleMining).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // S4. CardTitle renders a <div> by default, so Configure, Face and Deploy were invisible to
  // heading navigation on a page whose whole premise is reading an address carefully.
  it('exposes its title as a real heading, running or not', () => {
    const { unmount } = renderSection()
    expect(screen.getByRole('heading', { level: 2, name: /^configure$/i })).toBeDefined()
    unmount()

    renderSection({ config: CONFIG })
    expect(screen.getByRole('heading', { level: 2, name: /^configure$/i })).toBeDefined()
  })
})
