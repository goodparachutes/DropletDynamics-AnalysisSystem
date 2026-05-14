import { describe, expect, it } from 'vitest'
import { applyCircularSuppressToBinaryMask, binaryClosingDisk } from './contourMorphology'

describe('contourMorphology circular suppress', () => {
  it('applyCircularSuppressToBinaryMask clears disk interior', () => {
    const w = 40
    const h = 40
    const mask = new Uint8Array(w * h).fill(1)
    applyCircularSuppressToBinaryMask(mask, w, h, [{ x: 20, y: 20, rPx: 8 }])
    expect(mask[20 * w + 20]).toBe(0)
    expect(mask[5 * w + 5]).toBe(1)
  })
})

describe('binaryClosingDisk', () => {
  it('closes a one-pixel gap in a foreground bar (r=1)', () => {
    const w = 9
    const h = 1
    const m = new Uint8Array(w * h)
    m[0] = m[1] = m[2] = 1
    m[4] = m[5] = m[6] = 1
    const c = binaryClosingDisk(m, w, h, 1)
    expect(c[3]).toBe(1)
  })
})
