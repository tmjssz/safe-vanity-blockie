import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CHAIN_ICON_ATTR, ChainIcon } from '../components/ChainIcon'
import { SUPPORTED_CHAINS } from '../lib/config'

/** The rendered mark for a chain, or null when the component drew nothing. */
function mark(chainId: number): SVGSVGElement | null {
  const { container } = render(<ChainIcon chainId={chainId} />)
  return container.querySelector(`svg[${CHAIN_ICON_ATTR}]`)
}

describe('ChainIcon', () => {
  // A loop rather than seven cases on purpose: adding a chain to SUPPORTED_CHAINS without drawing
  // its mark then fails here, the same way test/config.test.ts makes an entry without a
  // safeShortName or a measured singleton fail. The list is the source of truth; this is the guard
  // that keeps the marks in step with it.
  it.each(SUPPORTED_CHAINS.map((chain) => [chain.name, chain.id] as const))(
    'draws a mark for %s',
    (_name, chainId) => {
      expect(mark(chainId)).not.toBeNull()
    },
  )

  it('draws nothing for a chain it has no mark for', () => {
    // Not reachable through the UI — the selector only offers SUPPORTED_CHAINS — but every other
    // chain lookup in the app degrades rather than throws (`?? chain ${chainId}`), and an ornament
    // is the last thing that should be the exception. Nothing drawn beats a broken image or a
    // thrown render.
    expect(mark(999_999)).toBeNull()
  })

  it('hides the mark from assistive technology', () => {
    // Everywhere a mark appears, the chain's name is already there in text beside it. Exposed, it
    // would read the chain twice; hidden, it is what it actually is — decoration on a label that
    // already says the same thing.
    const svg = mark(1)
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('focusable')).toBe('false')
  })

  it('draws a visibly different mark for every chain', () => {
    // The point of a chain icon is telling chains apart at a glance, so two chains sharing artwork
    // is a bug however plausible the copy-paste was. Sepolia is the case this is really about: it
    // borrows Ethereum's diamond and has to be told apart from it by colour alone.
    //
    // innerHTML, NOT outerHTML: the wrapper carries data-chain-icon, which differs by construction
    // and would make every mark trivially unique — a green test that could never fail. What has to
    // differ is the artwork inside it.
    const artwork = SUPPORTED_CHAINS.map((chain) => mark(chain.id)?.innerHTML)
    expect(new Set(artwork).size).toBe(SUPPORTED_CHAINS.length)
  })
})
