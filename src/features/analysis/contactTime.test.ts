import { describe, expect, it } from 'vitest'
import { computeContactTimeMs } from './contactTime'

describe('computeContactTimeMs', () => {
  it('returns interval from first zero to second zero after spread', () => {
    const pts = [
      { time: 0, absTime: 0, beta: 0, absDiameter: 0 },
      { time: 5, absTime: 0, beta: 0.5, absDiameter: 1 },
      { time: 12, absTime: 0, beta: 0.02, absDiameter: 0 },
    ]
    expect(computeContactTimeMs(pts)).toBeCloseTo(12, 2)
  })

  it('returns null when never returns to zero after spread', () => {
    const pts = [
      { time: 0, absTime: 0, beta: 0, absDiameter: 0 },
      { time: 5, absTime: 0, beta: 0.5, absDiameter: 1 },
      { time: 12, absTime: 0, beta: 0.4, absDiameter: 0.8 },
    ]
    expect(computeContactTimeMs(pts)).toBeNull()
  })
})
