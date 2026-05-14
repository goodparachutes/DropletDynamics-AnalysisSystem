/** 一元线性最小二乘 y ≈ a + b x */
export type LinearLeastSquaresFit = {
  /** dy/dx */
  slope: number
  intercept: number
  /** 决定系数；y 无变异时为 1 */
  r2: number
  n: number
}

/**
 * @returns null 若有效点少于 2，或 x 无方差（无法定斜率）
 */
export function linearLeastSquaresXY(xs: number[], ys: number[]): LinearLeastSquaresFit | null {
  const px: number[] = []
  const py: number[] = []
  const nIn = Math.min(xs.length, ys.length)
  for (let i = 0; i < nIn; i++) {
    const x = xs[i]!
    const y = ys[i]!
    if (Number.isFinite(x) && Number.isFinite(y)) {
      px.push(x)
      py.push(y)
    }
  }
  const n = px.length
  if (n < 2) return null

  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += px[i]!
    my += py[i]!
  }
  mx /= n
  my /= n

  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const dx = px[i]! - mx
    const dy = py[i]! - my
    sxx += dx * dx
    sxy += dx * dy
  }

  if (sxx < 1e-18) return null

  const slope = sxy / sxx
  const intercept = my - slope * mx

  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const y = py[i]!
    const pred = intercept + slope * px[i]!
    const d = y - my
    ssTot += d * d
    const e = y - pred
    ssRes += e * e
  }
  const r2 = ssTot < 1e-18 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot))

  return { slope, intercept, r2, n }
}
