import { render, screen, waitFor } from '@testing-library/react'
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

const SUBTITLE = 'Find a Safe address whose identicon renders as a face.'

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
  // The card is the whole of the starting screen, so its subtitle is where a first-time visitor
  // finds out what the app does at all. It replaced a line about the fields re-rolling results,
  // which described the card as it was when it stayed mounted through a run: idle means no
  // results on screen now, so that warning was about something no longer reachable from here.
  it('says what the app does, under the heading', () => {
    renderSection()
    expect(screen.getByText(SUBTITLE)).toBeDefined()
  })

  // One sentence cannot carry the mechanism, the counterfactual address and the phishing caveat,
  // and a card that opened with all three would bury the form. The detail is one click away
  // instead — and the caveat in particular has nowhere else to live on this screen, since the
  // callout that carries it only appears once a run starts.
  describe('the "Learn more" dialog', () => {
    it('is closed until asked for', () => {
      renderSection()
      expect(screen.getByRole('button', { name: /learn more/i })).toBeDefined()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('explains how the search works', async () => {
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: /learn more/i }))

      const dialog = await screen.findByRole('dialog')
      const text = dialog.textContent ?? ''
      expect(text).toMatch(/salt nonce/i)
      expect(text).toMatch(/owners, threshold/i)
    })

    it('says that searching deploys nothing', async () => {
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: /learn more/i }))

      const text = (await screen.findByRole('dialog')).textContent ?? ''
      expect(text).toMatch(/nothing is deployed/i)
    })

    it('says the search runs on your own machine', async () => {
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: /learn more/i }))

      const text = (await screen.findByRole('dialog')).textContent ?? ''
      expect(text).toMatch(/browser/i)
      expect(text).toMatch(/worker threads/i)
    })

    // The one place this warning appears before a run exists. The callout that normally carries
    // it is deliberately withheld until mining starts, so without this the first screen says
    // nothing at all about a matching identicon proving nothing.
    it('carries the phishing caveat, which nothing else on the idle screen does', async () => {
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: /learn more/i }))

      const text = (await screen.findByRole('dialog')).textContent ?? ''
      expect(text).toMatch(/cosmetic/i)
      expect(text).toMatch(/phishing vector/i)
      expect(text).toMatch(/verify the full address/i)
    })

    // The footer offers the same dialog from an info icon, so the trigger is a prop rather than
    // baked in. The card's own trigger is the default, and this pins that it stays a text link
    // rather than silently becoming whatever the last caller passed.
    it('is opened from a text link, not an icon, on the card', () => {
      renderSection()
      const trigger = screen.getByRole('button', { name: /learn more/i })
      expect(trigger.textContent).toBe('Learn more')
    })

    // The caveat is not another paragraph of explanation: it is the one thing in here a reader
    // must not skim past, so it is set as a warning box rather than as a fourth section heading.
    // Same treatment as the callout that appears once mining starts, so the two are recognisably
    // the same warning rather than two differently-worded ones.
    it('sets the cosmetic caveat apart as a warning box', async () => {
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: /learn more/i }))
      const dialog = await screen.findByRole('dialog')

      const alert = dialog.querySelector('[data-slot="alert"]')
      expect(alert).not.toBeNull()
      expect(alert?.textContent).toMatch(/a matching identicon is cosmetic/i)
      expect(alert?.textContent).toMatch(/phishing vector/i)
      expect(alert?.className).toMatch(/amber/)
      expect(alert?.querySelector('svg')).not.toBeNull()

      // The other three sections stay plain prose — a dialog of four warning boxes warns about
      // nothing.
      expect(dialog.querySelectorAll('[data-slot="alert"]')).toHaveLength(1)
    })

    // Static copy, not an event. Armed as a live region inside a dialog that has just been opened
    // and announced, it would read the caveat out a second time on top of the dialog itself.
    it('does not arm the caveat as a live region', async () => {
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: /learn more/i }))
      const dialog = await screen.findByRole('dialog')

      expect(dialog.querySelector('[role="alert"]')).toBeNull()
      expect(dialog.querySelector('[data-slot="alert"]')?.getAttribute('role')).toBe('note')
    })

    it('closes again without touching the form', async () => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()
      renderSection({ onSubmit })

      await user.click(screen.getByRole('button', { name: /learn more/i }))
      await screen.findByRole('dialog')
      await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(onSubmit).not.toHaveBeenCalled()
      expect(ownerField(1)).toBeDefined()
    })
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
    expect(screen.getByRole('heading', { level: 2, name: /^safe configuration$/i })).toBeDefined()
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
