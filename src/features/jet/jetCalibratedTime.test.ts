import { describe, expect, it } from 'vitest'
import {
  jetCalibratedTimeMs,
  jetCalibratedTimeMsDecimalPlaces,
  jetNominalFrameDeltaMs,
} from './jetDynamics'

describe('jetCalibratedTimeMs', () => {
  it('uses nominal 0.2 ms step when export and sampling are 5000 Hz', () => {
    expect(jetNominalFrameDeltaMs(5000, 5000)).toBeCloseTo(0.2, 10)
    expect(jetCalibratedTimeMsDecimalPlaces(0.2)).toBe(1)
  })

  it('snaps to Δt grid relative to zero seek time', () => {
    const decodeFps = 5000
    const seek = (fi: number) => (Math.max(0, fi) + 0.5) / decodeFps
    const zero = seek(10)
    const dur = 10
    const t34 = jetCalibratedTimeMs(34, 5000, 5000, zero, dur)
    const expectedMs = (seek(34) - zero) * 1000
    expect(expectedMs).toBeCloseTo(4.8, 10)
    expect(t34).toBeCloseTo(4.8, 10)
    expect(Math.abs(t34 / 0.2 - Math.round(t34 / 0.2))).toBeLessThan(1e-9)
  })
})
