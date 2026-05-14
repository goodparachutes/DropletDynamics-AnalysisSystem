import { describe, expect, it } from 'vitest'
import {
  chooseInterfaceIntoLiquidForYoungAngle,
  interfaceIntoLiquidFromAngleDeg,
} from './contactAngleOverlay'

describe('interfaceIntoLiquidFromAngleDeg', () => {
  function angleDegBetween(
    u: { x: number; y: number },
    v: { x: number; y: number },
  ): number {
    const dot = u.x * v.x + u.y * v.y
    return (180 / Math.PI) * Math.acos(Math.max(-1, Math.min(1, dot)))
  }

  it('left: ray from solid into liquid matches obtuse Young θ', () => {
    const solid = { x: 1, y: 0 }
    const v = interfaceIntoLiquidFromAngleDeg('left', 121.1)
    expect(angleDegBetween(solid, v)).toBeCloseTo(121.1, 1)
    expect(v.y).toBeLessThan(0)
  })

  it('left: acute θ still opens into liquid (upward)', () => {
    const solid = { x: 1, y: 0 }
    const v = interfaceIntoLiquidFromAngleDeg('left', 42)
    expect(angleDegBetween(solid, v)).toBeCloseTo(42, 1)
    expect(v.y).toBeLessThan(0)
  })

  it('right: ray matches θ', () => {
    const solid = { x: -1, y: 0 }
    const v = interfaceIntoLiquidFromAngleDeg('right', 121.1)
    expect(angleDegBetween(solid, v)).toBeCloseTo(121.1, 1)
    expect(v.y).toBeLessThan(0)
  })
})

describe('chooseInterfaceIntoLiquidForYoungAngle', () => {
  it('flips candidate when geometric acute angle would mismatch θ', () => {
    const solid = { x: 1, y: 0 }
    const rad = (59 * Math.PI) / 180
    const u = { x: Math.cos(rad), y: -Math.sin(rad) }
    const chosen = chooseInterfaceIntoLiquidForYoungAngle('left', solid, u, 121)
    const dot = solid.x * chosen.x + solid.y * chosen.y
    const ang = (180 / Math.PI) * Math.acos(Math.max(-1, Math.min(1, dot)))
    expect(ang).toBeCloseTo(121, 1)
  })
})
