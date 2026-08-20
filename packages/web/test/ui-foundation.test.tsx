import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { cn } from '../lib/utils'

describe('cn', () => {
  it('merges conflicting tailwind classes, last one winning', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('drops falsy values', () => {
    expect(cn('p-2', false, undefined, 'text-sm')).toBe('p-2 text-sm')
  })
})

// Every dialog in the app dims and blurs the page behind it, the way the deploy dialog's own
// backdrop does. It lives in the primitive rather than at each call site because "consistent"
// cannot be maintained by five components remembering to pass the same class.
describe('the dialog backdrop', () => {
  it('dims with the theme background and blurs, rather than a flat black wash', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>open</DialogTrigger>
        <DialogContent>
          <DialogTitle>title</DialogTitle>
        </DialogContent>
      </Dialog>,
    )

    await user.click(screen.getByRole('button', { name: 'open' }))
    await screen.findByRole('dialog')

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    expect(overlay.className).toMatch(/backdrop-blur/)
    expect(overlay.className).toMatch(/bg-background\/60/)
    expect(overlay.className).not.toMatch(/bg-black/)
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

// Tailwind v4's preflight sets `cursor: default` on buttons, so every control in the app — the
// footer's info icon, "Learn more", Deploy, the chain picker, the theme toggle — came up with an
// arrow where a hand belongs. The fix is one base rule rather than a class per control, because
// "every control is clickable-looking" is not an invariant five components can maintain by each
// remembering the same class. Asserted against the stylesheet: jsdom applies no Tailwind, so
// there is no rendered cursor to read.
describe('the pointer cursor on controls', () => {
  // Read off disk from the package root (vitest's cwd), not through an import: the rule is CSS
  // the bundler never hands a test, and a class list is exactly what this must not assert.
  const globalsCss = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

  it('is restored for every control by one rule in the base layer', () => {
    expect(globalsCss).toMatch(/@layer base[\s\S]*button:not\(:disabled\)[\s\S]*?cursor-pointer/)
  })

  // Disabled controls keep the arrow: nothing happens when they are clicked, and shadcn's own
  // variants already say so with `disabled:cursor-not-allowed` on the inputs.
  it('leaves disabled controls alone', () => {
    expect(globalsCss).not.toMatch(/\bbutton\s*\{[^}]*cursor-pointer/)
  })

  it('is not then re-added component by component', () => {
    const dir = join(process.cwd(), 'components')
    const offenders = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.tsx'))
      .filter((file) => readFileSync(join(dir, file), 'utf8').includes('cursor-pointer'))

    expect(offenders).toEqual([])
  })
})
