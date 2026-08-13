import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChainSelector } from '../components/ChainSelector'

const SEPOLIA = 11155111
const POLYGON = 137
const MAINNET = 1

const trigger = () => screen.getByRole('combobox', { name: /^chain$/i })

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
    expect(dialog.textContent).toMatch(/discard every result/i)
    expect(onSelect).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /switch and start over/i }))
    expect(onSelect).toHaveBeenCalledWith(MAINNET)
  })

  it('keeps the current chain when the confirmation is dismissed', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ChainSelector chainId={SEPOLIA} runChainId={SEPOLIA} onSelect={onSelect} />)

    await choose(user, /ethereum/i)
    await user.click(screen.getByRole('button', { name: /keep mining/i }))

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

  it('names both chains in the question, so it is clear what is being left and for what', async () => {
    const user = userEvent.setup()
    render(<ChainSelector chainId={MAINNET} runChainId={MAINNET} onSelect={vi.fn()} />)

    await choose(user, /sepolia/i)

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Ethereum')
    expect(dialog.textContent).toContain('Sepolia')
  })
})
