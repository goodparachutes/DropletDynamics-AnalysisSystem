import { describe, expect, it } from 'vitest'
import { computeJetMacroInputEnergyJ } from './jetDynamics'

describe('computeJetMacroInputEnergyJ', () => {
  it('matches hand check for water-like sphere', () => {
    const rho = 1000
    const d0Mm = 2
    const R0 = (d0Mm * 1e-3) / 2
    const u0 = 10
    const sigma = 0.072
    const ek0 = 0.5 * rho * (4 / 3) * Math.PI * R0 ** 3 * u0 * u0
    const es0 = sigma * 4 * Math.PI * R0 ** 2
    const ein = computeJetMacroInputEnergyJ({
      rhoKgM3: rho,
      d0Mm: d0Mm,
      u0Mps: u0,
      sigmaNm: sigma,
    })
    expect(ein).toBeCloseTo(ek0 + es0, 6)
  })

  it('returns null without U0', () => {
    expect(
      computeJetMacroInputEnergyJ({
        rhoKgM3: 1000,
        d0Mm: 2,
        u0Mps: null,
        sigmaNm: 0.072,
      }),
    ).toBeNull()
  })
})
