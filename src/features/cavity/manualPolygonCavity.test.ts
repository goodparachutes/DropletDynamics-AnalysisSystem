import { describe, expect, it } from 'vitest'
import {
  computeCavityMetricsFromManualPolygon,
  polygonCentroidPx,
  polygonShoelaceAreaPx,
} from './manualPolygonCavity'

describe('manualPolygonCavity', () => {
  it('unit square shoelace area = 1', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    expect(polygonShoelaceAreaPx(sq)).toBeCloseTo(1, 8)
  })

  it('square centroid at center', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]
    const a = polygonShoelaceAreaPx(sq)
    const c = polygonCentroidPx(sq, a)
    expect(c).not.toBeNull()
    expect(c!.x).toBeCloseTo(1, 6)
    expect(c!.y).toBeCloseTo(1, 6)
  })

  it('computeCavityMetricsFromManualPolygon returns R_eq from area', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ]
    const m = computeCavityMetricsFromManualPolygon(tri, 0.001, 100)
    expect(m).not.toBeNull()
    const areaMm2 = m!.areaMm2
    const req = Math.sqrt(areaMm2 / Math.PI)
    expect(m!.reqMm).toBeCloseTo(req, 6)
  })
})
