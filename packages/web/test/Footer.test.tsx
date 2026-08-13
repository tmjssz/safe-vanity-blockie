import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Footer } from '../components/Footer'
import packageJson from '../package.json'

const REPO_URL = 'https://github.com/tmjssz/safe-vanity-blockie'
const BLO_URL = 'https://github.com/bpierre/blo'
const SAFE_URL = 'https://safe.global'

function externalLink(name: RegExp) {
  return screen.getByRole('link', { name }) as HTMLAnchorElement
}

function privacyTrigger() {
  return screen.getByRole('button', { name: /privacy/i })
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

  // Exists so nobody reads Safe as vouching for an address this tool produced. A disclaimer
  // behind a hover target does not do its job, so unlike the privacy note beside it, this one
  // must be legible with no interaction at all.
  it('states plainly that this is not an official Safe product, with nothing to open first', () => {
    render(<Footer />)
    expect(screen.getByText(/not an official safe product/i)).toBeDefined()
  })

  // The credit and the disclaimer are one sentence, deliberately: "Built on Safe" is the claim
  // that makes "not an official Safe product" necessary, so a reader who takes in the first half
  // has already been handed the second. Splitting them is what would let the first travel alone.
  it('names what it is built on and disowns it in the same breath', () => {
    render(<Footer />)
    const line = screen.getByText(/not an official Safe product/i)
    expect(line.textContent).toMatch(/Built on\s+Safe\s+·\s+not an official Safe product/i)
  })

  describe('the privacy note behind the shield', () => {
    // The blurb is long enough to dominate a footer that is meant to be quiet, so it is collapsed
    // behind the shield rather than set as a paragraph. The cost is that it is genuinely absent
    // until asked for — which is the thing worth pinning, since a "collapsed" note that is really
    // just visually hidden would still be read aloud by a screen reader on every page.
    it('is not rendered until the shield is asked for it', () => {
      render(<Footer />)
      expect(screen.queryByText(/runs entirely in your browser/i)).toBeNull()
    })

    it('opens on click, which is the only way in on a touch device', async () => {
      const user = userEvent.setup()
      render(<Footer />)
      await user.click(privacyTrigger())
      expect(await screen.findByText(/runs entirely in your browser/i)).toBeDefined()
    })

    // Hover alone would strand every touch user, and click alone makes a footer icon feel inert
    // to a mouse user who is only scanning. Both open it; neither is sufficient on its own.
    it('opens on hover, without waiting for a click', async () => {
      const user = userEvent.setup()
      render(<Footer />)
      await user.hover(privacyTrigger())
      expect(await screen.findByText(/runs entirely in your browser/i)).toBeDefined()
    })

    // A real <button> (which getByRole already pins) puts it in the tab order; this covers the
    // half that does not come for free — that arriving there by keyboard reveals the note, the
    // way arriving there by pointer does.
    it('opens on keyboard focus, so it is not mouse-only', async () => {
      render(<Footer />)
      privacyTrigger().focus()
      expect(await screen.findByText(/runs entirely in your browser/i)).toBeDefined()
    })

    it('closes again when the pointer leaves', async () => {
      const user = userEvent.setup()
      render(<Footer />)
      await user.hover(privacyTrigger())
      await screen.findByText(/runs entirely in your browser/i)
      await user.unhover(privacyTrigger())
      await waitFor(() =>
        expect(screen.queryByText(/runs entirely in your browser/i)).toBeNull(),
      )
    })

    // A click is a deliberate request to read the thing, so it has to survive the pointer
    // wandering off — otherwise the note vanishes the moment you move to read it, and on a
    // trackpad that is most of the time.
    it('stays open after a click even when the pointer leaves', async () => {
      const user = userEvent.setup()
      render(<Footer />)
      await user.click(privacyTrigger())
      await screen.findByText(/runs entirely in your browser/i)
      await user.unhover(privacyTrigger())
      // Long enough to outlast the grace period that lets the pointer cross the gap on hover.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(screen.queryByText(/runs entirely in your browser/i)).not.toBeNull()
    })

    it('closes on a second click', async () => {
      const user = userEvent.setup()
      render(<Footer />)
      await user.click(privacyTrigger())
      await screen.findByText(/runs entirely in your browser/i)
      await user.click(privacyTrigger())
      await waitFor(() =>
        expect(screen.queryByText(/runs entirely in your browser/i)).toBeNull(),
      )
    })

    it('closes on Escape', async () => {
      const user = userEvent.setup()
      render(<Footer />)
      await user.click(privacyTrigger())
      await screen.findByText(/runs entirely in your browser/i)
      await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(screen.queryByText(/runs entirely in your browser/i)).toBeNull(),
      )
    })

    // The claim has a real network footprint (public RPC reads, and a wallet-sent transaction on
    // deploy), so a bare "nothing leaves your browser" would be false. This pins the two
    // exceptions by content rather than exact prose, so the wording can still be polished.
    it('names both network exceptions rather than overclaiming', async () => {
      const user = userEvent.setup()
      render(<Footer />)
      await user.click(privacyTrigger())
      const note = await screen.findByText(/runs entirely in your browser/i)
      const text = note.textContent ?? ''
      expect(text).toMatch(/rpc/i)
      expect(text).toMatch(/wallet/i)
      expect(text).toMatch(/no analytics, no telemetry/i)
      expect(text).not.toMatch(/nothing leaves your browser/i)
    })
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

  // The credit is carried by the word "Safe" inside the sentence rather than by a bare
  // "safe.global" chip, so the link is found by its label, not by its URL showing up as text.
  it('links the word Safe to safe.global', () => {
    render(<Footer />)
    const link = externalLink(/^Safe$/)
    expect(link.href).toMatch(new RegExp(`^${SAFE_URL}/?$`))
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  it('links MIT to the repo LICENSE file', () => {
    render(<Footer />)
    const link = externalLink(/mit/i)
    expect(link.href).toBe(`${REPO_URL}/blob/main/LICENSE`)
  })

  describe('the build version', () => {
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

    // Reading the version answers "what am I running"; linking it answers "and what is in it".
    it('links to the exact commit when a SHA is available', () => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234567890')
      render(<Footer />)
      const link = externalLink(new RegExp(`v${packageJson.version.replace(/\./g, '\\.')}`))
      expect(link.href).toBe(`${REPO_URL}/commit/abcdef1234567890`)
    })

    it('links to the release tag on a build with no SHA', () => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
      render(<Footer />)
      const link = externalLink(new RegExp(`v${packageJson.version.replace(/\./g, '\\.')}`))
      expect(link.href).toBe(`${REPO_URL}/releases/tag/v${packageJson.version}`)
    })
  })

  it('renders as a footer landmark, in normal document flow (no z-index reach)', () => {
    render(<Footer />)
    const footer = screen.getByRole('contentinfo')
    expect(footer.className).not.toMatch(/\bz-\d/)
    expect(footer.className).not.toMatch(/\bsticky\b|\bfixed\b/)
  })
})
