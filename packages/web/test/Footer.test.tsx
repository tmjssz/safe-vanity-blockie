import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Footer } from '../components/Footer'
import packageJson from '../package.json'

const REPO_URL = 'https://github.com/tmjssz/safe-vanity-blockie'
const BLO_URL = 'https://github.com/bpierre/blo'
const SAFE_URL = 'https://safe.global'

function externalLink(name: RegExp) {
  return screen.getByRole('link', { name }) as HTMLAnchorElement
}

describe('Footer', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('links to the GitHub repo, opened in a new tab without leaking a window handle', () => {
    render(<Footer />)
    const link = externalLink(/github/i)
    expect(link.href).toBe(REPO_URL)
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
    expect(link.rel).toContain('noreferrer')
  })

  // Exists so nobody reads Safe as vouching for an address this tool produced. It must not read
  // as fine print: same size as the rest of the footer's prose, not a smaller/lighter aside.
  it('states plainly that this is not an official Safe product', () => {
    render(<Footer />)
    expect(screen.getByText(/not an official safe product/i)).toBeDefined()
  })

  // The claim has a real network footprint (public RPC reads, and a wallet-sent transaction on
  // deploy), so a bare "nothing leaves your browser" would be false. This pins the two exceptions
  // by content rather than exact prose, so the wording can still be polished without breaking it.
  it('describes the browser-only mining honestly, naming both network exceptions', () => {
    render(<Footer />)
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/runs entirely in your browser/i)
    expect(text).toMatch(/rpc/i)
    expect(text).toMatch(/wallet/i)
    expect(text).not.toMatch(/nothing leaves your browser/i)
  })

  it('does not repeat the phishing caveat already carried by the SecurityNotice alert', () => {
    render(<Footer />)
    expect(screen.queryByText(/phishing/i)).toBeNull()
  })

  it('does not suggest the unpublished npx command', () => {
    render(<Footer />)
    expect(screen.queryByText(/npx/i)).toBeNull()
  })

  it('credits blo with a link that actually resolves, not the guessed github.com/download/blo', () => {
    render(<Footer />)
    const link = externalLink(/blo/i)
    expect(link.href).toBe(BLO_URL)
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  it('links to safe.global', () => {
    render(<Footer />)
    const link = externalLink(/safe\.global/i)
    expect(link.href).toMatch(new RegExp(`^${SAFE_URL}/?$`))
  })

  it('links MIT to the repo LICENSE file', () => {
    render(<Footer />)
    const link = externalLink(/mit/i)
    expect(link.href).toBe(`${REPO_URL}/blob/main/LICENSE`)
  })

  it('shows the version alone when no commit SHA is available at build time', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
    render(<Footer />)
    const text = document.body.textContent ?? ''
    expect(text).toContain(packageJson.version)
    expect(text).not.toMatch(/undefined/i)
    // No dangling separator such as "0.1.0 ()" or "0.1.0 -".
    expect(text).not.toMatch(new RegExp(`${packageJson.version}\\s*[(-]\\s*[)]?(?!\\S)`))
  })

  it('shows a short commit SHA alongside the version when one is available', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234567890')
    render(<Footer />)
    const text = document.body.textContent ?? ''
    expect(text).toContain(packageJson.version)
    expect(text).toContain('abcdef1')
    expect(text).not.toContain('abcdef1234567890')
  })

  it('renders as a footer landmark, in normal document flow (no z-index reach)', () => {
    render(<Footer />)
    const footer = screen.getByRole('contentinfo')
    expect(footer.className).not.toMatch(/\bz-\d/)
    expect(footer.className).not.toMatch(/\bsticky\b|\bfixed\b/)
  })
})
