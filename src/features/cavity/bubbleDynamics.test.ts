import { describe, expect, it } from 'vitest'
import { MOORE_OUTER_CONTOUR_MIN_POINTS } from '../analysis/surfaceEnergy'
import {
  otsuThresholdGray,
  extractCavityMetricsOneFrame,
  isCavityDebrisAspectFailure,
  mergeFrameMeta,
  postprocessCavityDynamicsSeries,
} from './bubbleDynamics'

if (typeof ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(dataOrW: Uint8ClampedArray | number, wOrH?: number, hArg?: number) {
      if (dataOrW instanceof Uint8ClampedArray && typeof wOrH === 'number') {
        this.data = dataOrW
        this.width = wOrH
        this.height = hArg ?? Math.round(dataOrW.length / (wOrH * 4))
      } else if (typeof dataOrW === 'number' && typeof wOrH === 'number') {
        this.width = dataOrW
        this.height = wOrH
        this.data = new Uint8ClampedArray(dataOrW * wOrH * 4)
      } else {
        throw new Error('ImageData polyfill: unsupported ctor')
      }
    }
  } as typeof ImageData
}

describe('bubbleDynamics', () => {
  it('postprocess sets vrAbs as magnitude of signed Vr', () => {
    const base = mergeFrameMeta(
      {
        areaMm2: 1,
        reqMm: 1,
        xcPx: 0,
        ycPx: 0,
        zcMm: 0,
        aspectRatio: 1,
        kappaApexPerPx: 0.1,
        kappaApexPerMm: 10,
        pixelArea: 100,
        touchesRoiBorder: false,
      },
      0,
      0,
    )
    const frames = [
      { ...base, frameIndex: 0, timeSec: 0, reqMm: 2 },
      { ...base, frameIndex: 1, timeSec: 1 / 30, reqMm: 1.5 },
      { ...base, frameIndex: 2, timeSec: 2 / 30, reqMm: 1 },
    ]
    const out = postprocessCavityDynamicsSeries(frames, 30, 0.0728)
    const mid = out[1]!
    expect(mid.vrMmPerS).not.toBeNull()
    expect(mid.vrAbsMmPerS).toBeCloseTo(Math.abs(mid.vrMmPerS!), 10)
  })

  it('otsu splits bimodal histogram', () => {
    const gray = new Uint8Array(10000)
    gray.fill(40, 0, 5000)
    gray.fill(200, 5000, 10000)
    const t = otsuThresholdGray(gray)
    expect(t).toBeGreaterThanOrEqual(40)
    expect(t).toBeLessThan(200)
  })

  it('extract finds dark disk on bright background in ROI', () => {
    const w = 120
    const h = 120
    const data = new Uint8ClampedArray(w * h * 4)
    data.fill(240)
    const cx = 60
    const cy = 60
    const r = 22
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
          const o = (y * w + x) * 4
          data[o] = 25
          data[o + 1] = 25
          data[o + 2] = 25
          data[o + 3] = 255
        }
      }
    }
    const imageData = new ImageData(data, w, h)
    const roi = { x: 20, y: 20, w: 80, h: 80 }
    const out = extractCavityMetricsOneFrame(imageData, roi, {
      mmPerPx: 0.01,
      minPixels: 80,
      invertOtsu: false,
      bubbleDark: true,
      surfaceYPx: null,
      skipClahe: true,
    })
    expect(out.areaMm2).not.toBeNull()
    expect(out.reqMm).not.toBeNull()
    expect(out.pixelArea).not.toBeNull()
    if (out.reqMm != null && out.pixelArea != null) {
      expect(out.pixelArea).toBeGreaterThan(1200)
      expect(out.reqMm).toBeGreaterThan(0.18)
      expect(out.reqMm).toBeLessThan(0.32)
    }
    if (out.kappaApexPerPx != null && out.kappaApexPerMm != null) {
      expect(out.kappaApexPerMm).toBeCloseTo(out.kappaApexPerPx / 0.01, 5)
    }
  })

  it('rejects high-AR filament as debris (null metrics)', () => {
    const w = 100
    const h = 100
    const data = new Uint8ClampedArray(w * h * 4)
    data.fill(240)
    for (let y = 10; y < 90; y++) {
      for (let x = 48; x <= 52; x++) {
        const o = (y * w + x) * 4
        data[o] = 25
        data[o + 1] = 25
        data[o + 2] = 25
        data[o + 3] = 255
      }
    }
    const imageData = new ImageData(data, w, h)
    const roi = { x: 0, y: 0, w: 100, h: 100 }
    const out = extractCavityMetricsOneFrame(imageData, roi, {
      mmPerPx: 0.01,
      minPixels: 20,
      invertOtsu: false,
      bubbleDark: true,
      surfaceYPx: null,
      skipClahe: true,
    })
    expect(out.failedReason).toBeDefined()
    expect(out.reqMm).toBeNull()
    expect(out.areaMm2).toBeNull()
    expect(out.aspectRatio).not.toBeNull()
    expect(out.aspectRatio!).toBeGreaterThan(5)
    const row = mergeFrameMeta(out, 0, 0)
    expect(isCavityDebrisAspectFailure(row)).toBe(true)
  })

  it('includePipelineDebug returns smooth contour in canvas coordinates', () => {
    const w = 120
    const h = 120
    const data = new Uint8ClampedArray(w * h * 4)
    data.fill(240)
    const cx = 60
    const cy = 60
    const r = 22
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
          const o = (y * w + x) * 4
          data[o] = 25
          data[o + 1] = 25
          data[o + 2] = 25
          data[o + 3] = 255
        }
      }
    }
    const imageData = new ImageData(data, w, h)
    const roi = { x: 20, y: 20, w: 80, h: 80 }
    const out = extractCavityMetricsOneFrame(imageData, roi, {
      mmPerPx: 0.01,
      minPixels: 80,
      invertOtsu: false,
      bubbleDark: true,
      surfaceYPx: null,
      skipClahe: true,
      includePipelineDebug: true,
    })
    expect(out.pipelineDebug).toBeDefined()
    const d = out.pipelineDebug!
    expect(d.smoothContourCanvas.length).toBeGreaterThan(MOORE_OUTER_CONTOUR_MIN_POINTS)
    expect(d.rawContourCanvas.length).toBeGreaterThan(0)
    expect(d.otsuThreshold).toBeGreaterThanOrEqual(0)
    expect(d.otsuThreshold).toBeLessThanOrEqual(255)
  })
})
