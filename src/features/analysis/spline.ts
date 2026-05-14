/** x 为自变量 y 的插值模型：铺展青线与接触角切线（dx/dy） */
export type CubicSplineYXModel = {
  xAt: (targetY: number) => number
  /** dx/dy 在 targetY 处（含端点外延段的斜率） */
  dxDyAt: (targetY: number) => number
}

/** Hermite：x(y)=x0+m0·s + a·s² + b·s³，s=y−y0，h=y1−y0，delta=(x1−x0)/h */
function evalHermiteYX(
  y: number,
  y0: number,
  h: number,
  x0: number,
  x1: number,
  m0: number,
  m1: number,
): { x: number; dxDy: number } {
  const hh = Math.abs(h) < 1e-14 ? 1e-14 : h
  const s = y - y0
  const delta = (x1 - x0) / hh
  const a = (3 * delta - 2 * m0 - m1) / hh
  const b = (m0 + m1 - 2 * delta) / (hh * hh)
  const x = x0 + m0 * s + a * s * s + b * s * s * s
  const dxDy = m0 + 2 * a * s + 3 * b * s * s
  return { x, dxDy }
}

function deltasMonotoneSameSign(delta: number[]): boolean {
  let sign = 0
  for (const d of delta) {
    if (Math.abs(d) < 1e-14) continue
    const s = d > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Fritsch–Carlson PCHIP：分段三次 Hermite，保形、抑制自然样条多点振荡。
 * 相邻段 x 变化方向不一致时退回 `createCubicSplineModel`（单侧轮廓极少触发）。
 */
export function createPchipSplineModel(yArr: number[], xArr: number[]): CubicSplineYXModel {
  const n = yArr.length
  if (n < 2) {
    const x0 = xArr[0] ?? 0
    return {
      xAt: () => x0,
      dxDyAt: () => 0,
    }
  }
  if (n === 2) {
    const dy0 = yArr[1] - yArr[0]
    const slope = Math.abs(dy0) < 1e-14 ? 0 : (xArr[1] - xArr[0]) / dy0
    return {
      xAt: (targetY) => xArr[0] + slope * (targetY - yArr[0]),
      dxDyAt: () => slope,
    }
  }

  const h: number[] = []
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const hi = yArr[i + 1] - yArr[i]
    const hh = Math.abs(hi) < 1e-14 ? 1e-14 : hi
    h.push(hh)
    delta.push((xArr[i + 1] - xArr[i]) / hh)
  }

  if (!deltasMonotoneSameSign(delta)) {
    return createCubicSplineModel(yArr, xArr)
  }

  const m: number[] = new Array(n)
  m[0] = delta[0]
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) m[i] = 0
    else m[i] = (h[i - 1] + h[i]) / (h[i - 1] / delta[i - 1] + h[i] / delta[i])
  }
  m[n - 1] = delta[n - 2]

  const lastI = n - 2
  const lastY0 = yArr[lastI]
  const lastH = h[lastI]
  const lastX0 = xArr[lastI]
  const lastX1 = xArr[lastI + 1]
  const lastM0 = m[lastI]
  const lastM1 = m[lastI + 1]
  const lastDelta = (lastX1 - lastX0) / lastH
  const lastA = (3 * lastDelta - 2 * lastM0 - lastM1) / lastH
  const lastB = (lastM0 + lastM1 - 2 * lastDelta) / (lastH * lastH)

  const dxDyAt = (targetY: number): number => {
    if (targetY <= yArr[0]) {
      return evalHermiteYX(targetY, yArr[0], h[0], xArr[0], xArr[1], m[0], m[1]).dxDy
    }
    if (targetY >= yArr[n - 1]) {
      const s = targetY - lastY0
      return lastM0 + 2 * lastA * s + 3 * lastB * s * s
    }
    let i = 0
    while (i < n - 2 && targetY > yArr[i + 1]) i++
    return evalHermiteYX(targetY, yArr[i], h[i], xArr[i], xArr[i + 1], m[i], m[i + 1]).dxDy
  }

  const xAt = (targetY: number): number => {
    if (targetY <= yArr[0]) {
      return evalHermiteYX(targetY, yArr[0], h[0], xArr[0], xArr[1], m[0], m[1]).x
    }
    if (targetY >= yArr[n - 1]) {
      const s = targetY - lastY0
      return lastX0 + lastM0 * s + lastA * s * s + lastB * s * s * s
    }
    let i = 0
    while (i < n - 2 && targetY > yArr[i + 1]) i++
    return evalHermiteYX(targetY, yArr[i], h[i], xArr[i], xArr[i + 1], m[i], m[i + 1]).x
  }

  return { xAt, dxDyAt }
}

export function createPchipSpline(yArr: number[], xArr: number[]): (targetY: number) => number {
  const model = createPchipSplineModel(yArr, xArr)
  return (y) => model.xAt(y)
}

/** 自然边界三次样条：结点较多时端部易振荡；铺展/θ 青样条优先用 PCHIP */
export function createCubicSplineModel(yArr: number[], xArr: number[]): CubicSplineYXModel {
  const n = yArr.length
  if (n < 2) {
    const x0 = xArr[0] ?? 0
    return {
      xAt: () => x0,
      dxDyAt: () => 0,
    }
  }
  if (n === 2) {
    const dy0 = yArr[1] - yArr[0]
    const slope = dy0 === 0 ? 0 : (xArr[1] - xArr[0]) / dy0
    return {
      xAt: (targetY) => xArr[0] + slope * (targetY - yArr[0]),
      dxDyAt: () => slope,
    }
  }

  const a = [...xArr]
  const h: number[] = []
  const alpha: number[] = [0]
  for (let i = 0; i < n - 1; i++) h.push(yArr[i + 1] - yArr[i])
  for (let i = 1; i < n - 1; i++) {
    const left = h[i - 1] === 0 ? 1e-8 : h[i - 1]
    const right = h[i] === 0 ? 1e-8 : h[i]
    alpha.push((3 / right) * (a[i + 1] - a[i]) - (3 / left) * (a[i] - a[i - 1]))
  }

  const c = new Array(n).fill(0)
  const l = new Array(n).fill(1)
  const mu = new Array(n).fill(0)
  const z = new Array(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (yArr[i + 1] - yArr[i - 1]) - h[i - 1] * mu[i - 1]
    if (Math.abs(l[i]) < 1e-8) l[i] = 1e-8
    mu[i] = h[i] / l[i]
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i]
  }

  const b = new Array(n).fill(0)
  const d = new Array(n).fill(0)
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1]
    const hj = h[j] === 0 ? 1e-8 : h[j]
    b[j] = (a[j + 1] - a[j]) / hj - (hj * (c[j + 1] + 2 * c[j])) / 3
    d[j] = (c[j + 1] - c[j]) / (3 * hj)
  }

  const lastSegmentDy = yArr[n - 1] - yArr[n - 2]
  const lastDeriv =
    b[n - 2] + 2 * c[n - 2] * lastSegmentDy + 3 * d[n - 2] * lastSegmentDy * lastSegmentDy

  const dxDyAt = (targetY: number): number => {
    if (targetY <= yArr[0]) return b[0]
    if (targetY >= yArr[n - 1]) return lastDeriv
    let i = 0
    while (i < n - 2 && targetY > yArr[i + 1]) i++
    const dy = targetY - yArr[i]
    return b[i] + 2 * c[i] * dy + 3 * d[i] * dy * dy
  }

  const xAt = (targetY: number): number => {
    if (targetY <= yArr[0]) return a[0] + b[0] * (targetY - yArr[0])
    if (targetY >= yArr[n - 1]) {
      const dy = targetY - yArr[n - 1]
      return a[n - 1] + lastDeriv * dy
    }
    let i = 0
    while (i < n - 2 && targetY > yArr[i + 1]) i++
    const dy = targetY - yArr[i]
    return a[i] + b[i] * dy + c[i] * dy * dy + d[i] * dy * dy * dy
  }

  return { xAt, dxDyAt }
}

export function createCubicSpline(yArr: number[], xArr: number[]): (targetY: number) => number {
  const m = createCubicSplineModel(yArr, xArr)
  return (y) => m.xAt(y)
}
