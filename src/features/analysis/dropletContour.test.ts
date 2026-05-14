import { describe, expect, it } from 'vitest'
import {
  buildForegroundMaskForContour,
  clampBinaryMaskBelowBaseline,
  floodFillForegroundMask,
  imageDataToDropletMask,
  solidifyDropletMaskByBackgroundFloodInvert,
  syntheticBackgroundGrayFromFrame,
  traceMooreOuterContour,
  extractDropletOuterContourPx,
} from './dropletContour'

function solidRectImageData(
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fg: number,
  bg: number,
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1
      const g = inside ? fg : bg
      const i = (y * w + x) * 4
      data[i] = g
      data[i + 1] = g
      data[i + 2] = g
      data[i + 3] = 255
    }
  }
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData
}

describe('dropletContour', () => {
  it('solidifyDropletMaskByBackgroundFloodInvert fills enclosed TIR hole (donut → disk)', () => {
    const w = 21
    const h = 21
    const mask = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - 10, y - 10)
        if (d <= 9 && d >= 4) mask[y * w + x] = 1
      }
    }
    let holeZeros = 0
    let ringOnes = 0
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) ringOnes++
      else holeZeros++
    }
    expect(ringOnes).toBeGreaterThan(80)
    expect(holeZeros).toBeGreaterThan(50)

    solidifyDropletMaskByBackgroundFloodInvert(mask, w, h)
    let ones = 0
    for (let i = 0; i < mask.length; i++) if (mask[i]) ones++
    expect(ones).toBeGreaterThan(ringOnes + 40)
    expect(mask[10 * w + 10]).toBe(1)
    expect(mask[0]).toBe(0)
  })

  it('floodFillForegroundMask keeps single bright blob', () => {
    const img = solidRectImageData(64, 64, 16, 16, 47, 47, 250, 10)
    const mask = imageDataToDropletMask(img, 128, true)
    const comp = floodFillForegroundMask(mask, 64, 64, 32, 32)
    let cnt = 0
    for (let i = 0; i < comp.length; i++) if (comp[i]) cnt++
    expect(cnt).toBe((47 - 16 + 1) * (47 - 16 + 1))
  })

  it('traceMooreOuterContour returns closed chain around filled rectangle', () => {
    const img = solidRectImageData(80, 80, 20, 20, 59, 59, 255, 0)
    const mask = imageDataToDropletMask(img, 128, true)
    const comp = floodFillForegroundMask(mask, 80, 80, 40, 40)
    const c = traceMooreOuterContour(comp, 80, 80)
    expect(c).not.toBeNull()
    expect(c!.length).toBeGreaterThan(80)
    const a = c![0]!
    const b = c![c!.length - 1]!
    expect(a.x).toBe(b.x)
    expect(a.y).toBe(b.y)
  })

  it('horizontalRayLeft starts Moore at first east-edge pixel on the scan row', () => {
    const w = 50
    const h = 50
    const comp = new Uint8Array(w * h)
    for (let y = 5; y <= 44; y++) {
      for (let x = 5; x <= 44; x++) {
        const inHole = x >= 15 && x <= 35 && y >= 15 && y <= 35
        if (!inHole) comp[y * w + x] = 1
      }
    }
    const rayRow = 25
    const fromRay = traceMooreOuterContour(comp, w, h, {
      startSearch: 'horizontalRayLeft',
      rayRowPx: rayRow,
    })
    expect(fromRay).not.toBeNull()
    expect(fromRay![0]).toEqual({ x: 5, y: rayRow })
    const a = fromRay![0]!
    const b = fromRay![fromRay!.length - 1]!
    expect(a.x).toBe(b.x)
    expect(a.y).toBe(b.y)
  })

  it('horizontalRayLeft returns null when the scan row has no foreground', () => {
    const w = 40
    const h = 40
    const comp = new Uint8Array(w * h)
    comp[5 * w + 20] = 1
    expect(traceMooreOuterContour(comp, w, h, { startSearch: 'horizontalRayLeft', rayRowPx: 10 })).toBeNull()
  })

  it('clampBinaryMaskBelowBaseline removes substrate below surface line', () => {
    const w = 100
    const h = 100
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const upper = x >= 25 && x <= 74 && y >= 15 && y <= 44
        const lower = x >= 25 && x <= 74 && y >= 60 && y <= 92
        const g = upper || lower ? 250 : 15
        const i = (y * w + x) * 4
        data[i] = g
        data[i + 1] = g
        data[i + 2] = g
        data[i + 3] = 255
      }
    }
    const merged = { width: w, height: h, data, colorSpace: 'srgb' } as ImageData
    const mask = imageDataToDropletMask(merged, 128, true)
    clampBinaryMaskBelowBaseline(mask, 100, 100, 52)
    let lowerFg = 0
    for (let y = 53; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        if (mask[y * 100 + x]) lowerFg++
      }
    }
    expect(lowerFg).toBe(0)
    const comp = floodFillForegroundMask(mask, 100, 100, 50, 30)
    let cnt = 0
    for (let i = 0; i < comp.length; i++) if (comp[i]) cnt++
    expect(cnt).toBeGreaterThan(400)
    expect(cnt).toBeLessThan(3500)
  })

  it('buildForegroundMaskForContour: suppress after morph so circular erase is not filled back', () => {
    const w = 48
    const h = 48
    const img = solidRectImageData(w, h, 8, 8, 39, 39, 250, 12)
    const cx = 24
    const cy = 24
    const mask = buildForegroundMaskForContour({
      imageData: img,
      threshold: 128,
      dropletIsBright: true,
      surfaceYPx: 44,
      segmentationMode: 'luminance',
      backgroundGray: null,
      diffThreshold: 14,
      morphCloseIterations: 4,
      manualSuppressCircles: [{ x: cx, y: cy, rPx: 10 }],
    })
    expect(mask[cy * w + cx]).toBe(0)
  })

  it('syntheticBackgroundGrayFromFrame flattens interior of detected blob', () => {
    const w = 80
    const h = 80
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = (x - 40) ** 2 + (y - 35) ** 2 < 22 ** 2
        const g = inside ? 230 : 25
        const i = (y * w + x) * 4
        data[i] = g
        data[i + 1] = g
        data[i + 2] = g
        data[i + 3] = 255
      }
    }
    const img = { width: w, height: h, data, colorSpace: 'srgb' } as ImageData
    const bg = syntheticBackgroundGrayFromFrame(img, 128, true, 75, 40, 35)
    expect(bg).not.toBeNull()
    const insideIdx = 40 + 35 * w
    expect(bg![insideIdx]).toBeLessThan(80)
    const corner = 5 * w + 5
    expect(bg![corner]).toBeLessThan(80)
    expect(Math.abs(bg![insideIdx]! - bg![corner]!)).toBeLessThan(15)
  })

  it('extractDropletOuterContourPx end-to-end', () => {
    const img = solidRectImageData(96, 96, 24, 24, 71, 71, 240, 20)
    const c = extractDropletOuterContourPx({
      imageData: img,
      threshold: 128,
      dropletIsBright: true,
      surfaceYPx: 85,
      seedXPx: 48,
      seedYPx: 48,
      maxContourPoints: 500,
    })
    expect(c).not.toBeNull()
    expect(c!.length).toBeGreaterThan(10)
    expect(c![0]).toEqual(c![c!.length - 1])
  })
})
