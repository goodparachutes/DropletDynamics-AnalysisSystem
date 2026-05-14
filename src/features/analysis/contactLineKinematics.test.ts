import { describe, expect, it } from 'vitest'
import { enrichWithContactLineKinematics } from './contactLineKinematics'
import type { AnalysisPoint } from '../../types/analysis'

function pt(time: number, absTime: number, absDiameter: number, beta = 1): AnalysisPoint {
  return { time, absTime, beta, absDiameter }
}

describe('enrichWithContactLineKinematics', () => {
  it('gives zero velocity for constant diameter', () => {
    const data = [pt(0, 0, 2), pt(10, 0.01, 2), pt(20, 0.02, 2)]
    const out = enrichWithContactLineKinematics(data)
    expect(out[1].contactLineVelocityMmS).toBeCloseTo(0, 5)
    expect(out[2].contactLineVelocityMmS).toBeCloseTo(0, 5)
  })

  it('computes v = (1/2) dD/dt in mm/s', () => {
    // ΔD = 1 mm over Δt = 10 ms → dD/dt = 100 mm/s → v = 50 mm/s
    const data = [pt(0, 0, 1), pt(10, 0.01, 2)]
    const out = enrichWithContactLineKinematics(data)
    expect(out[1].contactLineVelocityMmS).toBeCloseTo(50, 4)
  })

  it('computes acceleration from velocity differences', () => {
    const data = [pt(0, 0, 0), pt(10, 0.01, 1), pt(20, 0.02, 3)]
    const out = enrichWithContactLineKinematics(data)
    expect(out[1].contactLineVelocityMmS).toBeCloseTo(50, 3)
    expect(out[2].contactLineVelocityMmS).toBeCloseTo(100, 3)
    expect(out[2].contactLineAccelMmS2).toBeCloseTo(5000, 1)
  })

  it('does not compute velocity or acceleration when beta is 0', () => {
    const data = [
      pt(0, 0, 0, 0),
      pt(10, 0.01, 2, 0),
      pt(20, 0.02, 4, 0.5),
    ]
    const out = enrichWithContactLineKinematics(data)
    expect(out[1].contactLineVelocityMmS).toBeNull()
    expect(out[1].contactLineAccelMmS2).toBeNull()
    expect(out[2].contactLineVelocityMmS).not.toBeNull()
    expect(out[2].contactLineAccelMmS2).toBeNull()
  })
})
