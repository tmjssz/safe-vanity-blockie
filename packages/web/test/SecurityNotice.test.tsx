import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SecurityNotice } from '../components/SecurityNotice'

describe('SecurityNotice', () => {
  it('keeps the phishing caveat intact', () => {
    render(<SecurityNotice />)
    const text = screen.getByRole('alert').textContent ?? ''

    expect(text).toMatch(/cosmetic/i)
    expect(text).toMatch(/proof of an address/i)
    expect(text).toMatch(/phishing/i)
  })
})
