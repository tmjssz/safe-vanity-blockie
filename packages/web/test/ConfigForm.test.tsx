import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfigForm } from '../components/ConfigForm.js'

const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

describe('ConfigForm', () => {
  it('surfaces a validation error instead of submitting', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/owners/i), '0xnope')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText(/not a valid address/i)).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a valid config', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm onSubmit={onSubmit} />)

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
    render(<ConfigForm onSubmit={vi.fn()} />)
    expect(screen.getByText(/changing them re-rolls/i)).toBeDefined()
  })
})
