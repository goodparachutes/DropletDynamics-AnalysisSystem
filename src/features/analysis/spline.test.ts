import { describe, expect, it } from 'vitest'
import { createCubicSpline, createCubicSplineModel, createPchipSplineModel } from './spline'

describe('createCubicSpline', () => {
  it('interpolates endpoints correctly', () => {
    const spline = createCubicSpline([0, 1, 2], [0, 2, 4])
    expect(spline(0)).toBeCloseTo(0, 6)
    expect(spline(2)).toBeCloseTo(4, 6)
  })

  it('extrapolates finite values outside range', () => {
    const spline = createCubicSpline([1, 2, 3], [2, 4, 6])
    expect(Number.isFinite(spline(-1))).toBe(true)
    expect(Number.isFinite(spline(5))).toBe(true)
  })
})

describe('createCubicSplineModel', () => {
  it('dxDyAt matches slope for collinear knots', () => {
    const m = createCubicSplineModel([0, 1, 2], [0, 2, 4])
    expect(m.dxDyAt(1)).toBeCloseTo(2, 5)
    expect(m.dxDyAt(2.5)).toBeCloseTo(2, 5)
  })
})

describe('createPchipSplineModel', () => {
  it('dxDyAt matches slope for collinear knots', () => {
    const m = createPchipSplineModel([0, 1, 2], [0, 2, 4])
    expect(m.dxDyAt(1)).toBeCloseTo(2, 5)
    expect(m.dxDyAt(2.5)).toBeCloseTo(2, 5)
  })

  it('endpoint derivative stays close to monotone edge slope (less wild than natural spline on S-curve)', () => {
    const y = [0, 1, 2, 3, 4]
    const x = [0, 0.15, 0.55, 0.75, 1.0]
    const natural = createCubicSplineModel(y, x).dxDyAt(4)
    const pchip = createPchipSplineModel(y, x).dxDyAt(4)
    const secantLast = (x[4] - x[3]) / (y[4] - y[3])
    expect(Math.abs(pchip - secantLast)).toBeLessThan(Math.abs(natural - secantLast))
  })
})
