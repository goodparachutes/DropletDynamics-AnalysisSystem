import { describe, expect, it } from 'vitest'
import { apexHeightAboveBaselineMm } from './apexHeightFromContour'

describe('apexHeightAboveBaselineMm', () => {
  it('returns mm from surfaceY minus min contour y, divided by px/mm', () => {
    const h = apexHeightAboveBaselineMm({
      surfaceYPx: 400,
      outerContourPx: [
        { x: 0, y: 300 },
        { x: 1, y: 250 },
        { x: 2, y: 350 },
      ],
      pixelScalePxPerMm: 10,
    })
    expect(h).toBeCloseTo(15, 6)
  })

  it('clamps negative height to 0 mm (noise below baseline)', () => {
    const h = apexHeightAboveBaselineMm({
      surfaceYPx: 200,
      outerContourPx: [
        { x: 0, y: 220 },
        { x: 1, y: 210 },
        { x: 2, y: 215 },
      ],
      pixelScalePxPerMm: 5,
    })
    expect(h).toBe(0)
  })

  it('returns null without contour', () => {
    expect(
      apexHeightAboveBaselineMm({
        surfaceYPx: 400,
        outerContourPx: undefined,
        pixelScalePxPerMm: 10,
      }),
    ).toBeNull()
  })
})
