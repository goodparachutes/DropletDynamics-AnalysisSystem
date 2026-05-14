import type { CalibrationPoint } from '../../types/analysis'
import type { CavityPipelineDebug } from '../../types/cavityDynamics'

/** 闭合多边形鞋带面积（像素²），顶点按边界顺序，首尾已由调用方视为闭合 */
export function polygonShoelaceAreaPx(pts: ReadonlyArray<CalibrationPoint>): number {
  const n = pts.length
  if (n < 3) return 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y
  }
  return Math.abs(s) / 2
}

/** 多边形形心（像素），A_px 为鞋带面积 */
export function polygonCentroidPx(
  pts: ReadonlyArray<CalibrationPoint>,
  areaPx: number,
): { x: number; y: number } | null {
  if (areaPx < 1e-12 || pts.length < 3) return null
  let cx = 0
  let cy = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const xi = pts[i]!.x
    const yi = pts[i]!.y
    const xj = pts[j]!.x
    const yj = pts[j]!.y
    const cross = xi * yj - xj * yi
    cx += (xi + xj) * cross
    cy += (yi + yj) * cross
  }
  const inv = 1 / (6 * areaPx)
  return { x: cx * inv, y: cy * inv }
}

/** 高斯消元解 3×3 增广矩阵 */
function solveAugmented3x4(M: number[][]): [number, number, number] | null {
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r
    }
    if (Math.abs(M[pivot]![col]!) < 1e-18) return null
    if (pivot !== col) {
      const tmp = M[col]!
      M[col] = M[pivot]!
      M[pivot] = tmp
    }
    const div = M[col]![col]!
    for (let j = col; j < 4; j++) M[col]![j]! /= div
    for (let r = 0; r < 3; r++) {
      if (r === col) continue
      const f = M[r]![col]!
      for (let j = col; j < 4; j++) M[r]![j]! -= f * M[col]![j]!
    }
  }
  return [M[0]![3]!, M[1]![3]!, M[2]![3]!]
}

/** y ≈ a x² + b x + c，最小二乘 */
export function quadraticLeastSquaresYvsX(
  xs: number[],
  ys: number[],
): { a: number; b: number; c: number } | null {
  const n = xs.length
  if (n < 3) return null
  let s4 = 0
  let s3 = 0
  let s2 = 0
  let s1 = 0
  let s0 = n
  let s2y = 0
  let s1y = 0
  let s0y = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i]!
    const y = ys[i]!
    const x2 = x * x
    const x3 = x2 * x
    const x4 = x3 * x
    s4 += x4
    s3 += x3
    s2 += x2
    s1 += x
    s2y += x2 * y
    s1y += x * y
    s0y += y
  }
  const M = [
    [s4, s3, s2, s2y],
    [s3, s2, s1, s1y],
    [s2, s1, s0, s0y],
  ]
  const sol = solveAugmented3x4(M.map((row) => [...row]))
  if (!sol) return null
  return { a: sol[0]!, b: sol[1]!, c: sol[2]! }
}

/**
 * 在稀疏多边形上估计「凹底」处曲率：取 y 最大（图像下方）的顶点，沿环取左右各 2 邻点，
 * 在局部坐标 x̃=x−x_apex 上拟合 y=a x̃²+b x̃+c，用 κ=2|a|/(1+b²)^(3/2)（y 为 x 的函数）。
 */
export function apexCurvatureParabolaKappaPx(pts: ReadonlyArray<CalibrationPoint>): number | null {
  const n = pts.length
  if (n < 3) return null
  let apex = 0
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    if (pts[i]!.y > maxY) {
      maxY = pts[i]!.y
      apex = i
    }
  }
  const idxs: number[] = []
  for (let k = -2; k <= 2; k++) idxs.push((apex + k + n) % n)
  const uniq = [...new Set(idxs)].sort((a, b) => a - b)
  const sample = uniq.map((i) => pts[i]!)
  if (sample.length < 3) return null
  const x0 = pts[apex]!.x
  const xs = sample.map((p) => p.x - x0)
  const ys = sample.map((p) => p.y)
  const fit = quadraticLeastSquaresYvsX(xs, ys)
  if (!fit) return null
  const { a, b } = fit
  const den = (1 + b * b) ** 1.5
  if (den < 1e-15) return null
  return (2 * Math.abs(a)) / den
}

export function polygonBBoxAspectRatio(pts: ReadonlyArray<CalibrationPoint>): number | null {
  if (pts.length < 2) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const w = maxX - minX
  const h = maxY - minY
  if (w < 1e-9 || h < 1e-9) return null
  return h / w
}

export type ManualCavityMetricsPartial = {
  areaMm2: number
  reqMm: number
  xcPx: number
  ycPx: number
  zcMm: number | null
  aspectRatio: number
  kappaApexPerPx: number | null
  kappaApexPerMm: number | null
  pixelArea: number
  touchesRoiBorder: boolean
  failedReason?: undefined
}

/**
 * 由手绘闭合多边形（画布像素坐标）得到与 extractCavityMetricsOneFrame 一致的量纲字段（不含 pipeline）。
 */
/** 由手绘顶点构造与「点击选帧」调试一致的 pipeline（主画布叠加用） */
export function cavityPipelineDebugFromManualVertices(
  verts: ReadonlyArray<CalibrationPoint>,
  largestComponentPixels: number,
): CavityPipelineDebug {
  const pts = verts.map((p) => ({ x: p.x, y: p.y }))
  return {
    otsuThreshold: -1,
    grayMin: -1,
    grayMax: -1,
    claheApplied: false,
    morphCloseIterations: 0,
    morphCloseDiskRadiusPx: 0,
    otsuRelaxEpsilon: 0,
    largestComponentPixels: Math.max(1, Math.round(largestComponentPixels)),
    moorePointCount: verts.length,
    sgWindow: 9,
    rawContourCanvas: pts,
    smoothContourCanvas: pts,
  }
}

export function computeCavityMetricsFromManualPolygon(
  closedPolygon: ReadonlyArray<CalibrationPoint>,
  mmPerPx: number,
  surfaceYPx: number | null,
): ManualCavityMetricsPartial | null {
  if (closedPolygon.length < 3 || !(mmPerPx > 0)) return null
  const areaPx = polygonShoelaceAreaPx(closedPolygon)
  if (areaPx < 1e-9) return null
  const cen = polygonCentroidPx(closedPolygon, areaPx)
  if (!cen) return null
  const areaMm2 = areaPx * mmPerPx * mmPerPx
  const reqMm = Math.sqrt(Math.max(0, areaMm2) / Math.PI)
  const zcMm =
    surfaceYPx != null && Number.isFinite(surfaceYPx)
      ? (surfaceYPx - cen.y) * mmPerPx
      : null
  const ar = polygonBBoxAspectRatio(closedPolygon) ?? 1
  const kapPx = apexCurvatureParabolaKappaPx(closedPolygon)
  const kapMm = kapPx != null && mmPerPx > 0 ? kapPx / mmPerPx : null
  return {
    areaMm2,
    reqMm,
    xcPx: cen.x,
    ycPx: cen.y,
    zcMm,
    aspectRatio: ar,
    kappaApexPerPx: kapPx,
    kappaApexPerMm: kapMm,
    pixelArea: Math.max(1, Math.round(areaPx)),
    touchesRoiBorder: false,
  }
}
