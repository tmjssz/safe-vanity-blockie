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
})
