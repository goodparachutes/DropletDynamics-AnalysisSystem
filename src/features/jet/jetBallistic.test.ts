import { describe, expect, it } from 'vitest'
import type { JetDropSample } from '../../types/jetDynamics'
import { postprocessJetBallisticVelocityAndEk } from './jetDynamics'

function makeSample(frameIndex: number, zMm: number, volMm3: number): JetDropSample {
  const dt = 1 / 5000
  return {
    frameIndex,
    timeSec: frameIndex * dt,
    zTipMm: zMm,
    vJetMmPerS: null,
    areaDropMm2: 1,
    volMm3,
    aspectRatio: 1,
  }
}

describe('postprocessJetBallisticVelocityAndEk', () => {
  const calib = {
    zeroTimeSec: 0,
    exportedFps: 5000,
    samplingFps: 5000,
    durationSec: 10,
  }

  it('sets constant V_jet from Z–t slope and locked E_k from mean volume', () => {
    const rho = 1000
    const samples = [
      makeSample(0, 0, 0.001),
      makeSample(1, 0.2, 0.001),
      makeSample(2, 0.4, 0.001),
    ]
    const out = postprocessJetBallisticVelocityAndEk(samples, calib, rho)
    expect(out.length).toBe(3)
    const v = out[0]!.vJetMmPerS
    expect(v).not.toBeNull()
    for (const s of out) expect(s.vJetMmPerS).toBe(v)
    const ek0 = out[0]!.ekJoule
    expect(ek0).not.toBeNull()
    for (const s of out) expect(s.ekJoule).toBe(ek0)
    const meanVol = 0.001
    const vMs = (v as number) * 1e-3
    const ekExpected = 0.5 * rho * (meanVol * 1e-9) * vMs * vMs
    expect(ek0).toBeCloseTo(ekExpected, 6)
  })

  it('returns null V and E_k when fewer than two Z points', () => {
    const one = [makeSample(0, 1.0, 0.001)]
    const out = postprocessJetBallisticVelocityAndEk(one, calib, 1000)
    expect(out[0]!.vJetMmPerS).toBeNull()
    expect(out[0]!.ekJoule).toBeNull()
  })
})
