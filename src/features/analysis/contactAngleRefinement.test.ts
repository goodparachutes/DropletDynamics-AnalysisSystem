import { describe, expect, it } from 'vitest'
import { refineContactAnglesSeries } from './contactAngleRefinement'
import type { AnalysisPoint } from '../../types/analysis'

function pt(over: Partial<AnalysisPoint> & Pick<AnalysisPoint, 'time' | 'absTime' | 'beta' | 'absDiameter'>): AnalysisPoint {
  return { ...over }
}

describe('refineContactAnglesSeries', () => {
  it('replaces temporal outlier on left side', () => {
    const series: AnalysisPoint[] = [
      pt({ time: 0, absTime: 0, beta: 1, absDiameter: 2, contactAngleLeftDeg: 40 }),
      pt({ time: 1, absTime: 1, beta: 1, absDiameter: 2, contactAngleLeftDeg: 90 }),
      pt({ time: 2, absTime: 2, beta: 1, absDiameter: 2, contactAngleLeftDeg: 42 }),
    ]
    const out = refineContactAnglesSeries(series, {
      maxNeighborDeviationDeg: 10,
      maxLeftRightDiffDeg: 100,
      temporalPasses: 2,
    })
    expect(out[1].contactAngleLeftDeg).toBeCloseTo(41, 0)
  })

  it('averages left and right when difference is large', () => {
    const series: AnalysisPoint[] = [
      pt({
        time: 0,
        absTime: 0,
        beta: 1,
        absDiameter: 2,
        contactAngleLeftDeg: 50,
        contactAngleRightDeg: 80,
      }),
    ]
    const out = refineContactAnglesSeries(series, {
      maxNeighborDeviationDeg: 100,
      maxLeftRightDiffDeg: 20,
      temporalPasses: 0,
    })
    expect(out[0].contactAngleLeftDeg).toBeCloseTo(65, 1)
    expect(out[0].contactAngleRightDeg).toBeCloseTo(65, 1)
  })
})
