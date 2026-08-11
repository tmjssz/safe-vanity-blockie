import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { cn } from '../lib/utils'

describe('cn', () => {
  it('merges conflicting tailwind classes, last one winning', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('drops falsy values', () => {
    expect(cn('p-2', false, undefined, 'text-sm')).toBe('p-2 text-sm')
  })
})

describe('generated primitives', () => {
  it('renders a Button as a real button element', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Deploy</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Deploy' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('drives a Select through Radix, which is a combobox rather than a native select', async () => {
    const onValueChange = vi.fn()
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger aria-label="Chain">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">Ethereum</SelectItem>
          <SelectItem value="11155111">Sepolia</SelectItem>
        </SelectContent>
      </Select>,
    )

    // This is the query shape every later task must use: role="combobox", not a native select.
    await userEvent.click(screen.getByRole('combobox', { name: 'Chain' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Sepolia' }))
    expect(onValueChange).toHaveBeenCalledWith('11155111')
  })
})
