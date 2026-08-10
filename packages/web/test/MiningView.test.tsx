import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MiningView } from '../components/MiningView'
import { DEFAULT_FACE_FILTERS } from '../lib/config'

const CONFIG = { owners: ['0x' + '11'.repeat(20)], threshold: 1, safeVersion: '1.4.1', chainId: 1 }

vi.mock('../lib/use-safe-constants.js', () => ({
  useSafeConstants: () => ({ loading: true }),
}))

describe('MiningView', () => {
  it('explains that it is reading Safe constants before it can mine', () => {
    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={{ name: 'x', fixed: [], regions: [] } as never}
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/reading safe/i)).toBeDefined()
  })
})
