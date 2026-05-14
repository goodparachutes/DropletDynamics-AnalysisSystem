import type { AnalysisPoint, CalibrationPoint } from '../../types/analysis'
import { createPchipSplineModel } from './spline'
import { buildSpreadSplineDrawPoints } from './spreadSplinePoints'

/**
 * ## 动态接触角（侧视视频）在本程序中的算法
 *
 * **定义**：Young 接触角 θ — 在液相一侧，固–液界面与气–液界面两切线的夹角（0°–180°）。侧视图中固面取为水平基准线 `surfaceY`。
 *
 * **方法 A — 直线回归（默认）**
 * 1. 取轮廓点集 `ptsL` 或 `ptsR`，仅保留纵坐标在 `(surfaceY - maxDepthPx, surfaceY + 0.5]` 内的点（`maxDepthPx` 可由 UI「拟合精度」映射）。
 * 2. 若给出 **`subL`+`subR`**（`linearFeet`）：再剔除在图像 x 上 **离对侧触点更近** 的点（避免合并/跟踪错误把右翼点混进 `ptsL` 却被当成左翼回归）。
 * 3. 在带内按 **y 从大到小** 只保留至多 **`nearBaselineMaxPoints`** 个点（默认 4；精度滑块调高则用上更多行）。
 * 4. **最小二乘** 拟合 **x = p + q·y**，**q = dx/dy**（典型液滴：左翼 **q < 0**，右翼 **q > 0**）。**左侧** θ = 90° + atan(q)，**右侧** θ = 90° − atan(q)。
 *
 * **方法 B — 铺展青样条切线（`method: 'spreadSpline'`）**
 * - 结点由 `buildSpreadSplineDrawPoints` 在竖直带内取 **全部轮廓边点**（与检测到的白轮廓同源），锚定触点；可选对脚距离过滤（与直线法一致）。
 * - 对 **x(y)** 保形三次（PCHIP / Fritsch–Carlson，单调轮廓段；异常时退回自然三次）求 **dx/dy|_{y=surfaceY}**，与直线法同属 **q = dx/dy**，θ 公式相同。
 *
 * **画图上的小白点**：直线法为参与回归的 `band`；样条法为样条结点（含触点）。
 */

/** 默认只在基准线上方约此深度（px）内做点回归；直线法专用 */
export const DEFAULT_CONTACT_ANGLE_MAX_DEPTH_PX = 22

/** 直线回归：距基准线最近参与点数默认 */
export const DEFAULT_NEAR_BASELINE_MAX_POINTS = 4

/** UI 拟合精度 0–100 → 直线回归竖直带深度（px），约 14–56 */
export function linearRegressionDepthPxFromFitPrecision(fitPrecision: number): number {
  const p = Math.max(0, Math.min(100, fitPrecision))
  return Math.round(14 + (p / 100) * 42)
}

/** UI 拟合精度 → 直线回归参与点数上限（≥3），约 4–15 */
export function linearRegressionMaxPointsFromFitPrecision(fitPrecision: number): number {
  const p = Math.max(0, Math.min(100, fitPrecision))
  return Math.max(3, Math.round(4 + (p / 100) * 11))
}

export type ContactAngleMethod = 'linearRegression' | 'spreadSpline'

export type ContactAngleFitOpts = {
  minPoints?: number
  maxDepthPx?: number
  /** 直线回归：参与点数上限 */
  nearBaselineMaxPoints?: number
  /** 默认 `linearRegression` */
  method?: ContactAngleMethod
  /** 图像「拟合精度」0–100：青样条竖直带深度；直线法则由此推导 `maxDepthPx` / `nearBaselineMaxPoints`（见导出映射函数） */
  fitPrecision?: number
}

/** 若数据点带有 `contactAngleFitPrecision`，则覆盖全局 `fitPrecision` 并同步直线回归深度与点数上限 */
export function mergeContactAngleFitOptsForPoint(
  point: AnalysisPoint,
  base?: ContactAngleFitOpts,
): ContactAngleFitOpts | undefined {
  const o = point.contactAngleFitPrecision
  if (o == null || !Number.isFinite(o)) return base
  const p = Math.max(0, Math.min(100, o))
  return {
    ...base,
    fitPrecision: p,
    maxDepthPx: linearRegressionDepthPxFromFitPrecision(p),
    nearBaselineMaxPoints: linearRegressionMaxPointsFromFitPrecision(p),
  }
}

export type BandRegression = {
  dxDy: number
  p: number
  band: CalibrationPoint[]
}

/** 直线回归：只保留离「本侧触点」更近的点（selfX=left 用 subL，right 用 subR） */
export type LinearRegressionFeet = { selfX: number; otherX: number }

function computeBandRegression(
  pts: CalibrationPoint[],
  surfaceY: number,
  opts?: ContactAngleFitOpts,
  linearFeet?: LinearRegressionFeet,
): BandRegression | null {
  const minPoints = opts?.minPoints ?? 3
  const maxDepth = opts?.maxDepthPx ?? DEFAULT_CONTACT_ANGLE_MAX_DEPTH_PX

  const yHi = surfaceY + 0.5
  const yLo = Math.max(0, surfaceY - maxDepth)
  let inBand = pts.filter((p) => p.y <= yHi && p.y >= yLo)

  if (
    linearFeet &&
    Number.isFinite(linearFeet.selfX) &&
    Number.isFinite(linearFeet.otherX) &&
    Math.abs(linearFeet.otherX - linearFeet.selfX) > 2
  ) {
    const { selfX, otherX } = linearFeet
    inBand = inBand.filter((p) => {
      const dSelf = Math.abs(p.x - selfX)
      const dOther = Math.abs(p.x - otherX)
      return dSelf <= dOther + 1e-4
    })
  }

  if (inBand.length < minPoints) return null

  const maxNear = opts?.nearBaselineMaxPoints ?? DEFAULT_NEAR_BASELINE_MAX_POINTS
  const cap = Math.max(minPoints, Math.min(maxNear, inBand.length))
  const band = [...inBand].sort((a, b) => b.y - a.y).slice(0, cap)

  let sumY = 0
  let sumX = 0
  let sumYY = 0
  let sumYX = 0
  const n = band.length
  for (const p of band) {
    sumY += p.y
    sumX += p.x
    sumYY += p.y * p.y
    sumYX += p.y * p.x
  }
  const den = n * sumYY - sumY * sumY
  if (Math.abs(den) < 1e-9) return null

  const dxDy = (n * sumYX - sumY * sumX) / den
  const p = (sumX - dxDy * sumY) / n

  return { dxDy, p, band }
}

function clampAngleDeg(deg: number): number {
  return Math.max(8, Math.min(172, deg))
}

function geometryFromDxDy(
  dxDy: number,
  p: number,
  band: CalibrationPoint[],
  side: 'left' | 'right',
): ContactAngleFitGeometry | null {
  const thetaRad =
    side === 'left' ? Math.PI / 2 + Math.atan(dxDy) : Math.PI / 2 - Math.atan(dxDy)
  let angleDeg = (180 / Math.PI) * thetaRad

  if (!Number.isFinite(angleDeg)) return null
  angleDeg = clampAngleDeg(angleDeg)

  const solidIntoLiquid = side === 'left' ? { x: 1, y: 0 } : { x: -1, y: 0 }

  const vx = -dxDy
  const vy = -1
  const len = Math.hypot(vx, vy)
  if (len < 1e-9) return null
  const interfaceIntoLiquid = { x: vx / len, y: vy / len }

  return {
    dxDy,
    p,
    band,
    angleDeg,
    solidIntoLiquid,
    interfaceIntoLiquid,
  }
}

/** 用于画布叠加：回归带、拟合直线斜率、固面/界面指向液相的方向及 θ（°） */
export type ContactAngleFitGeometry = BandRegression & {
  angleDeg: number
  solidIntoLiquid: { x: number; y: number }
  interfaceIntoLiquid: { x: number; y: number }
}

export function getContactAngleFitGeometry(
  pts: CalibrationPoint[],
  surfaceY: number,
  side: 'left' | 'right',
  opts?: ContactAngleFitOpts,
  /** 样条法必填：触点 subL / subR；直线法若同时给 `otherContactFootX` 则启用左右脚距离过滤 */
  contactFootX?: number,
  otherContactFootX?: number,
): ContactAngleFitGeometry | null {
  const method = opts?.method ?? 'linearRegression'

  if (method === 'spreadSpline') {
    if (contactFootX === undefined) return null
    const drawPts = buildSpreadSplineDrawPoints(
      pts,
      surfaceY,
      contactFootX,
      side === 'left',
      opts?.fitPrecision ?? 70,
      otherContactFootX,
    )
    if (!drawPts || drawPts.length < 2) return null

    const model = createPchipSplineModel(
      drawPts.map((p) => p.y),
      drawPts.map((p) => p.x),
    )
    const dxDy = model.dxDyAt(surfaceY)
    if (!Number.isFinite(dxDy)) return null
    const p = contactFootX - dxDy * surfaceY
    return geometryFromDxDy(dxDy, p, drawPts, side)
  }

  const linearFeet =
    contactFootX !== undefined && otherContactFootX !== undefined
      ? { selfX: contactFootX, otherX: otherContactFootX }
      : undefined
  const reg = computeBandRegression(pts, surfaceY, opts, linearFeet)
  if (!reg) return null
  return geometryFromDxDy(reg.dxDy, reg.p, reg.band, side)
}

function estimateDegFromDxDy(dxDy: number, side: 'left' | 'right'): number | null {
  const thetaRad =
    side === 'left' ? Math.PI / 2 + Math.atan(dxDy) : Math.PI / 2 - Math.atan(dxDy)
  let deg = (180 / Math.PI) * thetaRad
  if (!Number.isFinite(deg)) return null
  deg = clampAngleDeg(deg)
  return +deg.toFixed(2)
}

export function estimateContactAngleDeg(
  pts: CalibrationPoint[],
  surfaceY: number,
  side: 'left' | 'right',
  opts?: ContactAngleFitOpts,
  /** 直线法：本侧触点 subL 或 subR；样条法：必填 */
  contactFootX?: number,
  /** 直线法：对侧触点，用于剔除离对侧更近的误点 */
  otherContactFootX?: number,
): number | null {
  const method = opts?.method ?? 'linearRegression'

  if (method === 'spreadSpline') {
    if (contactFootX === undefined) return null
    const drawPts = buildSpreadSplineDrawPoints(
      pts,
      surfaceY,
      contactFootX,
      side === 'left',
      opts?.fitPrecision ?? 70,
      otherContactFootX,
    )
    if (!drawPts || drawPts.length < 2) return null
    const model = createPchipSplineModel(
      drawPts.map((p) => p.y),
      drawPts.map((p) => p.x),
    )
    const dxDy = model.dxDyAt(surfaceY)
    if (!Number.isFinite(dxDy)) return null
    return estimateDegFromDxDy(dxDy, side)
  }

  const linearFeet =
    contactFootX !== undefined && otherContactFootX !== undefined
      ? { selfX: contactFootX, otherX: otherContactFootX }
      : undefined
  const reg = computeBandRegression(pts, surfaceY, opts, linearFeet)
  if (!reg) return null
  return estimateDegFromDxDy(reg.dxDy, side)
}

function stripContactAngles(point: AnalysisPoint): AnalysisPoint {
  const {
    contactAngleLeftDeg: _l,
    contactAngleRightDeg: _r,
    contactAngleAvgDeg: _a,
    ...rest
  } = point
  return rest
}

/** 在已有铺展采样点上附加左右接触角（°）；无轮廓点时去掉已有角度字段 */
export function enrichAnalysisPointContactAngles(
  point: AnalysisPoint,
  surfaceY: number,
  opts?: ContactAngleFitOpts,
): AnalysisPoint {
  if (point.beta === 0 && point.absDiameter === 0) {
    return stripContactAngles(point)
  }

  if (!point.ptsL || !point.ptsR || point.subL === undefined || point.subR === undefined) {
    return stripContactAngles(point)
  }

  const mergedOpts = mergeContactAngleFitOptsForPoint(point, opts)

  const contactAngleLeftDeg = estimateContactAngleDeg(
    point.ptsL,
    surfaceY,
    'left',
    mergedOpts,
    point.subL,
    point.subR,
  )
  const contactAngleRightDeg = estimateContactAngleDeg(
    point.ptsR,
    surfaceY,
    'right',
    mergedOpts,
    point.subR,
    point.subL,
  )

  const next: AnalysisPoint = { ...point }
  if (contactAngleLeftDeg !== null) next.contactAngleLeftDeg = contactAngleLeftDeg
  else delete next.contactAngleLeftDeg
  if (contactAngleRightDeg !== null) next.contactAngleRightDeg = contactAngleRightDeg
  else delete next.contactAngleRightDeg

  if (
    next.contactAngleLeftDeg !== undefined &&
    next.contactAngleRightDeg !== undefined &&
    Number.isFinite(next.contactAngleLeftDeg) &&
    Number.isFinite(next.contactAngleRightDeg)
  ) {
    next.contactAngleAvgDeg = +(
      (next.contactAngleLeftDeg + next.contactAngleRightDeg) /
      2
    ).toFixed(2)
  } else {
    delete next.contactAngleAvgDeg
  }
  return next
}
