import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FacePicker } from '../components/FacePicker'

describe('FacePicker', () => {
  it('renders a toggle for every expression', () => {
    render(<FacePicker value={['smile']} onChange={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
  })

  it('adds an expression when its toggle is checked', async () => {
    const onChange = vi.fn()
    render(<FacePicker value={['smile']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /frown/i }))
    expect(onChange).toHaveBeenCalledWith(['smile', 'frown'])
  })

  it('refuses to remove the last expression, since a face needs a mouth', async () => {
    const onChange = vi.fn()
    render(<FacePicker value={['smile']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /smile/i }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/at least one/i)
  })
})
