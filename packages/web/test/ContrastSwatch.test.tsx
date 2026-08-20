import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContrastSwatch } from '../components/ContrastSwatch'
import { contrastPairForDistance } from '../lib/contrast-preview'

// jsdom re-serialises an inline `rgb(a b c)` as `rgb(a, b, c)`, so the expectation is built from
// the same channel values rather than compared against rgbCss's own string.
const asJsdom = ({ r, g, b }: { r: number; g: number; b: number }) => `rgb(${r}, ${g}, ${b})`

const halves = (root: HTMLElement) => root.querySelectorAll('[data-slot="contrast-swatch"]')

describe('ContrastSwatch', () => {
  it('draws the pair as two halves', () => {
    const { container } = render(<ContrastSwatch distance={120} />)
    expect(halves(container)).toHaveLength(2)
  })

  // The whole point of the thing: it answers "how different is 157?" in the one dimension the
  // number describes, so the colours have to come from the same helper the miner's scale does.
  it('shows the two colours that distance actually produces', () => {
    const { container } = render(<ContrastSwatch distance={157} />)
    const [dark, light] = contrastPairForDistance(157)

    const [first, second] = Array.from(halves(container)) as HTMLElement[]
    expect(first.style.backgroundColor).toBe(asJsdom(dark))
    expect(second.style.backgroundColor).toBe(asJsdom(light))
  })

  it('collapses to one flat grey when nothing is required', () => {
    const { container } = render(<ContrastSwatch distance={0} />)
    const [first, second] = Array.from(halves(container)) as HTMLElement[]
    expect(first.style.backgroundColor).toBe(second.style.backgroundColor)
  })

  // Two grey rectangles say nothing to a screen reader, and every caller states the number in
  // text beside them.
  it('is decorative, so it is hidden from assistive tech', () => {
    const { container } = render(<ContrastSwatch distance={120} />)
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })

  // It is drawn at 32×16 beside the filter slider and at a fraction of that on a result tile, so
  // the caller sizes it; the component only guarantees the two halves split whatever it is given.
  it('takes its size from the caller', () => {
    const { container } = render(<ContrastSwatch distance={120} className="h-[11px] w-4" />)
    expect(container.firstElementChild?.className).toMatch(/h-\[11px\]/)
    expect(container.firstElementChild?.className).toMatch(/w-4/)
  })
})
