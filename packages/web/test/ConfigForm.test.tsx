import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfigForm } from '../components/ConfigForm'

const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

describe('ConfigForm', () => {
  it('surfaces a validation error instead of submitting', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/owners/i), '0xnope')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText(/not a valid address/i)).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a valid config', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/owners/i), OWNER)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      owners: [OWNER],
      threshold: 1,
      safeVersion: '1.4.1',
      chainId: 1,
    })
  })

  it('warns that owners are part of the address', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
    expect(screen.getByText(/changing them re-rolls/i)).toBeDefined()
  })

  // Replaces "submits the chain chosen from the Radix select". The chain moved to the header, so
  // this form no longer offers one — but it still SUBMITS one, and the config it emits is the only
  // thing that carries the chain into mining, the share link and the deploy. A refactor that
  // dropped the prop on the way through would leave every result mined for whichever chain this
  // file happened to default to.
  it('submits the chain it is given rather than one of its own, and offers no chain field', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={11155111} onSubmit={onSubmit} />)

    expect(screen.queryByRole('combobox', { name: /chain/i })).toBeNull()

    await userEvent.type(screen.getByLabelText(/owners/i), OWNER)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ chainId: 11155111 }))
  })

  // The chain is picked in the header now, so a chain error has no field to sit under — and
  // validateMineConfig can still produce one (zkSync-family chains derive addresses differently,
  // and reject outright). Without somewhere to render it, "Continue" would do nothing at all and
  // say nothing about why.
  it('still reports a chain the app cannot mine for, even with no chain field to show it against', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={324} onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/owners/i), OWNER)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText(/zkSync/i)).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
