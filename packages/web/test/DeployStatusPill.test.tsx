import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeployStatusPill } from '../components/DeployStatusPill'

const candidate = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

describe('DeployStatusPill', () => {
  // The whole point of it: a deploy closed mid-flight had nowhere to go back to.
  it('reopens the deploy it stands for', async () => {
    const onOpen = vi.fn()
    render(<DeployStatusPill phase="pending" address={candidate.address} onOpen={onOpen} />)

    await userEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  // Four states, four different things to say. "Deploying" while the wallet has the request is not
  // the same news as "Confirming" with a transaction already out, and neither is an outcome.
  it.each([
    ['sending', /deploying/i],
    ['pending', /confirming/i],
    ['done', /deployed/i],
    ['failed', /stopped/i],
  ] as const)('says what is happening in the %s phase', (phase, expected) => {
    render(<DeployStatusPill phase={phase} address={candidate.address} onOpen={vi.fn()} />)
    expect(screen.getByRole('button').textContent).toMatch(expected)
  })

  it('spins only while there is something to wait for', () => {
    const { container, unmount } = render(
      <DeployStatusPill phase="pending" address={candidate.address} onOpen={vi.fn()} />,
    )
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    unmount()

    for (const phase of ['done', 'failed'] as const) {
      const settled = render(
        <DeployStatusPill phase={phase} address={candidate.address} onOpen={vi.fn()} />,
      )
      expect(settled.container.querySelector('.animate-spin')).toBeNull()
      settled.unmount()
    }
  })

  // One indicator rather than two things competing for the same corner: the spinner belongs ON the
  // result it is spinning for, not beside it.
  it('spins over the identicon rather than next to it', () => {
    const { container } = render(
      <DeployStatusPill phase="sending" address={candidate.address} onOpen={vi.fn()} />,
    )

    const identicon = container.querySelector('[data-slot="deploy-pill-identicon"]') as HTMLElement
    const spinner = container.querySelector('.animate-spin') as HTMLElement
    const stack = identicon.parentElement as HTMLElement

    // Same stacking box, and the spinner laid over it rather than taking a place in the row.
    expect(stack.contains(spinner)).toBe(true)
    expect(stack.className).toMatch(/relative/)
    const overlay = spinner.closest('[class*="absolute"]') as HTMLElement
    expect(overlay).not.toBeNull()
    expect(overlay.className).toMatch(/inset-0/)
    // A blockie is a wall of saturated colour, so the spinner needs something to read against.
    expect(overlay.className).toMatch(/bg-background\//)
  })

  // The header can hold this while a grid of two hundred results scrolls behind it, so it has to
  // say WHICH result it belongs to. The identicon is how a result is recognised everywhere else in
  // the app, and the name carries the address for anyone who cannot see it.
  it('names the result it belongs to', () => {
    const { container } = render(
      <DeployStatusPill phase="pending" address={candidate.address} onOpen={vi.fn()} />,
    )
    expect(container.querySelector('[data-slot="deploy-pill-identicon"]')).not.toBeNull()
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain(candidate.address)
  })
})
