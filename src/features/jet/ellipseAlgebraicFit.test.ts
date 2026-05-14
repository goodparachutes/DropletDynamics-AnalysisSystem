import { describe, expect, it } from 'vitest'
import { fitEllipseFromContourPx } from './ellipseAlgebraicFit'

describe('fitEllipseFromContourPx', () => {
  it('recovers a near-circle from noisy samples', () => {
    const cx0 = 120
    const cy0 = 90
    const r = 25
    const pts: { x: number; y: number }[] = []
    const n = 80
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2
      const noise = (i % 7) * 0.08
      pts.push({
        x: cx0 + r * Math.cos(t) + noise,
        y: cy0 + r * Math.sin(t) + noise * 0.6,
      })
    }
    pts.push({ ...pts[0]! })
    const e = fitEllipseFromContourPx(pts)
    expect(e).not.toBeNull()
    expect(Math.abs(e!.cx - cx0)).toBeLessThan(1.5)
    expect(Math.abs(e!.cy - cy0)).toBeLessThan(1.5)
    expect(Math.abs(e!.semiMajorPx - r)).toBeLessThan(1.2)
    expect(Math.abs(e!.semiMinorPx - r)).toBeLessThan(1.2)
  })
})
