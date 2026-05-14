import { describe, expect, it } from 'vitest'
import {
  estimateDropletDiskAboveSurface,
  findBaselineInReflectionGap,
  foregroundRowBoundingSpan,
} from './dropletSilhouette'

describe('findBaselineInReflectionGap', () => {
  it('puts baseline mid-gap between droplet band and reflection band', () => {
    const scanLimit = 120
    const colHist = new Int32Array(200)
    for (let y = 40; y <= 62; y++) colHist[y] = 180
    for (let y = 63; y <= 66; y++) colHist[y] = 0
    for (let y = 67; y <= 88; y++) colHist[y] = 150

    const bulk = { centerY: 50, maxW: 180 }
    const y = findBaselineInReflectionGap(colHist, scanLimit, bulk)
    expect(y).toBe(Math.floor((62 + 67) / 2))
  })
})

describe('foregroundRowBoundingSpan', () => {
  it('merges disjoint dark runs into one chord width', () => {
    const width = 120
    const height = 10
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    }
    const y = 3
    const rowOff = y * width * 4
    const paint = (x0: number, x1: number) => {
      for (let x = x0; x <= x1; x++) {
        const idx = rowOff + x * 4
        data[idx] = 0
        data[idx + 1] = 0
        data[idx + 2] = 0
      }
    }
    paint(25, 38)
    paint(52, 78)

    const span = foregroundRowBoundingSpan(data, width, y, 10, 110, 128, false)
    expect(span).not.toBeNull()
    expect(span!.width).toBe(78 - 25 + 1)
    expect(span!.left).toBe(25)
    expect(span!.right).toBe(78)
  })
})

describe('estimateDropletDiskAboveSurface', () => {
  it('weights vertical centroid toward geometric middle when chords vary', () => {
    const width = 200
    const colHist = new Int32Array(120)
    const cxAtRow = new Float32Array(120)
    const topY = 30
    const surfaceY = 95
    for (let y = topY; y < 70; y++) {
      const chord = Math.round(40 + (y - topY) * 1.1)
      colHist[y] = chord
      cxAtRow[y] = 100
    }
    for (let y = 70; y < 85; y++) {
      colHist[y] = Math.round(84 - (y - 70) * 4)
      cxAtRow[y] = 100
    }

    const disk = estimateDropletDiskAboveSurface(colHist, cxAtRow, topY, surfaceY, width)
    expect(disk).not.toBeNull()
    expect(disk!.cy).toBeGreaterThan(52)
    expect(disk!.cy).toBeLessThan(72)
  })

  it('drops near-full-width outlier chords from horizontal band artifacts', () => {
    const width = 400
    const colHist = new Int32Array(100)
    const cxAtRow = new Float32Array(100)
    const topY = 20
    const surfaceY = 92
    for (let y = topY; y < 75; y++) {
      colHist[y] = 88
      cxAtRow[y] = 200
    }
    colHist[48] = 378

    const disk = estimateDropletDiskAboveSurface(colHist, cxAtRow, topY, surfaceY, width)
    expect(disk).not.toBeNull()
    expect(disk!.dPx).toBeLessThan(130)
    expect(disk!.dPx).toBeGreaterThan(70)
  })
})
