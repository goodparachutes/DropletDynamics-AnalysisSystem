import { describe, expect, it } from 'vitest'
import {
  cavityDiscreteFrameSeekTimeSec,
  cropImageData,
  finalizeAnalysisRegionFromDrag,
} from './analysisRegion'

/** Node 测试环境无 DOM ImageData，与浏览器构造子集一致 */
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageDataPolyfill {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(sw: number | Uint8ClampedArray, sh: number) {
      if (typeof sw === 'number') {
        this.width = sw
        this.height = sh
        this.data = new Uint8ClampedArray(sw * sh * 4)
      } else {
        this.data = sw
        this.width = sh
        this.height = sw.length / (sh * 4)
      }
    }
  } as typeof ImageData
}

describe('analysisRegion', () => {
  it('finalizeAnalysisRegionFromDrag clamps and includes surfaceY', () => {
    const r = finalizeAnalysisRegionFromDrag(200, 300, 10, 50, 90, 120, 100)
    expect(r).not.toBeNull()
    expect(r!.y).toBeLessThanOrEqual(100)
    expect(r!.y + r!.h).toBeGreaterThan(100)
  })

  it('cavityDiscreteFrameSeekTimeSec centers on frame index so floor(t*fps) matches', () => {
    const fps = 25
    for (const fi of [0, 1, 100, 999]) {
      const t = cavityDiscreteFrameSeekTimeSec(fi, fps, 3600)
      expect(Math.floor(t * fps + 1e-9)).toBe(fi)
    }
  })

  it('cavityDiscreteFrameSeekTimeSec clamps to duration', () => {
    expect(cavityDiscreteFrameSeekTimeSec(0, 30, 0.01)).toBeLessThanOrEqual(0.01)
  })

  it('cropImageData copies sub-rectangle', () => {
    const w = 8
    const h = 6
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 10
      data[i + 1] = 20
      data[i + 2] = 30
      data[i + 3] = 255
    }
    const full = new ImageData(data, w, h)
    const sub = cropImageData(full, { x: 2, y: 1, w: 3, h: 2 })
    expect(sub.width).toBe(3)
    expect(sub.height).toBe(2)
    expect(sub.data[0]).toBe(10)
  })
})
