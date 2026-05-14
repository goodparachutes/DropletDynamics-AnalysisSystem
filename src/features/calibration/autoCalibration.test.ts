import { describe, expect, it } from 'vitest'
import { runAutoCalibration } from './autoCalibration'

/** Node 下 vitest 无 DOM ImageData；analysisRegion 裁剪路径依赖构造函数 */
function ensureImageDataCtor(): void {
  if (typeof globalThis.ImageData !== 'undefined') return
  globalThis.ImageData = class ImageDataPolyfill {
    data: Uint8ClampedArray
    width: number
    height: number
    colorSpace = 'srgb' as PredefinedColorSpace
    constructor(sw: number, sh: number)
    constructor(data: Uint8ClampedArray, sw: number, sh?: number)
    constructor(
      dataOrW: Uint8ClampedArray | number,
      sw?: number,
      sh?: number,
    ) {
      if (typeof dataOrW === 'number' && sw != null) {
        this.width = dataOrW
        this.height = sw
        this.data = new Uint8ClampedArray(dataOrW * sw * 4)
      } else if (dataOrW instanceof Uint8ClampedArray && sw != null && sh != null) {
        this.data = dataOrW
        this.width = sw
        this.height = sh
      } else {
        throw new TypeError('ImageDataPolyfill')
      }
    }
  } as unknown as typeof ImageData
}

function buildMockImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  for (let y = 20; y < 70; y++) {
    for (let x = 40; x < 100; x++) {
      const idx = (y * width + x) * 4
      data[idx] = 0
      data[idx + 1] = 0
      data[idx + 2] = 0
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

describe('runAutoCalibration', () => {
  it('returns center, radius and scale for clear silhouette', () => {
    const imageData = buildMockImageData(140, 100)
    const result = runAutoCalibration({ imageData, threshold: 128, actualD0: 2 })
    expect(result).not.toBeNull()
    expect(result?.pixelScale).toBeGreaterThan(10)
    expect(result?.result.radius).toBeGreaterThan(10)
  })

  it('maps ROI-cropped fit back to full canvas coordinates', () => {
    ensureImageDataCtor()
    const imageData = buildMockImageData(140, 100)
    const r = { x: 30, y: 10, w: 100, h: 85 }
    const roi = runAutoCalibration({
      imageData,
      threshold: 128,
      actualD0: 2,
      analysisRegion: r,
    })
    expect(roi).not.toBeNull()
    expect(roi!.pixelScale).toBeGreaterThan(10)
    expect(roi!.surfaceY).toBeGreaterThanOrEqual(r.y)
    expect(roi!.surfaceY).toBeLessThanOrEqual(r.y + r.h - 1)
    expect(roi!.result.dropletX).toBeGreaterThanOrEqual(r.x)
    expect(roi!.result.dropletX).toBeLessThanOrEqual(r.x + r.w - 1)
    expect(roi!.result.dropletY).toBeGreaterThanOrEqual(r.y)
    expect(roi!.result.dropletY).toBeLessThanOrEqual(r.y + r.h - 1)
  })
})
