import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SecurityNotice } from '../components/SecurityNotice'

describe('SecurityNotice', () => {
  // role="note", not "alert": this caveat is permanent, static copy. Armed as a live region it
  // would compete forever with the errors the page raises for real (the deploy failure, the bad
  // share link), which is what `main`'s version of this component avoided by being a note.
  it('keeps the phishing caveat intact, as a note rather than a live region', () => {
    render(<SecurityNotice />)
    expect(screen.queryByRole('alert')).toBeNull()
    const text = screen.getByRole('note').textContent ?? ''

    expect(text).toMatch(/cosmetic/i)
    expect(text).toMatch(/proof of an address/i)
    expect(text).toMatch(/phishing/i)
  })

  // Split deliberately: the lead is the claim a skimming reader has to come away with, and the
  // body is what to do about it. Run together as one paragraph the claim stops being findable.
  it('leads with the claim and follows with what to do about it', () => {
    render(<SecurityNotice />)
    expect(screen.getByText('A matching identicon is cosmetic.')).toBeDefined()
    expect(
      screen.getByText(
        'Never treat it as proof of an address. Blockie look-alikes are a known phishing vector. Always verify the full address.',
      ),
    ).toBeDefined()
  })

  // The warning is about trusting a picture, and it is read beside a grid of pictures. Amber
  // rather than the destructive red: nothing has gone wrong, and a permanent red panel on a
  // working screen is the fastest way to teach someone to stop seeing it.
  it('is toned as a caution rather than as an error', () => {
    const { container } = render(<SecurityNotice />)
    const note = screen.getByRole('note')
    expect(note.className).toMatch(/amber/)
    expect(note.className).not.toMatch(/destructive/)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('cannot be dismissed', () => {
    render(<SecurityNotice />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
