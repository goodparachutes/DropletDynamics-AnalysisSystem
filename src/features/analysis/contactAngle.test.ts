import { describe, expect, it } from 'vitest'
import {
  enrichAnalysisPointContactAngles,
  estimateContactAngleDeg,
  getContactAngleFitGeometry,
  linearRegressionDepthPxFromFitPrecision,
  linearRegressionMaxPointsFromFitPrecision,
  mergeContactAngleFitOptsForPoint,
} from './contactAngle'
import type { AnalysisPoint } from '../../types/analysis'

describe('linearRegression fit precision mapping', () => {
  it('maps 0 and 100 to depth and point cap ranges', () => {
    expect(linearRegressionDepthPxFromFitPrecision(0)).toBe(14)
    expect(linearRegressionDepthPxFromFitPrecision(100)).toBe(56)
    expect(linearRegressionMaxPointsFromFitPrecision(0)).toBe(4)
    expect(linearRegressionMaxPointsFromFitPrecision(100)).toBe(15)
  })
})

describe('estimateContactAngleDeg', () => {
  const surfaceY = 100

  it('fits left edge with negative dx/dy (x rises as y decreases toward apex)', () => {
    const pts = Array.from({ length: 12 }, (_, i) => {
      const y = 88 + i
      return { x: 280 - 2 * y, y }
    })
    const θ = estimateContactAngleDeg(pts, surfaceY, 'left')
    expect(θ).not.toBeNull()
    const expected = (180 / Math.PI) * (Math.PI / 2 + Math.atan(-2))
    expect(Math.abs((θ as number) - expected)).toBeLessThan(0.05)
    const geo = getContactAngleFitGeometry(pts, surfaceY, 'left')
    expect(geo).not.toBeNull()
    expect(Math.abs((geo as { angleDeg: number }).angleDeg - (θ as number))).toBeLessThan(0.06)
    expect((geo as { dxDy: number }).dxDy).toBeCloseTo(-2, 5)
  })

  it('fits right edge with positive dx/dy symmetrically', () => {
    const pts = Array.from({ length: 12 }, (_, i) => {
      const y = 88 + i
      return { x: 2 * y + 120, y }
    })
    const θ = estimateContactAngleDeg(pts, surfaceY, 'right')
    expect(θ).not.toBeNull()
    const expected = (180 / Math.PI) * (Math.PI / 2 - Math.atan(2))
    expect(Math.abs((θ as number) - expected)).toBeLessThan(0.05)
    const θLeftMirror = estimateContactAngleDeg(
      pts.map((p) => ({ x: -p.x, y: p.y })),
      surfaceY,
      'left',
    )
    expect(θ).toBeCloseTo(θLeftMirror as number, 1)
  })

  it('returns null when too few points in band', () => {
    const pts = [
      { x: 0, y: 99 },
      { x: 1, y: 98 },
    ]
    expect(estimateContactAngleDeg(pts, surfaceY, 'left', { minPoints: 4 })).toBeNull()
    expect(estimateContactAngleDeg(pts, surfaceY, 'left', { minPoints: 3 })).toBeNull()
  })

  it('uses only points nearest baseline so distant outliers do not dominate slope', () => {
    const surfaceY = 100
    const good = Array.from({ length: 9 }, (_, i) => {
      const y = 99 - i
      return { x: 10 + 0.5 * y, y }
    })
    const bad = [
      { x: 400, y: 78 },
      { x: 400, y: 79 },
      { x: 400, y: 80 },
    ]
    const pts = [...bad, ...good]
    const θNear = estimateContactAngleDeg(pts, surfaceY, 'left')
    const θAll = estimateContactAngleDeg(pts, surfaceY, 'left', { nearBaselineMaxPoints: 99 })
    expect(θNear).not.toBeNull()
    expect(θAll).not.toBeNull()
    expect(Math.abs((θNear as number) - (θAll as number))).toBeGreaterThan(2)
  })

  it('linearRegression drops pts whose x is closer to opposite foot (mixed edge garbage)', () => {
    const surfaceY = 100
    const subL = 80
    const subR = 320
    const good = [
      { x: 82, y: 99 },
      { x: 84, y: 98 },
      { x: 86, y: 97 },
      { x: 88, y: 96 },
    ]
    const poison = { x: 300, y: 99 }
    const pts = [...good, poison]
    const filtered = estimateContactAngleDeg(pts, surfaceY, 'left', { method: 'linearRegression' }, subL, subR)
    const raw = estimateContactAngleDeg(pts, surfaceY, 'left', { method: 'linearRegression' })
    expect(filtered).not.toBeNull()
    expect(raw).not.toBeNull()
    expect(Math.abs((filtered as number) - (raw as number))).toBeGreaterThan(3)
  })

  it('spreadSpline uses same dx/dy as linear on collinear contour near baseline', () => {
    const surfaceY = 100
    const pts = Array.from({ length: 12 }, (_, i) => {
      const y = 88 + i
      return { x: 280 - 2 * y, y }
    })
    const footX = 280 - 2 * surfaceY
    const linear = estimateContactAngleDeg(pts, surfaceY, 'left', { method: 'linearRegression' })
    const sp = estimateContactAngleDeg(pts, surfaceY, 'left', { method: 'spreadSpline', fitPrecision: 70 }, footX)
    expect(linear).not.toBeNull()
    expect(sp).not.toBeNull()
    expect(Math.abs((linear as number) - (sp as number))).toBeLessThan(0.25)
  })
})

describe('mergeContactAngleFitOptsForPoint', () => {
  it('overrides base fitPrecision and syncs linear regression depth', () => {
    const pt: AnalysisPoint = {
      time: 0,
      absTime: 0,
      beta: 1,
      absDiameter: 2,
      contactAngleFitPrecision: 100,
    }
    const merged = mergeContactAngleFitOptsForPoint(pt, {
      fitPrecision: 10,
      method: 'linearRegression',
    })
    expect(merged?.fitPrecision).toBe(100)
    expect(merged?.maxDepthPx).toBe(linearRegressionDepthPxFromFitPrecision(100))
    expect(merged?.nearBaselineMaxPoints).toBe(linearRegressionMaxPointsFromFitPrecision(100))
  })

  it('returns base when point has no override', () => {
    const pt: AnalysisPoint = { time: 0, absTime: 0, beta: 1, absDiameter: 2 }
    const base = { fitPrecision: 55 as const }
    expect(mergeContactAngleFitOptsForPoint(pt, base)).toBe(base)
  })
})

describe('enrichAnalysisPointContactAngles', () => {
  it('strips angles at zero-spread moment', () => {
    const p: AnalysisPoint = {
      time: 0,
      absTime: 0,
      beta: 0,
      absDiameter: 0,
      subL: 100,
      subR: 100,
      ptsL: [{ x: 0, y: 90 }],
      ptsR: [{ x: 200, y: 90 }],
      contactAngleLeftDeg: 45,
      contactAngleRightDeg: 45,
    }
    const out = enrichAnalysisPointContactAngles(p, 100)
    expect(out.contactAngleLeftDeg).toBeUndefined()
    expect(out.contactAngleRightDeg).toBeUndefined()
    expect(out.contactAngleAvgDeg).toBeUndefined()
  })
})
