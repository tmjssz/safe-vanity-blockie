import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ResultCard } from '../components/ResultCard'
import { contrastPairForDistance } from '../lib/contrast-preview'

const candidate = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

/**
 * The tile is compact now, so most of what it used to spell out is gone: the props below are the
 * defaults every test starts from and each one overrides the single thing it is about.
 *
 * `filterGuaranteesTwoColour` defaults to true here because that is the app's default filter —
 * with it on, every result on screen is two-colour and saying so on each tile distinguishes
 * nothing.
 */
function renderCard(
  overrides: Partial<React.ComponentProps<typeof ResultCard>> = {},
): ReturnType<typeof render> {
  return render(
    <ResultCard
      candidate={candidate}
      filterGuaranteesTwoColour
      onSelect={vi.fn()}
      {...overrides}
    />,
  )
}

/** The one control that opens the result; named after it, so it is also how the grid finds it. */
// jsdom re-serialises an inline `rgb(a b c)` as `rgb(a, b, c)`, so the expectation is built from
// the same channel values rather than compared against rgbCss's own string.
const asJsdom = ({ r, g, b }: { r: number; g: number; b: number }) => `rgb(${r}, ${g}, ${b})`

const tile = () => screen.getByRole('button', { name: /deploy .* match/i })
const scoreBadge = () => screen.getByTestId('result-score')
const metaLine = () => screen.getByTestId('result-meta')

describe('ResultCard', () => {
  // Five tiles to a row leaves no space for a percentage heading, and it was never the thing
  // being compared — the blockie is. The number rides on the corner of the picture instead.
  it('shows the score as a badge on the blockie, not as a heading', () => {
    renderCard()
    expect(scoreBadge().textContent).toBe('90.2')
    // The unit is in the tooltip and the accessible name; on the tile it is noise repeated
    // twenty-five times per screen.
    expect(screen.queryByText('90.2%')).toBeNull()
  })

  it('explains what the score is a percentage of, since the badge is a bare number', () => {
    renderCard()
    expect(scoreBadge().getAttribute('title')).toBe(
      '90.2% match to the closest accepted expression',
    )
  })

  // A wall of blockies is scanned, not read: the tiles worth a second look have to be findable
  // without comparing twenty-five three-digit numbers.
  it('marks a score above the quality threshold in the accent colour', () => {
    renderCard()
    expect(scoreBadge().className).toMatch(/emerald/)
  })

  it('leaves a score below the quality threshold neutral', () => {
    // 89.5%: below the threshold, and close enough to it that a rounding slip would show up here.
    renderCard({ candidate: { ...candidate, score: 119, maxScore: 133 } })
    expect(scoreBadge().textContent).toBe('89.5')
    expect(scoreBadge().className).not.toMatch(/emerald/)
  })

  it('reads the expression and the contrast on one line', () => {
    renderCard()
    expect(metaLine().textContent).toMatch(/small/)
    expect(metaLine().textContent).toMatch(/157/)
  })

  // The same swatch pair the contrast slider draws, rather than a generic glyph: a fixed icon says
  // only "this number is about contrast", while the pair says what 157 looks like — and it is the
  // shape the user has already learned from setting the filter.
  it("carries the contrast as the filter slider's own swatch pair plus the number", () => {
    const { container } = renderCard()

    const halves = container.querySelectorAll('[data-slot="contrast-swatch"]')
    expect(halves).toHaveLength(2)
    const [dark, light] = contrastPairForDistance(candidate.contrast)
    expect((halves[0] as HTMLElement).style.backgroundColor).toBe(asJsdom(dark))
    expect((halves[1] as HTMLElement).style.backgroundColor).toBe(asJsdom(light))

    // Nothing from the old glyph is left behind beside it.
    expect(container.querySelector('.lucide-contrast')).toBeNull()
  })

  // Two grey rectangles say nothing to a screen reader, and "contrast" spelled out costs more of a
  // 214px tile than the word is worth.
  it('keeps the word contrast to the tooltip and to assistive tech', () => {
    renderCard()
    const spelled = screen.getByText('Colour contrast')
    expect(spelled.className).toMatch(/sr-only/)
    // Pointer users get the same words on hover from the element that holds the swatch.
    expect(screen.getByTitle('Colour contrast: 157')).toBeDefined()
  })

  // The row used to hold a 6-and-4 abbreviation, computed in JS: `0x70e9…eed5`, the same eleven
  // characters however wide the tile was. It holds as much of the address as the tile can fit now,
  // shortened down the middle with the SAME number of characters on each side of the ellipsis.
  //
  // Which takes a measurement, and jsdom has no layout: `contentRect` is whatever a stubbed
  // observer reports and `measureText` is whatever a stubbed canvas returns. So the two are stubbed
  // with round numbers here and the arithmetic is checked against them, while the shape of the
  // result — equal halves, in order, inside the budget — is pinned by lib/fit-address's own suite
  // at every width there is.
  describe('the address row', () => {
    const row = (): HTMLElement => {
      const code = screen.getByTestId('result-address')
      if (code.tagName !== 'CODE')
        throw new Error(`address is in a <${code.tagName}>, not a <code>`)
      return code
    }

    /**
     * Renders a tile whose address row is `width` pixels wide, in a font whose characters are ten
     * pixels each — so the character budget is `width / 10` and the expected string can be worked
     * out by hand.
     *
     * The global ResizeObserver stub in vitest.setup.ts never calls anyone back, which is what
     * every other test in this file relies on to see the unmeasured state. This one replaces it
     * with a stub that reports a size the way the real one does: once, on observe.
     */
    function renderMeasured(width: number) {
      const realObserver = globalThis.ResizeObserver
      const realGetContext = HTMLCanvasElement.prototype.getContext
      globalThis.ResizeObserver = class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
          this.callback(
            [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          )
        }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
      HTMLCanvasElement.prototype.getContext = (() => ({
        font: '',
        measureText: (text: string) => ({ width: text.length * 10 }),
      })) as unknown as typeof realGetContext

      try {
        renderCard()
      } finally {
        globalThis.ResizeObserver = realObserver
        HTMLCanvasElement.prototype.getContext = realGetContext
      }
    }

    it('shortens the address down the middle, evenly, to what the tile can hold', () => {
      // 210px at ten pixels a character is 21 characters: ten from each end, and the ellipsis.
      renderMeasured(210)
      expect(row().textContent).toBe('0x70e9f0a8…d2e804eed5')
    })

    // The property, rather than one width's arithmetic: whatever the tile is worth, the prefix and
    // the suffix are the same length, and both are the address's own characters in its own order.
    it('shows the same number of characters on each side, at any width', () => {
      for (const width of [80, 130, 210, 280, 350]) {
        renderMeasured(width)
        const [head, tail] = (row().textContent ?? '').split('…')
        expect(tail, `width ${width}`).toBeDefined()
        expect(head.length, `width ${width}`).toBe(tail.length)
        expect(head).toBe(candidate.address.slice(0, head.length))
        expect(tail).toBe(candidate.address.slice(-tail.length))
        cleanup()
      }
    })

    // A tile wide enough for all 42 characters hides nothing at all — the point of measuring rather
    // than picking a split: the row spends whatever it is given.
    it('leaves the whole address alone when it fits', () => {
      renderMeasured(candidate.address.length * 10)
      expect(row().textContent).toBe(candidate.address)
    })

    // The state before any measurement, and the state in an environment with no ResizeObserver at
    // all. The whole address is the honest thing to render, and `truncate` is what keeps it from
    // pushing the tile out of the grid — a shortened address on a width nobody has measured would
    // be a guess presented as a fact.
    it('renders the whole address, clipped, until something has measured the row', () => {
      renderCard()
      expect(row().textContent).toBe(candidate.address)
      expect(row().className).toMatch(/\btruncate\b/)
    })

    it('no longer renders the fixed six-and-four abbreviation', () => {
      renderMeasured(210)
      expect(screen.queryByText('0x70e9…eed5')).toBeNull()
    })
  })

  it('leaves the saltNonce to the detail view', () => {
    renderCard()
    expect(screen.queryByText(/1885506/)).toBeNull()
  })

  it('marks a two-colour result when the filter is not already guaranteeing one', () => {
    renderCard({ filterGuaranteesTwoColour: false })
    expect(screen.getByText(/two colours/i)).toBeDefined()
  })

  // The chip was on every tile before, which made it furniture rather than information.
  it('says nothing about colours when every result on screen is two-colour anyway', () => {
    renderCard({ filterGuaranteesTwoColour: true })
    expect(screen.queryByText(/two colours/i)).toBeNull()
  })

  it('does not mark a three-colour result, which is the ordinary case', () => {
    renderCard({ candidate: { ...candidate, twoColor: false }, filterGuaranteesTwoColour: false })
    expect(screen.queryByText(/colours/i)).toBeNull()
  })

  it('draws the blockie at the full width of the tile', () => {
    renderCard()
    // The svg carries a viewBox, so CSS width is what decides how big it is drawn.
    expect(screen.getByRole('img').className).toMatch(/w-full/)
  })

  it('renders the real blo identicon for the address', () => {
    renderCard()
    expect(screen.getByRole('img', { name: `Identicon for ${candidate.address}` })).toBeDefined()
  })

  it('reports the candidate when chosen', async () => {
    const onSelect = vi.fn()
    renderCard({ onSelect })
    await userEvent.click(tile())
    expect(onSelect).toHaveBeenCalledWith(candidate)
  })

  // Nothing on a tile says what clicking it does any more — the words that used to be there are
  // what got removed. The affordance has to appear on the picture itself.
  it('reveals a deploy affordance on hover and on keyboard focus', () => {
    renderCard()
    const overlay = screen.getByTestId('result-overlay')
    expect(overlay.textContent).toMatch(/deploy/i)
    expect(overlay.className).toMatch(/group-hover:/)
    // Without this the overlay's own controls could be tabbed to while still invisible.
    expect(overlay.className).toMatch(/group-focus-within:/)
  })

  describe('the result being deployed', () => {
    // A wall of two hundred identical-looking tiles, one of which is having gas spent on it: which
    // one has to be visible without hovering anything, and it is the same mark the header pill and
    // the in-progress dialog carry.
    it('turns a spinner over the blockie', () => {
      const { container } = renderCard({ deploying: true })
      const blockie = screen.getByRole('img')
      const stack = blockie.parentElement as HTMLElement
      expect(stack.className).toMatch(/relative/)
      expect(stack.querySelector('.animate-spin')).not.toBeNull()
      // Not hover-gated: the overlay that fades in is a different thing.
      expect(
        container.querySelector('.animate-spin')?.closest('[data-testid="result-overlay"]'),
      ).toBeNull()
    })

    it('leaves every other tile alone', () => {
      const { container } = renderCard()
      expect(container.querySelector('.animate-spin')).toBeNull()
    })

    // Pressing it cannot start a second deploy, so offering to would be a lie: it goes back to the
    // one already running.
    it('offers to view the deploy rather than to start one', () => {
      renderCard({ deploying: true })
      const overlay = screen.getByTestId('result-overlay')
      expect(overlay.textContent).toMatch(/view the deploy/i)
      expect(overlay.textContent).not.toMatch(/^deploy$/i)
    })

    it('names itself as the way back to the deploy in progress', () => {
      renderCard({ deploying: true })
      const name = screen
        .getByRole('button', { name: /view the deploy/i })
        .getAttribute('aria-label')
      expect(name).toContain(candidate.address)
    })
  })

  // Side by side, not stacked: two rows of controls over a 214px picture hid most of the thing
  // the overlay is drawn on top of.
  it('sets the deploy pill and the copy control on one line', () => {
    renderCard()
    const overlay = screen.getByTestId('result-overlay')
    expect(overlay.className).toMatch(/flex-row/)
    expect(overlay.className).not.toMatch(/flex-col/)
  })

  // The pill and the tile do the same thing, so making it a real button would buy a second tab
  // stop and a second announcement for one action.
  it('makes the deploy pill decoration rather than a second control for the same action', () => {
    renderCard()
    expect(screen.getByText('Deploy').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  // Found by clicking the real thing: with the whole overlay made interactive on hover, the dim
  // layer sat above the tile's own button and swallowed every click on the picture — including
  // the one on the Deploy pill. Only the copy control may ever take a pointer; the rest of the
  // overlay has to stay transparent to it, at every opacity.
  it('never lets the overlay swallow a click meant for the tile', () => {
    renderCard()
    const overlay = screen.getByTestId('result-overlay')
    expect(overlay.className).toMatch(/pointer-events-none/)
    expect(overlay.className).not.toMatch(/pointer-events-auto/)

    // The copy button is the exception, and only while the overlay is visible: interactive when
    // it cannot be seen, it would take a tap aimed at the middle of the blockie on a touch device.
    const copy = screen.getByRole('button', { name: /copy address/i }).className
    expect(copy).toMatch(/pointer-events-none/)
    expect(copy).toMatch(/group-hover:pointer-events-auto/)
    expect(copy).toMatch(/group-focus-within:pointer-events-auto/)
  })

  it('copies the address without opening the detail view', () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const onSelect = vi.fn()
    renderCard({ onSelect })

    // fireEvent, not userEvent: userEvent.setup() replaces navigator.clipboard with its own stub.
    fireEvent.click(screen.getByRole('button', { name: /copy address/i }))

    expect(writeText).toHaveBeenCalledWith(candidate.address)
    // The copy control is a sibling of the tile's own button, not nested inside it, so a copy
    // cannot also open the dialog.
    expect(onSelect).not.toHaveBeenCalled()
  })

  // Twenty-five tiles whose only difference is the picture they draw: a name that does not carry
  // the address cannot distinguish them.
  it('names itself by the result it opens', () => {
    renderCard()
    const name = tile().getAttribute('aria-label') ?? ''
    expect(name).toContain('90.2%')
    expect(name).toContain(candidate.address)
  })

  // The aria-label above overrides the tile's contents as the accessible name, which would
  // otherwise leave the metadata announced nowhere at all.
  it('still announces the metadata the label does not name', () => {
    renderCard({ filterGuaranteesTwoColour: false })

    const describedBy = tile().getAttribute('aria-describedby') ?? ''
    expect(describedBy).toBeTruthy()

    const described = describedBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    expect(described).toContain('small')
    expect(described).toContain('157')
    expect(described).toContain('two colours')
  })

  it('announces that activating it opens a dialog', () => {
    renderCard()
    expect(tile().getAttribute('aria-haspopup')).toBe('dialog')
  })

  // The hover affordance belongs to the card, which is the surface that changes; the focus ring
  // belongs to the control that is focused. Both still describe the same rectangle.
  it('has a visible hover and focus-visible affordance', () => {
    const { container } = renderCard()
    expect(container.querySelector('[data-slot="card"]')?.className).toMatch(/hover:/)
    expect(tile().className).toMatch(/focus-visible:/)
  })

  // The tile can no longer BE one button — a button may not contain the copy button — so the
  // clickable surface is a stretched sibling instead. It still has to cover the whole tile:
  // anything less turns "click the blockie" into a hunt for the live pixels.
  it('keeps one control covering the whole tile', () => {
    renderCard()
    expect(tile().tagName).toBe('BUTTON')
    // `type` defaults to "submit", which would submit any form this tile is rendered inside.
    expect(tile().getAttribute('type')).toBe('button')
    expect(tile().className).toMatch(/absolute/)
    expect(tile().className).toMatch(/inset-0/)
  })
})
