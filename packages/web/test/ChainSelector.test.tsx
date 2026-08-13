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
    render(<ChainSelector chainId={SEPOLIA} hasRun onSelect={onSelect} />)

    await choose(user, /polygon/i)

    // No question asked: the factory, initializer hash and initCodeHash are identical on both, so
    // every result already found is still that Safe's address on the new chain.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSelect).toHaveBeenCalledWith(POLYGON)
  })

  it('asks before a switch that crosses the mainnet boundary, and does not switch until confirmed', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ChainSelector chainId={SEPOLIA} hasRun onSelect={onSelect} />)

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
    render(<ChainSelector chainId={SEPOLIA} hasRun onSelect={onSelect} />)

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
    render(<ChainSelector chainId={SEPOLIA} hasRun={false} onSelect={onSelect} />)

    await choose(user, /ethereum/i)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSelect).toHaveBeenCalledWith(MAINNET)
  })

  it('names both chains in the question, so it is clear what is being left and for what', async () => {
    const user = userEvent.setup()
    render(<ChainSelector chainId={MAINNET} hasRun onSelect={vi.fn()} />)

    await choose(user, /sepolia/i)

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Ethereum')
    expect(dialog.textContent).toContain('Sepolia')
  })
})
