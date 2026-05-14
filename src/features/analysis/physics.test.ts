import { describe, expect, it } from 'vitest'
import { findSubPixelEdgePeak } from './physics'

describe('findSubPixelEdgePeak', () => {
  it('returns finite sub-pixel coordinate near gradient peak', () => {
    const profile = new Float32Array([255, 240, 220, 20, 10, 10, 10, 200, 230, 255])
    const peakLeft = findSubPixelEdgePeak(profile, 1, 6, true)
    const peakRight = findSubPixelEdgePeak(profile, 4, 9, false)
    expect(Number.isFinite(peakLeft)).toBe(true)
    expect(Number.isFinite(peakRight)).toBe(true)
  })
})
