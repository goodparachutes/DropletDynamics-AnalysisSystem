import { describe, expect, it } from 'vitest'
import { linearLeastSquaresXY } from './linearLeastSquares'

describe('linearLeastSquaresXY', () => {
  it('recovers slope and intercept for exact line', () => {
    const xs = [0, 1, 2, 3]
    const ys = [2, 5, 8, 11]
    const fit = linearLeastSquaresXY(xs, ys)
    expect(fit).not.toBeNull()
    expect(fit!.slope).toBeCloseTo(3, 10)
    expect(fit!.intercept).toBeCloseTo(2, 10)
    expect(fit!.r2).toBeCloseTo(1, 10)
    expect(fit!.n).toBe(4)
  })

  it('returns null when x has no variance', () => {
    expect(linearLeastSquaresXY([1, 1, 1], [1, 2, 3])).toBeNull()
  })
})
