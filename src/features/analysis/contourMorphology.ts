/** 二值 mask（0/1）上的 3×3 形态学；闭运算 = 膨胀后腐蚀，可弥合液滴内高光造成的孔洞 */

export function binaryDilate3x3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let dy = -1; dy <= 1 && !v; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && src[ny * w + nx]) {
            v = 1
            break
          }
        }
      }
      out[y * w + x] = v
    }
  }
  return out
}

export function binaryErode3x3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) {
        out[y * w + x] = 0
        continue
      }
      let ok = 1
      for (let dy = -1; dy <= 1 && ok; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || !src[ny * w + nx]) {
            ok = 0
            break
          }
        }
      }
      out[y * w + x] = ok
    }
  }
  return out
}

export function binaryClosing3x3Iterations(src: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  let m = src
  const it = Math.max(0, Math.min(12, Math.round(iterations)))
  for (let i = 0; i < it; i++) {
    m = binaryDilate3x3(m, w, h)
    m = binaryErode3x3(m, w, h)
  }
  return m
}

/** 圆盘结构元素二值膨胀（前景 1）；半径 0 为恒等 */
export function binaryDilateDisk(src: Uint8Array, w: number, h: number, radiusPx: number): Uint8Array {
  const r = Math.max(0, Math.min(24, Math.round(radiusPx)))
  if (r === 0) return new Uint8Array(src)
  const out = new Uint8Array(w * h)
  const r2 = r * r
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let dy = -r; dy <= r && !v; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dy * dy + dx * dx > r2) continue
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && src[ny * w + nx]) {
            v = 1
            break
          }
        }
      }
      out[y * w + x] = v
    }
  }
  return out
}

/** 圆盘结构元素二值腐蚀 */
export function binaryErodeDisk(src: Uint8Array, w: number, h: number, radiusPx: number): Uint8Array {
  const r = Math.max(0, Math.min(24, Math.round(radiusPx)))
  if (r === 0) return new Uint8Array(src)
  const out = new Uint8Array(w * h)
  const r2 = r * r
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) {
        out[y * w + x] = 0
        continue
      }
      let ok = 1
      let anyInBounds = false
      for (let dy = -r; dy <= r && ok; dy++) {
        for (let dx = -r; dx <= r && ok; dx++) {
          if (dy * dy + dx * dx > r2) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          anyInBounds = true
          if (!src[ny * w + nx]) {
            ok = 0
            break
          }
        }
      }
      out[y * w + x] = ok && anyInBounds ? 1 : 0
    }
  }
  return out
}

/** 圆盘闭运算 = 膨胀后腐蚀，弥合尺度与半径相当的孔洞/高光缝 */
export function binaryClosingDisk(src: Uint8Array, w: number, h: number, radiusPx: number): Uint8Array {
  const r = Math.max(0, Math.min(24, Math.round(radiusPx)))
  if (r === 0) return new Uint8Array(src)
  const dil = binaryDilateDisk(src, w, h, r)
  return binaryErodeDisk(dil, w, h, r)
}

/** 圆域内强制为背景 0（掩码橡皮擦） */
export function applyCircularSuppressToBinaryMask(
  mask: Uint8Array,
  width: number,
  height: number,
  circles: ReadonlyArray<{ x: number; y: number; rPx: number }>,
): void {
  for (const c of circles) {
    const r = Math.max(0.5, c.rPx)
    const r2 = r * r
    const x0 = Math.max(0, Math.floor(c.x - r - 1))
    const x1 = Math.min(width - 1, Math.ceil(c.x + r + 1))
    const y0 = Math.max(0, Math.floor(c.y - r - 1))
    const y1 = Math.min(height - 1, Math.ceil(c.y + r + 1))
    for (let y = y0; y <= y1; y++) {
      const row = y * width
      for (let x = x0; x <= x1; x++) {
        const dx = x - c.x
        const dy = y - c.y
        if (dx * dx + dy * dy <= r2) mask[row + x] = 0
      }
    }
  }
}
