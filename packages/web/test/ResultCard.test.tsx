import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ResultCard } from '../components/ResultCard'

const candidate = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

describe('ResultCard', () => {
  it('shows the score as a percentage, not a raw fraction', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.queryByText(/120\/133/)).toBeNull()
  })

  it('shows the address, the saltNonce and the expression', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(screen.getByText(candidate.address)).toBeDefined()
    expect(screen.getByText(/1885506/)).toBeDefined()
    expect(screen.getByText(/small/)).toBeDefined()
  })

  it('renders the real blo identicon for the address', () => {
    const { container } = render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('reports the candidate when chosen', async () => {
    const onSelect = vi.fn()
    render(<ResultCard candidate={candidate} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith(candidate)
  })

  it('marks a three-colour result so it is not mistaken for a clean one', () => {
    render(<ResultCard candidate={{ ...candidate, twoColor: false }} onSelect={vi.fn()} />)
    expect(screen.getByText(/three colours/i)).toBeDefined()
  })

  // The whole card is the control now, so it must be one real <button> — not a div with an
  // onClick, and not a card whose only reachable control is buried in a footer. Anything else
  // loses keyboard activation and the button role that tells a screen reader this is actionable.
  it('is a single real button covering the whole card, not a div with an onClick', () => {
    const { container } = render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].tagName).toBe('BUTTON')
    // `type` defaults to "submit", which would submit any form this card is ever rendered inside.
    expect(buttons[0].getAttribute('type')).toBe('button')
    // Everything the card displays is inside the control, so clicking anywhere on it works.
    expect(buttons[0].contains(screen.getByText(candidate.address))).toBe(true)
    expect(buttons[0].contains(container.querySelector('svg'))).toBe(true)
  })

  // Eight identically-named buttons ("Use this" ×8) told a screen-reader user nothing about
  // which result they were about to deploy. The name has to carry the score and the address.
  it('names itself by the result it opens, not something eight cards would share', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)

    const name = screen.getByRole('button').getAttribute('aria-label') ?? ''
    expect(name).toContain('90.2%')
    expect(name).toContain(candidate.address)
  })

  // The aria-label above overrides the card's contents as the accessible name, which would
  // otherwise leave the expression, colour-count and contrast badges announced nowhere at all —
  // they were plain text beside a separate "Use this" button before. Described-by keeps them.
  it('still announces the expression, colour and contrast badges the label does not name', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)

    const describedBy = screen.getByRole('button').getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()

    const description = document.getElementById(describedBy as string)
    expect(description).not.toBeNull()
    expect(description?.textContent).toContain('small')
    expect(description?.textContent).toContain('two colours')
    expect(description?.textContent).toContain('157')
  })

  // The card is a plain button rather than a DialogTrigger (the dialog is rendered by the page,
  // not by this component), so the attribute DialogTrigger would have supplied is set by hand.
  it('announces that activating it opens a dialog', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(screen.getByRole('button').getAttribute('aria-haspopup')).toBe('dialog')
  })

  // Nothing is "selected" any more — a click opens a dialog — so neither the badge nor the ring
  // has anything left to mean.
  it('has no "Use this" button and no "Selected" badge left to mislead', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(screen.queryByText(/use this/i)).toBeNull()
    expect(screen.queryByText(/^selected$/i)).toBeNull()
  })

  // It is the primary action on the page now; a card that does not visibly react to hover or
  // keyboard focus reads as a static tile, and keyboard users lose the focus indicator entirely.
  it('has a visible hover and focus-visible affordance', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    const className = screen.getByRole('button').className
    expect(className).toMatch(/hover:/)
    expect(className).toMatch(/focus-visible:/)
  })
})
