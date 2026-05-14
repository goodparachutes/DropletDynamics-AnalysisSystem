import { describe, expect, it } from 'vitest'
import {
  anchorSmoothedDissipationWorkAtZero,
  computeDissipationSeries,
  DISSIPATION_SG_POLYNOMIAL_DEFAULT,
  DISSIPATION_WDISS_SMOOTH_WINDOW_DEFAULT,
  smoothDissipationWorkMovingAverage,
  smoothDissipationWorkSavitzkyGolay,
} from './surfaceEnergyDissipation'

describe('anchorSmoothedDissipationWorkAtZero', () => {
  it('subtracts index-0 smoothed bias so origin is exactly zero', () => {
    const w: (number | null)[] = [1.5e-6, 3e-6, 4e-6]
    anchorSmoothedDissipationWorkAtZero(w)
    expect(w[0]).toBe(0)
    expect(w[1]).toBeCloseTo(1.5e-6, 12)
    expect(w[2]).toBeCloseTo(2.5e-6, 12)
  })

  it('uses first finite sample when index 0 is null', () => {
    const w: (number | null)[] = [null, 2e-6, 4e-6]
    anchorSmoothedDissipationWorkAtZero(w)
    expect(w[1]).toBe(0)
    expect(w[2]).toBeCloseTo(2e-6, 12)
  })

  it('no-op when head is already zero', () => {
    const w: (number | null)[] = [0, 2e-6]
    anchorSmoothedDissipationWorkAtZero(w)
    expect(w[0]).toBe(0)
    expect(w[1]).toBeCloseTo(2e-6, 12)
  })
})

describe('smoothDissipationWorkMovingAverage', () => {
  it('matches simple mean for dense finite series', () => {
    const raw = [0, 6e-6]
    const s = smoothDissipationWorkMovingAverage(raw, 7)
    expect(s[0]).toBeCloseTo(3e-6, 12)
    expect(s[1]).toBeCloseTo(3e-6, 12)
  })
})

describe('smoothDissipationWorkSavitzkyGolay', () => {
  it('smooths contiguous segment and preserves rough magnitude', () => {
    const raw = [0, 1e-7, 3e-7, 6e-7, 10e-7].map((x) => x as number | null)
    const s = smoothDissipationWorkSavitzkyGolay(raw, 5, DISSIPATION_SG_POLYNOMIAL_DEFAULT)
    expect(s.every((v) => v != null && v >= 0)).toBe(true)
    expect(s[s.length - 1]!).toBeGreaterThan(5e-8)
  })
})

describe('computeDissipationSeries', () => {
  it('locks E_mech(0); W_diss is raw max(0,E0−E_mech) without smoothing', () => {
    const pts = [
      { timeMs: 0, ekJ: 10e-6, deltaESigmaJ: 0 },
      { timeMs: 1, ekJ: 4e-6, deltaESigmaJ: 0 },
    ]
    const r = computeDissipationSeries(pts)
    expect(r[0].emechanical0J).toBeCloseTo(10e-6, 12)
    expect(r[0].dissipationWorkJ).toBe(0)
    expect(r[1].dissipationWorkJ).toBeCloseTo(6e-6, 12)
  })

  it('first frame W_diss is 0 on longer series (raw W(0)=0)', () => {
    const pts = Array.from({ length: 16 }, (_, i) => ({
      timeMs: i,
      ekJ: 10e-6 - i * 0.4e-6,
      deltaESigmaJ: 0 as number,
    }))
    const r = computeDissipationSeries(pts)
    expect(r[0].dissipationWorkJ).toBe(0)
  })

  it('interior Phi: raw W → raw Φ → MA(Φ) → max0; linear W trend keeps Φ ~ slope', () => {
    const dtMs = 1
    const slopeJPerS = 3e-6
    const n = 14
    const pts = Array.from({ length: n }, (_, i) => ({
      timeMs: i * dtMs,
      ekJ: 10e-6 - (slopeJPerS * i * dtMs) / 1000,
      deltaESigmaJ: 0 as number,
    }))
    const r = computeDissipationSeries(pts, { smoothWindow: DISSIPATION_WDISS_SMOOTH_WINDOW_DEFAULT })
    expect(r[7].dissipationPowerW).toBeCloseTo(slopeJPerS, 5)
    expect(r[8].dissipationPowerW).toBeCloseTo(slopeJPerS, 5)
  })

  it('smoothMode sg: interior Phi ~ slope after SG on raw Φ', () => {
    const dtMs = 1
    const slopeJPerS = 3e-6
    const n = 21
    const pts = Array.from({ length: n }, (_, i) => ({
      timeMs: i * dtMs,
      ekJ: 10e-6 - (slopeJPerS * i * dtMs) / 1000,
      deltaESigmaJ: 0 as number,
    }))
    const r = computeDissipationSeries(pts, {
      smoothMode: 'sg',
      smoothWindow: 9,
      sgPolynomialDegree: 3,
    })
    expect(r[0].dissipationWorkJ).toBe(0)
    expect(r[10].dissipationPowerW).toBeCloseTo(slopeJPerS, 4)
    expect(r[11].dissipationPowerW).toBeCloseTo(slopeJPerS, 4)
  })

  it('dissipation power is never negative when defined', () => {
    const pts = [
      { timeMs: 0, ekJ: 10e-6, deltaESigmaJ: 0 },
      { timeMs: 1, ekJ: 12e-6, deltaESigmaJ: 0 },
      { timeMs: 2, ekJ: 11e-6, deltaESigmaJ: 0 },
      { timeMs: 3, ekJ: 10e-6, deltaESigmaJ: 0 },
      { timeMs: 4, ekJ: 9e-6, deltaESigmaJ: 0 },
    ]
    const r = computeDissipationSeries(pts)
    for (const row of r) {
      if (row.dissipationPowerW != null) {
        expect(row.dissipationPowerW).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('uses emechanicalJ when provided for raw W_diss', () => {
    const pts = [
      { timeMs: 0, ekJ: 10e-6, deltaESigmaJ: 0, emechanicalJ: 10e-6 },
      { timeMs: 1, ekJ: 99e-6, deltaESigmaJ: 0, emechanicalJ: 9e-6 },
    ]
    const r = computeDissipationSeries(pts)
    expect(r[0].dissipationWorkJ).toBe(0)
    expect(r[1].dissipationWorkJ).toBeCloseTo(1e-6, 12)
  })

  it('falls back when frame 0 incomplete; raw W from E0 at first valid frame', () => {
    const pts = [
      { timeMs: 0, ekJ: null, deltaESigmaJ: 0 },
      { timeMs: 1, ekJ: 5e-6, deltaESigmaJ: 0 },
      { timeMs: 2, ekJ: 2e-6, deltaESigmaJ: 0 },
    ]
    const r = computeDissipationSeries(pts)
    expect(r[1].emechanical0J).toBeCloseTo(5e-6, 12)
    expect(r[0].dissipationWorkJ).toBe(null)
    expect(r[1].dissipationWorkJ).toBe(0)
    expect(r[2].dissipationWorkJ).toBeCloseTo(3e-6, 12)
  })
})
