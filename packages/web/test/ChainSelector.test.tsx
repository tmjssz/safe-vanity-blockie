import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CHAIN_ICON_ATTR } from '../components/ChainIcon'
import { ChainSelector } from '../components/ChainSelector'
import { SUPPORTED_CHAINS } from '../lib/config'

const SEPOLIA = 11155111
const POLYGON = 137
const MAINNET = 1

const trigger = () => screen.getByRole('combobox', { name: /^chain$/i })

/** A chain's brand mark inside some part of the UI, or null when it is not drawn there. */
const iconIn = (scope: HTMLElement, chainId: number) =>
  scope.querySelector(`svg[${CHAIN_ICON_ATTR}="${chainId}"]`)

async function choose(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(trigger())
  await user.click(await screen.findByRole('option', { name }))
}

describe('ChainSelector', () => {
  it('switches straight away between two chains that share a Safe singleton', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ChainSelector chainId={SEPOLIA} runChainId={SEPOLIA} onSelect={onSelect} />)

    await choose(user, /polygon/i)

    // No question asked: the factory, initializer hash and initCodeHash are identical on both, so
    // every result already found is still that Safe's address on the new chain.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSelect).toHaveBeenCalledWith(POLYGON)
  })

  it('asks before a switch that crosses the mainnet boundary, and does not switch until confirmed', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ChainSelector chainId={SEPOLIA} runChainId={SEPOLIA} onSelect={onSelect} />)

    await choose(user, /ethereum/i)

    // Mainnet deploys through Safe.sol rather than SafeL2.sol, so every address on screen would
    // change. Nothing has happened yet — the same treatment "Start over" gives the fields that
    // determine the address.
    const dialog = await screen.findByRole('dialog')
    // Both halves of the loss, and neither of them assuming a search is running: the results
    // found for the chain being left, and a result open in front of the user — which is all a
    // share-link recipient has, and all they would lose.
    expect(dialog.textContent).toMatch(/every result found for Sepolia is discarded/i)
    expect(dialog.textContent).toMatch(/any result open in front of you closes/i)
    expect(onSelect).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /switch and start over/i }))
    expect(onSelect).toHaveBeenCalledWith(MAINNET)
  })

  it('keeps the current chain when the confirmation is dismissed', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ChainSelector chainId={SEPOLIA} runChainId={SEPOLIA} onSelect={onSelect} />)

    await choose(user, /ethereum/i)
    // Named rather than "Keep mining": this dialog is also shown to a share-link recipient with
    // nothing mining at all, and the chain being kept is the answer to the question in the title.
    await user.click(screen.getByRole('button', { name: /^stay on sepolia$/i }))

    expect(onSelect).not.toHaveBeenCalled()
    // And the trigger has not moved either: the value it shows is the chain the results on screen
    // were mined for, never the one that was declined.
    expect(trigger().textContent).toContain('Sepolia')

    // Asking again still works — the declined chain was dropped, not remembered.
    await choose(user, /ethereum/i)
    expect(await screen.findByRole('dialog')).toBeDefined()
  })

  it('switches to mainnet with no questions when there is no run to lose', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ChainSelector chainId={SEPOLIA} onSelect={onSelect} />)

    await choose(user, /ethereum/i)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSelect).toHaveBeenCalledWith(MAINNET)
  })

  // The question and the reset have to be decided from one value, and it is the RUN's chain: the
  // page discards the run when the submitted config's chain and the new one take different
  // singletons, so asking about anything else means asking about a switch other than the one that
  // happens. The two agree today only because the form submits whatever the header shows — this
  // pins the case where they do not, and it is the dangerous direction: header on Sepolia, results
  // mined on mainnet, so a header-based reading would call Polygon a free switch and let the page
  // throw the run away with no question asked at all.
  it('asks about the chain the results were mined for, not the one the header happens to show', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ChainSelector chainId={SEPOLIA} runChainId={MAINNET} onSelect={onSelect} />)

    await choose(user, /polygon/i)

    const dialog = await screen.findByRole('dialog')
    expect(onSelect).not.toHaveBeenCalled()
    // And it names the chain actually being left, so the question describes the loss it is about.
    expect(dialog.textContent).toContain('Ethereum')
    expect(dialog.textContent).toContain('Polygon')
  })

  // The other direction of the same rule: a switch the header would have asked about, which the
  // run makes free. Nothing is lost, so nothing is asked.
  it('does not ask about a switch the run makes free, whatever the header shows', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ChainSelector chainId={MAINNET} runChainId={SEPOLIA} onSelect={onSelect} />)

    await choose(user, /polygon/i)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSelect).toHaveBeenCalledWith(POLYGON)
  })

  // The chain is the one input the deploy dialog reads that can move while that dialog is open —
  // it is non-modal now, which is why this control lives in the header at all. While a transaction
  // is in the wallet's hands it must not: the open dialog's description, share link and
  // wrong-chain gate would follow the header away from the transaction the user confirmed.
  it('is held still while a deploy is in flight', async () => {
    const onSelect = vi.fn()
    render(<ChainSelector chainId={SEPOLIA} runChainId={SEPOLIA} disabled onSelect={onSelect} />)

    expect((trigger() as HTMLButtonElement).disabled).toBe(true)
    // Not merely styled as unavailable: the menu does not open, so nothing can be chosen.
    await userEvent.click(trigger())
    expect(screen.queryByRole('option', { name: /polygon/i })).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('names both chains in the question, so it is clear what is being left and for what', async () => {
    const user = userEvent.setup()
    render(<ChainSelector chainId={MAINNET} runChainId={MAINNET} onSelect={vi.fn()} />)

    await choose(user, /sepolia/i)

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Ethereum')
    expect(dialog.textContent).toContain('Sepolia')
  })

  it('marks the selected chain on the trigger', async () => {
    render(<ChainSelector chainId={POLYGON} onSelect={vi.fn()} />)

    // The header shows a chain name in a small control among several others. The mark is what
    // makes which chain you are on answerable at a glance rather than by reading.
    expect(iconIn(trigger(), POLYGON)).not.toBeNull()
  })

  it('marks every chain in the list', async () => {
    const user = userEvent.setup()
    render(<ChainSelector chainId={MAINNET} onSelect={vi.fn()} />)
    await user.click(trigger())

    // Every option, not most: a list where some rows have a mark and others do not is harder to
    // scan than one with no marks at all, because the gap reads as meaning something.
    for (const chain of SUPPORTED_CHAINS) {
      const option = await screen.findByRole('option', { name: new RegExp(chain.name, 'i') })
      expect(iconIn(option, chain.id)).not.toBeNull()
    }
  })

  it('marks both chains in the switch confirmation', async () => {
    const user = userEvent.setup()
    render(<ChainSelector chainId={SEPOLIA} runChainId={SEPOLIA} onSelect={vi.fn()} />)

    await choose(user, /ethereum/i)
    const dialog = await screen.findByRole('dialog')

    // The chain being taken, beside its name in the title; and the chain being kept, on the button
    // that keeps it. Not in the explanation between them — marks belong on labels and controls,
    // and a paragraph with logos dropped into mid-sentence is harder to read, not easier.
    expect(
      iconIn(screen.getByRole('heading', { name: /switch to ethereum/i }), MAINNET),
    ).not.toBeNull()
    expect(
      iconIn(screen.getByRole('button', { name: /^stay on sepolia$/i }), SEPOLIA),
    ).not.toBeNull()
    const explanation = dialog.querySelector('[data-slot="dialog-description"]') as HTMLElement
    expect(iconIn(explanation, MAINNET)).toBeNull()
  })
})
