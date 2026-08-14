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

  // The lead is emphasised but runs INTO the body rather than sitting on its own line. Stacked as
  // two blocks it read as a heading with a paragraph under it, which at full width left a mostly
  // empty first line; as one flowing sentence it stays a single compact strip.
  it('runs the emphasised lead inline into the body', () => {
    render(<SecurityNotice />)
    const lead = screen.getByText('A matching identicon is cosmetic.')
    expect(lead.tagName).toBe('STRONG')

    // One flowing block, not a title and a description in separate rows.
    const note = screen.getByRole('note')
    expect(note.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'A matching identicon is cosmetic. Never treat it as proof of an address. Blockie look-alikes are a known phishing vector. Always verify the full address.',
    )
    expect(note.querySelector('[data-slot="alert-title"]')).toBeNull()
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
