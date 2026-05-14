import { describe, expect, it } from 'vitest'
import type { AnalysisPoint, CalibrationPoint } from '../../types/analysis'
import {
  baseDiskAreaMm2,
  buildClosedMeridianPolygon,
  calibrationPointsToRzMm,
  deltaSigmaEnergyJ,
  derivativeWrtTimeCentralOrEndpoint,
  dropletMassKg,
  enforceMechanicalEnergyNonIncreasing,
  kineticEnergyJ,
  mechanicalEnergyJ,
  MOORE_OUTER_CONTOUR_MIN_POINTS,
  mooreContourExtractFailedForPoint,
  liquidVaporAreaMm2,
  orderFreeMeridianFootToApex,
  polygonIntegralsR2dz,
  meridiansFromOuterContourPx,
  smoothMeridianRadiusSavitzkyGolay,
  smoothClosedOuterContourPxForDisplay,
  DISPLAY_BASELINE_PRESERVE_PX_DEFAULT,
  referenceSphereVolumeMm3,
  referenceSurfaceEnergyJ,
  volumeFromClosedMeridianMm3,
  zCentroidMmFromClosedMeridian,
  type SurfaceEnergyInstant,
} from './surfaceEnergy'

function hemisphereMeridianArcRMm(R: number, n: number) {
  const pts: { rMm: number; zMm: number }[] = []
  for (let i = 0; i <= n; i++) {
    const phi = (i / n) * (Math.PI / 2)
    pts.push({ rMm: R * Math.cos(phi), zMm: R * Math.sin(phi) })
  }
  return orderFreeMeridianFootToApex(pts)
}

describe('surfaceEnergy geometry', () => {
  it('hemisphere volume ~ (2/3)π R³ via closed meridian', () => {
    const R = 1
    const arc = hemisphereMeridianArcRMm(R, 80)
    const closed = buildClosedMeridianPolygon(arc, R)
    expect(closed).not.toBeNull()
    const v = volumeFromClosedMeridianMm3(closed!)
    expect(v).not.toBeNull()
    const expected = (2 / 3) * Math.PI * R * R * R
    expect(v!).toBeGreaterThan(expected * 0.98)
    expect(v!).toBeLessThan(expected * 1.02)
  })

  it('hemisphere curved LV area ~ 2π R²', () => {
    const R = 1.2
    const arc = hemisphereMeridianArcRMm(R, 100)
    const a = liquidVaporAreaMm2(arc)
    expect(a).not.toBeNull()
    const expected = 2 * Math.PI * R * R
    expect(a!).toBeGreaterThan(expected * 0.99)
    expect(a!).toBeLessThan(expected * 1.01)
  })

  it('liquidVaporAreaMm2 rejects meridian chord jump when pixel scale given', () => {
    const pts: { rMm: number; zMm: number }[] = [
      { rMm: 0, zMm: 0 },
      { rMm: 0.02, zMm: 0.02 },
      { rMm: 0.04, zMm: 0.04 },
    ]
    expect(liquidVaporAreaMm2(pts, 50)).not.toBeNull()
    const broken: typeof pts = [
      ...pts,
      { rMm: 2, zMm: 0.06 },
    ]
    expect(liquidVaporAreaMm2(broken, 50)).toBeNull()
  })

  it('polygonIntegralsR2dz: cone volume with subdivided slant (trapezoid on r²)', () => {
    const R = 2
    const H = 3
    const poly: { rMm: number; zMm: number }[] = [
      { rMm: 0, zMm: 0 },
      { rMm: R, zMm: 0 },
    ]
    const n = 48
    for (let i = 1; i <= n; i++) {
      const t = i / n
      poly.push({ rMm: R * (1 - t), zMm: H * t })
    }
    poly.push({ rMm: 0, zMm: 0 })
    const { sumR2dz, sumZR2dz } = polygonIntegralsR2dz(poly)
    const v = Math.PI * Math.abs(sumR2dz)
    const coneVol = (1 / 3) * Math.PI * R * R * H
    expect(Math.abs(v - coneVol) / coneVol).toBeLessThan(0.02)
    const zCm = sumZR2dz / sumR2dz
    expect(zCm).toBeGreaterThan(0.45)
    expect(zCm).toBeLessThan(0.95)
  })

  it('smoothMeridianRadiusSavitzkyGolay preserves length and dampens radius zigzag', () => {
    const meridian: { rMm: number; zMm: number }[] = Array.from({ length: 40 }, (_, i) => ({
      zMm: i * 0.1,
      rMm: 10 + (i % 3 === 0 ? 0.8 : i % 3 === 1 ? -0.6 : 0.4),
    }))
    const s = smoothMeridianRadiusSavitzkyGolay(meridian)
    expect(s.length).toBe(meridian.length)
    let rough = 0
    for (let i = 2; i < s.length; i++) {
      rough += Math.abs(s[i]!.rMm - 2 * s[i - 1]!.rMm + s[i - 2]!.rMm)
    }
    let rough0 = 0
    for (let i = 2; i < meridian.length; i++) {
      rough0 += Math.abs(meridian[i]!.rMm - 2 * meridian[i - 1]!.rMm + meridian[i - 2]!.rMm)
    }
    expect(rough).toBeLessThan(rough0)
  })

  it('smoothClosedOuterContourPxForDisplay keeps closure and dampens an isolated spike', () => {
    const steps = 60
    const raw: CalibrationPoint[] = []
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2
      raw.push({ x: 100 + 40 * Math.cos(t), y: 80 + 40 * Math.sin(t) })
    }
    raw[25] = { x: raw[25]!.x + 22, y: raw[25]!.y - 15 }
    raw.push({ ...raw[0]! })
    const s = smoothClosedOuterContourPxForDisplay(raw)
    expect(s.length).toBe(raw.length)
    expect(s[0]!.x).toBeCloseTo(s[s.length - 1]!.x, 5)
    expect(s[0]!.y).toBeCloseTo(s[s.length - 1]!.y, 5)
    const neighAvg = (pts: CalibrationPoint[], i: number) => {
      const ring = pts.slice(0, -1)
      const m = ring.length
      const im = (i - 1 + m) % m
      const ip = (i + 1) % m
      return Math.hypot(
        pts[i]!.x - 0.5 * (ring[im]!.x + ring[ip]!.x),
        pts[i]!.y - 0.5 * (ring[im]!.y + ring[ip]!.y),
      )
    }
    expect(neighAvg(s, 25)).toBeLessThan(neighAvg(raw, 25))
  })

  it('smoothClosedOuterContourPxForDisplay: baseline band preserves raw unless bandPx is 0', () => {
    const steps = 80
    const raw: CalibrationPoint[] = []
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2
      raw.push({ x: 100 + 38 * Math.cos(t), y: 72 + 38 * Math.sin(t) })
    }
    raw.push({ ...raw[0]! })
    const surfaceY = 108
    const withBand = smoothClosedOuterContourPxForDisplay(raw, { surfaceYPx: surfaceY })
    const fullSmooth = smoothClosedOuterContourPxForDisplay(raw, {
      surfaceYPx: surfaceY,
      preserveRawNearBaselinePx: 0,
    })
    const ring = raw.slice(0, -1)!
    let found = false
    for (let i = 0; i < ring.length; i++) {
      if (ring[i]!.y >= surfaceY - DISPLAY_BASELINE_PRESERVE_PX_DEFAULT) {
        found = true
        expect(withBand[i]!.x).toBeCloseTo(ring[i]!.x, 5)
        expect(withBand[i]!.y).toBeCloseTo(ring[i]!.y, 5)
      }
    }
    expect(found).toBe(true)
    expect(
      fullSmooth.some(
        (p, i) =>
          i < ring.length &&
          ring[i]!.y >= surfaceY - DISPLAY_BASELINE_PRESERVE_PX_DEFAULT &&
          (Math.abs(p.x - ring[i]!.x) > 1e-3 || Math.abs(p.y - ring[i]!.y) > 1e-3),
      ),
    ).toBe(true)
  })

  it('meridiansFromOuterContourPx uses xmin/xmax symmetry axis and clips baseline for A_wa', () => {
    const surfaceY = 100
    const xCenter = 50
    const contour: CalibrationPoint[] = []
    const eps = 1e-6
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * Math.PI * 0.92
      const rPx = 25 * Math.sin(t)
      const zPx = 25 * Math.cos(t)
      const y = surfaceY - zPx
      contour.push({ x: xCenter - rPx - eps, y })
    }
    for (let i = 12; i >= 0; i--) {
      const t = (i / 12) * Math.PI * 0.92
      const rPx = 25 * Math.sin(t)
      const zPx = 25 * Math.cos(t)
      const y = surfaceY - zPx
      contour.push({ x: xCenter + rPx + eps + 0.8, y })
    }
    contour.push({ ...contour[0]! })

    const m = meridiansFromOuterContourPx(contour, surfaceY, 1, { epsBaselinePx: 3, axisGapPx: 1 })
    expect(m).not.toBeNull()
    expect(m!.xCenterPx).toBeCloseTo(xCenter, 0)
    expect(m!.awaFreeMeridian.length).toBeGreaterThanOrEqual(2)
    const minAwaZ = Math.min(...m!.awaFreeMeridian.map((q) => q.zMm))
    expect(minAwaZ).toBeGreaterThan(2.5)
  })

  it('calibrationPointsToRzMm maps center and baseline', () => {
    const surfaceY = 100
    const subL = 40
    const subR = 60
    const scale = 2
    const pts: CalibrationPoint[] = [
      { x: 40, y: 100 },
      { x: 50, y: 80 },
    ]
    const rz = calibrationPointsToRzMm(pts, surfaceY, subL, subR, scale)!
    expect(rz[0].rMm).toBeCloseTo(10 / scale)
    expect(rz[0].zMm).toBeCloseTo(0)
    expect(rz[1].rMm).toBeCloseTo(0)
    expect(rz[1].zMm).toBeCloseTo(20 / scale)
  })

  it('baseDiskAreaMm2', () => {
    const a = baseDiskAreaMm2(4)
    expect(a).toBeCloseTo(Math.PI * 4)
  })
})

describe('surfaceEnergy thermodynamics', () => {
  it('referenceSurfaceEnergyJ uses π D²', () => {
    const d0Mm = 2
    const g = 0.072
    const e = referenceSurfaceEnergyJ(d0Mm, g)!
    const dM = d0Mm * 1e-3
    expect(e).toBeCloseTo(g * Math.PI * dM * dM)
  })

  it('deltaSigmaEnergyJ subtracts ideal sphere reference', () => {
    const d0Mm = 2
    const gWa = 0.072
    const gBw = 0.04
    const gBa = 0.02
    const awaMm2 = Math.PI * d0Mm * d0Mm
    const dE = deltaSigmaEnergyJ({
      awaMm2,
      abaseMm2: 0,
      gammaWa: gWa,
      gammaBw: gBw,
      gammaBa: gBa,
      d0Mm,
    })
    expect(dE).toBeCloseTo(0, 6)
  })

  it('referenceSphereVolumeMm3 equals π D³ / 6 in mm³', () => {
    const d0Mm = 2
    const v = referenceSphereVolumeMm3(d0Mm)!
    expect(v).toBeCloseTo((Math.PI / 6) * d0Mm ** 3)
  })

  it('dropletMassKg uses π D³ / 6', () => {
    const d0Mm = 3
    const rho = 1000
    const m = dropletMassKg(d0Mm, rho)!
    const dm = d0Mm * 1e-3
    expect(m).toBeCloseTo(rho * (Math.PI / 6) * dm ** 3)
  })

  it('kineticEnergyJ affine formula', () => {
    const m = 1e-6
    const ek = kineticEnergyJ(m, 2, 4)
    expect(ek).toBeCloseTo(0.5 * m * (4 + 0.5 * 16))
  })

  it('mechanicalEnergyJ sums ΔE_σ and E_k', () => {
    expect(mechanicalEnergyJ(1e-7, 2e-7)).toBeCloseTo(3e-7)
    expect(mechanicalEnergyJ(null, 1)).toBeNull()
    expect(mechanicalEnergyJ(1, null)).toBeNull()
  })
})

describe('mooreContourExtractFailedForPoint', () => {
  const fakeContour: CalibrationPoint[] = Array.from(
    { length: MOORE_OUTER_CONTOUR_MIN_POINTS },
    (_, i) => ({ x: i, y: 0 }),
  )

  it('false when mooreContourExtractOk true', () => {
    expect(mooreContourExtractFailedForPoint({ mooreContourExtractOk: true } as AnalysisPoint)).toBe(false)
  })

  it('true when mooreContourExtractOk false even if outerContourPx is long (e.g. carried)', () => {
    expect(
      mooreContourExtractFailedForPoint({
        outerContourPx: fakeContour,
        mooreContourExtractOk: false,
      } as AnalysisPoint),
    ).toBe(true)
  })

  it('legacy rows without flag infer from outerContourPx length', () => {
    expect(mooreContourExtractFailedForPoint({ outerContourPx: fakeContour } as AnalysisPoint)).toBe(false)
    expect(mooreContourExtractFailedForPoint({ outerContourPx: [] } as unknown as AnalysisPoint)).toBe(true)
    expect(mooreContourExtractFailedForPoint({} as unknown as AnalysisPoint)).toBe(true)
  })
})

describe('derivativeWrtTimeCentralOrEndpoint', () => {
  it('matches slope on uniform grid for interior central difference', () => {
    const times = [0, 10, 20, 30]
    const vals = [0, 10, 20, 30].map((x) => x * 0.1)
    const i = 2
    const g = derivativeWrtTimeCentralOrEndpoint(vals, times, i)
    expect(g).toBeCloseTo((vals[3] - vals[1]) / (times[3] - times[1]))
  })

  it('forward at index 0 when central unavailable', () => {
    const times = [0, 10, 20]
    const vals = [1, 3, 5]
    const g = derivativeWrtTimeCentralOrEndpoint(vals, times, 0)
    expect(g).toBeCloseTo((vals[1] - vals[0]) / (times[1] - times[0]))
  })

  it('backward at last index', () => {
    const times = [0, 10, 20]
    const vals = [1, 3, 5]
    const g = derivativeWrtTimeCentralOrEndpoint(vals, times, 2)
    expect(g).toBeCloseTo((vals[2] - vals[1]) / (times[2] - times[1]))
  })
})

function minimalSurfaceEnergyInstant(emechanicalJ: number | null): SurfaceEnergyInstant {
  return {
    timeMs: 0,
    absTime: 0,
    contourExtractFailed: false,
    awaMm2: null,
    abaseMm2: null,
    volumeMm3: null,
    zCmMm: null,
    deltaESigmaJ: null,
    ekJ: null,
    emechanicalJ,
    emechanical0J: null,
    dissipationWorkJ: null,
    dissipationPowerW: null,
    vCmMps: null,
    vSpreadMps: null,
  }
}

describe('enforceMechanicalEnergyNonIncreasing', () => {
  it('clamps upward spikes to previous finite value', () => {
    const rows: SurfaceEnergyInstant[] = [
      minimalSurfaceEnergyInstant(10e-6),
      minimalSurfaceEnergyInstant(12e-6),
      minimalSurfaceEnergyInstant(11e-6),
      minimalSurfaceEnergyInstant(9e-6),
    ]
    enforceMechanicalEnergyNonIncreasing(rows)
    expect(rows[0].emechanicalJ).toBeCloseTo(10e-6, 12)
    expect(rows[1].emechanicalJ).toBeCloseTo(10e-6, 12)
    expect(rows[2].emechanicalJ).toBeCloseTo(10e-6, 12)
    expect(rows[3].emechanicalJ).toBeCloseTo(9e-6, 12)
  })
})

describe('zCentroidMm matches hemisphere', () => {
  it('z_cm ≈ 3R/8 for homogeneous hemisphere', () => {
    const R = 2
    const arc = hemisphereMeridianArcRMm(R, 120)
    const closed = buildClosedMeridianPolygon(arc, R)!
    const zCm = zCentroidMmFromClosedMeridian(closed)
    expect(zCm).not.toBeNull()
    const theory = (3 * R) / 8
    expect(zCm!).toBeGreaterThan(theory * 0.97)
    expect(zCm!).toBeLessThan(theory * 1.03)
  })
})
