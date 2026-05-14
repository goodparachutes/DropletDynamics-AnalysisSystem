import type { AnalysisPoint, CalibrationPoint } from '../../types/analysis'
import savitzkyGolay from 'ml-savitzky-golay'
import {
  computeDissipationSeries,
  type ComputeDissipationSeriesOptions,
} from './surfaceEnergyDissipation'

/** Moore 闭合外轮廓最少点数；低于此不算「本帧提取成功」，与母线几何门槛一致 */
export const MOORE_OUTER_CONTOUR_MIN_POINTS = 12

/** 母线半径 Savitzky–Golay：默认窗口（奇数 ≥5） */
export const MERIDIAN_SG_WINDOW_DEFAULT = 9
/** 局部多项式阶数（须小于 windowSize） */
export const MERIDIAN_SG_POLYNOMIAL_DEFAULT = 3

/** 外轮廓「显示」SG：xy 窗口上限（奇数）；再大易过度抹平细节 */
export const DISPLAY_CONTOUR_SG_WINDOW_CAP = 51
/**
 * 闭合 Moore 显示平滑时，默认在 Surface Y 下方保留原始点的像素带宽（`y ≥ surfaceY − band`）。
 * 过小易受 SG 在触点旁牵拉；过大则近平滑不到下半弧。
 */
export const DISPLAY_BASELINE_PRESERVE_PX_DEFAULT = 10

function normalizeSavitzkyGolayWindow(windowSize: number): number {
  let w = Math.round(windowSize)
  if (w < 5) w = 5
  if (w % 2 === 0) w += 1
  return w
}

/**
 * 对按轮廓拓扑顺序的半子午线 **半径 r** 做 Savitzky–Golay 平滑（derivative=0），**z 不改**，
 * 缓解像素锯齿导致的表面积膨胀（海岸线 / 曼哈顿步长），同时较滑动平均更能保留局部形状。
 */
export function smoothMeridianRadiusSavitzkyGolay(
  meridian: RzPoint[],
  options?: { windowSize?: number; polynomial?: number },
): RzPoint[] {
  const ws = normalizeSavitzkyGolayWindow(options?.windowSize ?? MERIDIAN_SG_WINDOW_DEFAULT)
  let poly = Math.round(options?.polynomial ?? MERIDIAN_SG_POLYNOMIAL_DEFAULT)
  poly = Math.max(1, Math.min(poly, ws - 2))
  if (meridian.length < ws) return meridian

  const r = meridian.map((p) => p.rMm)
  let smoothed: number[]
  try {
    smoothed = savitzkyGolay(r, 1, {
      windowSize: ws,
      polynomial: poly,
      derivative: 0,
      pad: 'post',
      padValue: 'replicate',
    })
  } catch {
    return meridian
  }
  if (smoothed.length !== meridian.length) return meridian

  return meridian.map((p, i) => ({
    rMm: Math.max(0, smoothed[i] as number),
    zMm: p.zMm,
  }))
}

/**
 * 闭合 Moore 外轮廓的 **显示用** 平滑链：沿轮廓索引将 x、y 分别做 Savitzky–Golay（与母线 r 平滑同默认窗口），
 * 采用三倍周期拼接取中段，近似环形边界平滑。`AnalysisPoint.outerContourPx` 仍为原始 Moore，不参与修改。
 * 若给定 `surfaceYPx` 且 `preserveRawNearBaselinePx > 0`（默认在未指定时为 {@link DISPLAY_BASELINE_PRESERVE_PX_DEFAULT}），则在图像坐标下满足
 * `y ≥ surfaceY − band` 的轮廓点保留原始 Moore，仅上方弧段使用 SG，减轻液–固触点带的「基线尾巴」；
 * 若显式传入 `preserveRawNearBaselinePx: 0`，则整条闭合链均参与平滑。
 */
export function smoothClosedOuterContourPxForDisplay(
  contour: CalibrationPoint[],
  options?: {
    windowSize?: number
    polynomial?: number
    surfaceYPx?: number | null
    /** 未指定且给定 surfaceY 时默认 {@link DISPLAY_BASELINE_PRESERVE_PX_DEFAULT}；设为 0 关闭触点带保护、整圈平滑 */
    preserveRawNearBaselinePx?: number
  },
): CalibrationPoint[] {
  const ws = normalizeSavitzkyGolayWindow(options?.windowSize ?? MERIDIAN_SG_WINDOW_DEFAULT)
  let poly = Math.round(options?.polynomial ?? MERIDIAN_SG_POLYNOMIAL_DEFAULT)
  poly = Math.max(1, Math.min(poly, ws - 2))
  if (contour.length < MOORE_OUTER_CONTOUR_MIN_POINTS) return contour

  const nFull = contour.length
  const closed =
    nFull >= 2 &&
    contour[0]!.x === contour[nFull - 1]!.x &&
    contour[0]!.y === contour[nFull - 1]!.y
  const ring = closed ? contour.slice(0, -1) : [...contour]
  const m = ring.length
  if (m < ws) return contour

  const triple = [...ring, ...ring, ...ring]
  const xs = triple.map((p) => p.x)
  const ys = triple.map((p) => p.y)
  let sx: number[]
  let sy: number[]
  try {
    sx = savitzkyGolay(xs, 1, {
      windowSize: ws,
      polynomial: poly,
      derivative: 0,
      pad: 'post',
      padValue: 'replicate',
    }) as number[]
    sy = savitzkyGolay(ys, 1, {
      windowSize: ws,
      polynomial: poly,
      derivative: 0,
      pad: 'post',
      padValue: 'replicate',
    }) as number[]
  } catch {
    return contour
  }
  if (sx.length !== triple.length || sy.length !== triple.length) return contour

  const midStart = m
  const out: CalibrationPoint[] = []
  for (let i = 0; i < m; i++) {
    out.push({ x: sx[midStart + i] as number, y: sy[midStart + i] as number })
  }

  const surf = options?.surfaceYPx
  const bandPx =
    options?.preserveRawNearBaselinePx === undefined
      ? DISPLAY_BASELINE_PRESERVE_PX_DEFAULT
      : options.preserveRawNearBaselinePx
  if (surf != null && Number.isFinite(surf) && bandPx > 0) {
    const yLine = Math.floor(surf)
    for (let i = 0; i < m; i++) {
      if (ring[i]!.y >= yLine - bandPx) {
        out[i] = { x: ring[i]!.x, y: ring[i]!.y }
      }
    }
  }

  if (closed) out.push({ ...out[0]! })
  return out
}

/** 闭合轮廓环长度（闭合链去掉首尾重复点后的点数） */
export function contourRingPixelLength(contour: CalibrationPoint[]): number {
  const n = contour.length
  if (n < 2) return n
  const closed =
    contour[0]!.x === contour[n - 1]!.x && contour[0]!.y === contour[n - 1]!.y
  return closed ? n - 1 : n
}

function allowableDisplaySgOddWindows(ringLen: number): number[] {
  if (ringLen < 5) return []
  let top = Math.min(DISPLAY_CONTOUR_SG_WINDOW_CAP, ringLen)
  if (top % 2 === 0) top -= 1
  if (top < 5) return []
  const out: number[] = []
  for (let w = 5; w <= top; w += 2) out.push(w)
  return out
}

/**
 * 平滑百分比 0–100 → 可用 SG 奇数窗口；0 或不满足长度时返回 null。
 * 约 9% 且环足够长时接近 {@link MERIDIAN_SG_WINDOW_DEFAULT}。
 */
export function contourDisplaySmoothPercentToWindow(pct: number, ringLen: number): number | null {
  if (pct <= 0) return null
  const odds = allowableDisplaySgOddWindows(ringLen)
  if (!odds.length) return null
  const idx = Math.round((pct / 100) * (odds.length - 1))
  return odds[Math.max(0, Math.min(odds.length - 1, idx))]!
}

/**
 * 与「外轮廓序列」预览一致的 SG 链；返回 undefined 表示应用原始 `outerContourPx`（含平滑关闭或点数不足）。
 */
export function applyDisplaySmoothToOuterContourPx(
  contour: CalibrationPoint[] | undefined,
  surfaceYPx: number | null | undefined,
  smoothPct: number,
  preserveBaselineBand: boolean,
): CalibrationPoint[] | undefined {
  if (!contour?.length || smoothPct <= 0) return undefined
  const ringLen = contourRingPixelLength(contour)
  const ws = contourDisplaySmoothPercentToWindow(smoothPct, ringLen)
  if (ws == null) return undefined
  const smoothed = smoothClosedOuterContourPxForDisplay(contour, {
    surfaceYPx: surfaceYPx ?? undefined,
    windowSize: ws,
    preserveRawNearBaselinePx: preserveBaselineBand ? undefined : 0,
  })
  return smoothed.length >= MOORE_OUTER_CONTOUR_MIN_POINTS ? smoothed : undefined
}

export type SurfaceEnergySeriesContourDisplayOpts = {
  /** 0：母线与表面能用存储的原始 Moore；与侧栏预览滑块一致 */
  smoothPct: number
  preserveBaselineBand: boolean
}

/** 图表/导出：本帧外轮廓提取是否视为失败（含沿用上一帧轮廓但本帧 Moore 未成功的情况） */
export function mooreContourExtractFailedForPoint(point: AnalysisPoint): boolean {
  if (point.mooreContourExtractOk === true) return false
  if (point.mooreContourExtractOk === false) return true
  const n = point.outerContourPx?.length ?? 0
  return n < MOORE_OUTER_CONTOUR_MIN_POINTS
}

/** 子午面物理坐标：r、z 单位 mm（z 向上，原点在轴–基底交点） */
export type RzPoint = { rMm: number; zMm: number }

const MM2_TO_M2 = 1e-6
const MM_TO_M = 1e-3

function mmPerPx(pixelScalePxPerMm: number): number | null {
  if (!Number.isFinite(pixelScalePxPerMm) || pixelScalePxPerMm <= 0) return null
  return 1 / pixelScalePxPerMm
}

/** 像素轮廓点 → (r,z) mm */
export function calibrationPointsToRzMm(
  pts: CalibrationPoint[],
  surfaceYPx: number,
  subLPx: number,
  subRPx: number,
  pixelScalePxPerMm: number,
): RzPoint[] | null {
  const s = mmPerPx(pixelScalePxPerMm)
  if (s == null) return null
  const uCenter = (subLPx + subRPx) / 2
  const out: RzPoint[] = []
  for (const p of pts) {
    const rMm = Math.abs(p.x - uCenter) * s
    const zMm = (surfaceYPx - p.y) * s
    if (!Number.isFinite(rMm) || !Number.isFinite(zMm)) continue
    out.push({ rMm, zMm })
  }
  return out.length >= 2 ? out : null
}

/** 选较长的单侧轮廓作为子午母线（轴对称近似） */
export function pickMeridianCalibrationPoints(p: AnalysisPoint): CalibrationPoint[] | null {
  const nL = p.ptsL?.length ?? 0
  const nR = p.ptsR?.length ?? 0
  if (nL < 2 && nR < 2) return null
  if (nR >= nL && p.ptsR && p.ptsR.length >= 2) return p.ptsR
  return p.ptsL ?? null
}

/**
 * 由基准线上的接触宽度得到旋转半径 R（mm）；与 absDiameter/2 一致。
 */
export function contactRadiusMm(point: AnalysisPoint, pixelScalePxPerMm: number): number | null {
  const s = mmPerPx(pixelScalePxPerMm)
  if (s == null || point.subL == null || point.subR == null) return null
  const wPx = Math.abs(point.subR - point.subL)
  if (wPx <= 1e-6) return null
  return (wPx / 2) * s
}

/**
 * 自由面母线方向：足底 → 顶（z 渐增），**不**按坐标重排，只按首尾 z 做拓扑翻转，保持与 Moore 链一致。
 */
export function orderFreeMeridianFootToApex(meridian: RzPoint[]): RzPoint[] {
  if (meridian.length < 2) return meridian
  const startZ = meridian[0]!.zMm
  const endZ = meridian[meridian.length - 1]!.zMm
  if (startZ > endZ) {
    return [...meridian].reverse()
  }
  return meridian
}

function dedupeRz(pts: RzPoint[]): RzPoint[] {
  const eps = 1e-7
  const out: RzPoint[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.rMm - p.rMm) < eps && Math.abs(last.zMm - p.zMm) < eps) continue
    out.push(p)
  }
  return out
}

/** 离散曲率 proxy：|Δ²r| 沿母线链顺序的平均，越小越平滑 */
function meridianRoughnessScore(rz: RzPoint[]): number {
  if (rz.length < 4) return Number.POSITIVE_INFINITY
  let s = 0
  for (let i = 2; i < rz.length; i++) {
    const d2 = rz[i]!.rMm - 2 * rz[i - 1]!.rMm + rz[i - 2]!.rMm
    s += Math.abs(d2)
  }
  return s / (rz.length - 2)
}

function contourBaselineWidthPx(
  contour: CalibrationPoint[],
  surfaceYPx: number,
  epsPx: number,
): number | null {
  const strip = contour.filter((p) => Math.abs(p.y - surfaceYPx) <= epsPx)
  if (strip.length < 2) return null
  let xmin = Infinity
  let xmax = -Infinity
  for (const p of strip) {
    if (p.x < xmin) xmin = p.x
    if (p.x > xmax) xmax = p.x
  }
  const w = xmax - xmin
  return w > 1 ? w : null
}

/** 去掉闭合轮廓末尾与首点重复的一点 */
function contourToRing(contour: CalibrationPoint[]): CalibrationPoint[] {
  const n = contour.length
  if (n < 2) return [...contour]
  const a = contour[0]!
  const b = contour[n - 1]!
  if (a.x === b.x && a.y === b.y) return contour.slice(0, -1)
  return [...contour]
}

/**
 * 绝对最高点（图像 y 最小）；并列时取最靠近对称轴的一点。作几何 apex 不可行时的回退。
 */
function apexIndexOnRingHighest(ring: CalibrationPoint[], xCenterPx: number): number {
  let best = 0
  let bestY = ring[0]!.y
  let bestDx = Math.abs(ring[0]!.x - xCenterPx)
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i]!
    const y = p.y
    const dx = Math.abs(p.x - xCenterPx)
    if (y < bestY - 1e-9 || (Math.abs(y - bestY) <= 1e-9 && dx < bestDx)) {
      best = i
      bestY = y
      bestDx = dx
    }
  }
  return best
}

/**
 * 对称轴上的「切分顶点」：在 globalMinY…surfaceY 的**上半**区间（y 低于中位高度）内，
 * 取 |x − x_center| 最小者；多峰/火山口时优先轴上点而非全局最高像素。
 */
function apexIndexOnRing(
  ring: CalibrationPoint[],
  xCenterPx: number,
  surfaceYPx: number,
): number {
  let globalMinY = Infinity
  for (const p of ring) {
    if (p.y < globalMinY) globalMinY = p.y
  }
  const span = surfaceYPx - globalMinY
  if (!(span > 1e-6)) {
    return apexIndexOnRingHighest(ring, xCenterPx)
  }
  const yThreshold = surfaceYPx - span * 0.5

  let apexIndex = -1
  let minDistToCenter = Infinity
  let bestY = Infinity

  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!
    if (p.y >= yThreshold) continue
    const dist = Math.abs(p.x - xCenterPx)
    if (
      dist < minDistToCenter - 1e-9 ||
      (Math.abs(dist - minDistToCenter) <= 1e-9 && p.y < bestY - 1e-9)
    ) {
      minDistToCenter = dist
      apexIndex = i
      bestY = p.y
    }
  }

  if (apexIndex < 0) {
    return apexIndexOnRingHighest(ring, xCenterPx)
  }
  return apexIndex
}

function onMeridianHalfPx(
  p: CalibrationPoint,
  side: 'left' | 'right',
  xCenterPx: number,
  axisGapPx: number,
): boolean {
  return side === 'right' ? p.x > xCenterPx + axisGapPx : p.x < xCenterPx - axisGapPx
}

/** 基准线附近的环上下标（用于锚定左右脚，与 Moore 绕向无关） */
function indicesNearBaselineStrip(
  ring: CalibrationPoint[],
  surfaceYPx: number,
  bandPx: number,
): number[] {
  const out: number[] = []
  const lo = surfaceYPx - bandPx
  const hi = surfaceYPx + bandPx
  for (let i = 0; i < ring.length; i++) {
    const y = ring[i]!.y
    if (y >= lo && y <= hi) out.push(i)
  }
  return out
}

function polylinePixelLengthPx(pts: CalibrationPoint[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
  }
  return s
}

function extractRingArcForward(ring: CalibrationPoint[], startIdx: number, stepsInclusive: number): CalibrationPoint[] {
  const n = ring.length
  const out: CalibrationPoint[] = []
  for (let i = 0; i <= stepsInclusive; i++) out.push(ring[(startIdx + i) % n]!)
  return out
}

function extractRingArcBackward(ring: CalibrationPoint[], startIdx: number, stepsInclusive: number): CalibrationPoint[] {
  const n = ring.length
  const out: CalibrationPoint[] = []
  for (let i = 0; i <= stepsInclusive; i++) out.push(ring[(startIdx - i + n) % n]!)
  return out
}

/**
 * 在闭合环上取 start→end 的较短弧（含端点）：优先更少边数；平局时用像素折线长（削弱「底边采样稀反而索引短」的误判）。
 */
function extractRingArcShortest(ring: CalibrationPoint[], startIdx: number, endIdx: number): CalibrationPoint[] {
  const n = ring.length
  if (n < 2) return []
  const fd = (endIdx - startIdx + n) % n
  const bd = (startIdx - endIdx + n) % n
  if (fd < bd) return extractRingArcForward(ring, startIdx, fd)
  if (bd < fd) return extractRingArcBackward(ring, startIdx, bd)
  const af = extractRingArcForward(ring, startIdx, fd)
  const ab = extractRingArcBackward(ring, startIdx, bd)
  return polylinePixelLengthPx(af) <= polylinePixelLengthPx(ab) ? af : ab
}

/**
 * 顶点 + 基准带内 x 最小/最大点为左右脚，apex→脚取环上最短路径；不依赖 index++ 与物理方向的对应关系。
 */
function meridianArcsApexFeetShortestPath(
  ring: CalibrationPoint[],
  xCenterPx: number,
  surfaceYPx: number,
  epsBaselinePx: number,
): { left: CalibrationPoint[]; right: CalibrationPoint[] } | null {
  const n = ring.length
  if (n < MOORE_OUTER_CONTOUR_MIN_POINTS - 1) return null

  const apexIdx = apexIndexOnRing(ring, xCenterPx, surfaceYPx)
  const bandPx = Math.max(epsBaselinePx, 4)

  let baseIdx = indicesNearBaselineStrip(ring, surfaceYPx, bandPx)
  if (baseIdx.length < 2) baseIdx = indicesNearBaselineStrip(ring, surfaceYPx, bandPx * 2 + 8)
  if (baseIdx.length < 2) {
    const maxY = Math.max(...ring.map((p) => p.y))
    baseIdx = ring.map((p, i) => (Math.abs(p.y - maxY) <= 4 ? i : -1)).filter((i) => i >= 0)
  }
  if (baseIdx.length < 2) return null

  let leftFootIdx = baseIdx[0]!
  let rightFootIdx = baseIdx[0]!
  for (const i of baseIdx) {
    if (ring[i]!.x < ring[leftFootIdx]!.x) leftFootIdx = i
    if (ring[i]!.x > ring[rightFootIdx]!.x) rightFootIdx = i
  }
  if (leftFootIdx === rightFootIdx) return null

  const leftArc = extractRingArcShortest(ring, apexIdx, leftFootIdx)
  const rightArc = extractRingArcShortest(ring, apexIdx, rightFootIdx)
  if (leftArc.length < 2 || rightArc.length < 2) return null
  return { left: leftArc, right: rightArc }
}

/**
 * 从闭合 Moore 环上的顶点沿单一方向「下山」到触地/水平平台，得到有序半子午线像素链（apex→foot）。
 * 丢弃 break 之后的点，避免基线尾巴末端再翘起被全局 z 过滤加回。
 */
function halfMeridianArcPxApexToFootFromRing(
  ring: CalibrationPoint[],
  surfaceYPx: number,
  xCenterPx: number,
  axisGapPx: number,
  side: 'left' | 'right',
  epsBaselinePx: number,
): CalibrationPoint[] | null {
  const n = ring.length
  if (n < MOORE_OUTER_CONTOUR_MIN_POINTS - 1) return null

  const apexIdx = apexIndexOnRing(ring, xCenterPx, surfaceYPx)
  const scoreDir = (dir: 1 | -1): number => {
    let s = 0
    let idx = apexIdx
    const steps = Math.min(12, n - 1)
    for (let k = 0; k < steps; k++) {
      idx = (idx + dir + n) % n
      if (onMeridianHalfPx(ring[idx]!, side, xCenterPx, axisGapPx)) s++
    }
    return s
  }
  const dir: 1 | -1 = scoreDir(1) >= scoreDir(-1) ? 1 : -1

  const apex = ring[apexIdx]!
  const out: CalibrationPoint[] = [apex]
  let idx = apexIdx
  let flatRun = 0
  const flatDyMax = 0.75
  const flatDxMin = 2.25
  const flatRunBreak = 4
  /** 顶点邻域：尚未进入单侧前仍沿环走，避免在另一侧接地处误触地 */
  const inApexCorridor = (p: CalibrationPoint) =>
    p.y <= apex.y + 10 || Math.hypot(p.x - xCenterPx, p.y - apex.y) <= 38

  for (let step = 1; step < n; step++) {
    idx = (idx + dir + n) % n
    if (idx === apexIdx) break
    const p = ring[idx]!
    const prev = out[out.length - 1]!
    const zPx = surfaceYPx - p.y
    const on = onMeridianHalfPx(p, side, xCenterPx, axisGapPx)

    if (step > 1 && !on && !inApexCorridor(p)) break

    const dy = Math.abs(p.y - prev.y)
    const dx = Math.abs(p.x - prev.x)
    if (dy <= flatDyMax && dx >= flatDxMin) flatRun++
    else flatRun = 0
    if (flatRun >= flatRunBreak) break

    if (zPx <= epsBaselinePx) {
      if (on) {
        out.push(p)
        break
      }
      if (!inApexCorridor(p)) break
    }
    out.push(p)
  }

  return out.length >= 2 ? out : null
}

function arcPxToRzOrderedApexToFoot(
  arc: CalibrationPoint[],
  surfaceYPx: number,
  xCenterPx: number,
  pixelScalePxPerMm: number,
  side: 'left' | 'right',
): RzPoint[] | null {
  const s = mmPerPx(pixelScalePxPerMm)
  if (s == null) return null
  const out: RzPoint[] = []
  for (const p of arc) {
    const zMm = (surfaceYPx - p.y) * s
    const rMm = side === 'left' ? (xCenterPx - p.x) * s : (p.x - xCenterPx) * s
    if (!Number.isFinite(rMm) || !Number.isFinite(zMm)) continue
    if (rMm < -1e-9) continue
    out.push({ rMm: Math.max(0, rMm), zMm })
  }
  return out.length >= 2 ? dedupeRz(out) : null
}

function pickSmootherHalfMeridian(left: RzPoint[], right: RzPoint[]): RzPoint[] | null {
  const nMin = 5
  const okL = left.length >= nMin
  const okR = right.length >= nMin
  if (!okL && !okR) return null
  if (!okL) return right
  if (!okR) return left
  /** 沿母线链顺序比较粗糙度；勿再按 z 排序（会破坏弧长参数化） */
  const sL = meridianRoughnessScore(left)
  const sR = meridianRoughnessScore(right)
  if (!Number.isFinite(sL) || !Number.isFinite(sR)) return left.length >= right.length ? left : right
  if (Math.abs(sL - sR) < 1e-18) return left.length >= right.length ? left : right
  return sL <= sR ? left : right
}

/**
 * 对称轴 x：优先 `axisXPxPreferred`（通常为铺展 (subL+subR)/2，与液滴物理中心一致），
 * 并夹在轮廓 xmin/xmax 之间；未给或无效时用轮廓 bbox 中点。
 * 若仅用 Moore 的 xmin/xmax 中点，基线噪点或单侧拖尾会把轴拉偏，r(z) 与体积 V=π∫r²dz 会系统性偏大。
 */
function resolveMeridianAxisXPx(
  xmin: number,
  xmax: number,
  axisGapPx: number,
  preferred: number | null | undefined,
): number {
  const bboxCenter = (xmin + xmax) / 2
  if (preferred == null || !Number.isFinite(preferred)) return bboxCenter
  const lo = xmin + axisGapPx
  const hi = xmax - axisGapPx
  if (!(hi > lo)) return bboxCenter
  const c = Math.min(hi, Math.max(lo, preferred))
  return Number.isFinite(c) ? c : bboxCenter
}

/**
 * 由完整闭合外轮廓构造表面能用的单侧母线；对称轴见 `resolveMeridianAxisXPx`。
 * **优先**：apex + 基准带内 x 最小/最大脚点，apex→脚取环上**最短索引弧**（与 Moore 绕向无关）；失败则回退 `halfMeridianArcPxApexToFootFromRing`。
 * `contourClipMarginPx`：允许 y 略大于 Surface Y 的角点仍参与成环（默认 4px），减轻切除润湿突起导致的断环。
 * A_wa 仍剔除 z≤ε 的近基底液–固条带；母线 r 默认 Savitzky–Golay。
 */
export function meridiansFromOuterContourPx(
  contour: CalibrationPoint[],
  surfaceYPx: number,
  pixelScalePxPerMm: number,
  opts?: {
    epsBaselinePx?: number
    axisGapPx?: number
    /** 对称轴 x（px），建议传铺展 (subL+subR)/2；缺省用轮廓 xmin/xmax 中点 */
    axisXPxPreferred?: number | null
    /** false = 关闭；默认开启。传入对象可改窗口 / 多项式阶数 */
    meridianSavitzkyGolay?: false | { windowSize?: number; polynomial?: number }
    /** 轮廓裁剪：保留 y ≤ surfaceY + margin 的点（px），默认 4 */
    contourClipMarginPx?: number
  },
): {
  awaFreeMeridian: RzPoint[]
  volFreeMeridian: RzPoint[]
  xCenterPx: number
  baselineDiameterMm: number | null
} | null {
  const epsBaselinePx = opts?.epsBaselinePx ?? 4
  const axisGapPx = opts?.axisGapPx ?? 1
  const clipMargin = opts?.contourClipMarginPx ?? 4
  const maxRowPx = Math.floor(surfaceYPx + 1e-9)
  const contourSafe = contour.filter((p) => p.y <= maxRowPx + clipMargin + 1e-6)
  if (contourSafe.length < MOORE_OUTER_CONTOUR_MIN_POINTS) return null

  let xmin = Infinity
  let xmax = -Infinity
  for (const p of contourSafe) {
    if (p.x < xmin) xmin = p.x
    if (p.x > xmax) xmax = p.x
  }
  if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || xmax <= xmin + 2) return null

  const xCenterPx = resolveMeridianAxisXPx(xmin, xmax, axisGapPx, opts?.axisXPxPreferred)
  const ring = contourToRing(contourSafe)

  const feet = meridianArcsApexFeetShortestPath(ring, xCenterPx, surfaceYPx, epsBaselinePx)
  let leftArc: CalibrationPoint[] | null =
    feet && feet.left.length >= 4 ? feet.left : null
  let rightArc: CalibrationPoint[] | null =
    feet && feet.right.length >= 4 ? feet.right : null

  if (!leftArc || leftArc.length < 4) {
    leftArc = halfMeridianArcPxApexToFootFromRing(
      ring,
      surfaceYPx,
      xCenterPx,
      axisGapPx,
      'left',
      epsBaselinePx,
    )
  }
  if (!rightArc || rightArc.length < 4) {
    rightArc = halfMeridianArcPxApexToFootFromRing(
      ring,
      surfaceYPx,
      xCenterPx,
      axisGapPx,
      'right',
      epsBaselinePx,
    )
  }

  let leftRzOrderedFootToApex: RzPoint[] | null =
    leftArc && leftArc.length >= 4
      ? (() => {
          const chain = arcPxToRzOrderedApexToFoot(
            leftArc,
            surfaceYPx,
            xCenterPx,
            pixelScalePxPerMm,
            'left',
          )
          return chain ? [...chain].reverse() : null
        })()
      : null
  let rightRzOrderedFootToApex: RzPoint[] | null =
    rightArc && rightArc.length >= 4
      ? (() => {
          const chain = arcPxToRzOrderedApexToFoot(
            rightArc,
            surfaceYPx,
            xCenterPx,
            pixelScalePxPerMm,
            'right',
          )
          return chain ? [...chain].reverse() : null
        })()
      : null

  const picked = pickSmootherHalfMeridian(leftRzOrderedFootToApex ?? [], rightRzOrderedFootToApex ?? [])
  if (!picked || picked.length < 4) return null

  const pickedForGeom =
    opts?.meridianSavitzkyGolay === false
      ? picked
      : smoothMeridianRadiusSavitzkyGolay(
          picked,
          typeof opts?.meridianSavitzkyGolay === 'object' && opts.meridianSavitzkyGolay != null
            ? opts.meridianSavitzkyGolay
            : undefined,
        )

  const s = mmPerPx(pixelScalePxPerMm)
  if (s == null) return null
  const epsZmm = epsBaselinePx * s

  const volFreeMeridian = orderFreeMeridianFootToApex(pickedForGeom)

  const awaSlice = pickedForGeom.filter((q) => q.zMm > epsZmm)
  const awaFreeMeridian = orderFreeMeridianFootToApex(awaSlice)

  const wPx = contourBaselineWidthPx(contourSafe, surfaceYPx, epsBaselinePx)
  const baselineDiameterMm = wPx != null && wPx > 1 ? wPx * s : null

  if (awaFreeMeridian.length < 2 || volFreeMeridian.length < 2) return null

  return {
    awaFreeMeridian,
    volFreeMeridian,
    xCenterPx,
    baselineDiameterMm,
  }
}

/**
 * 闭合子午截面多边形：(0,0)→(R,0)→自由面→(0,z_apex)→(0,0)。
 * 基底段 dz=0；对称轴段 r=0，对 ∫r²dz、∫zr²dz 贡献为 0。
 */
export function buildClosedMeridianPolygon(rFreeFootToApex: RzPoint[], rContactMm: number): RzPoint[] | null {
  if (rFreeFootToApex.length < 2 || !Number.isFinite(rContactMm) || rContactMm <= 0) return null
  const free = dedupeRz(rFreeFootToApex)
  if (free.length < 2) return null

  const zApex = Math.max(...free.map((q) => q.zMm))
  const footTolZ = Math.max(1e-4, zApex * 1e-6)
  const footTolR = Math.max(5e-4, rContactMm * 0.03)

  const poly: RzPoint[] = [
    { rMm: 0, zMm: 0 },
    { rMm: rContactMm, zMm: 0 },
  ]

  for (const q of free) {
    const atFoot =
      Math.abs(q.zMm) <= footTolZ && Math.abs(q.rMm - rContactMm) <= footTolR && poly.length === 2
    if (atFoot) continue
    poly.push(q)
  }

  const tail = poly[poly.length - 1]
  if (tail.rMm > 1e-3) {
    poly.push({ rMm: 0, zMm: Math.max(tail.zMm, zApex) })
  }

  poly.push({ rMm: 0, zMm: 0 })
  return dedupeRz(poly)
}

/** 闭合多边形 ∮ r² dz 与 ∮ z r² dz（mm³ / mm⁴）梯形法则 */
export function polygonIntegralsR2dz(polyClosed: RzPoint[]): { sumR2dz: number; sumZR2dz: number } {
  if (polyClosed.length < 3) return { sumR2dz: 0, sumZR2dz: 0 }
  let sumR2dz = 0
  let sumZR2dz = 0
  const n = polyClosed.length
  for (let i = 0; i < n - 1; i++) {
    const a = polyClosed[i]
    const b = polyClosed[i + 1]
    const dz = b.zMm - a.zMm
    const r2avg = (a.rMm * a.rMm + b.rMm * b.rMm) / 2
    const zr2avg = (a.zMm * a.rMm * a.rMm + b.zMm * b.rMm * b.rMm) / 2
    sumR2dz += r2avg * dz
    sumZR2dz += zr2avg * dz
  }
  return { sumR2dz, sumZR2dz }
}

/** V = π |∮ r² dz|（mm³）；Z_cm = ∮ z r² dz / ∮ r² dz（mm） */
export function volumeFromClosedMeridianMm3(polyClosed: RzPoint[]): number | null {
  const { sumR2dz } = polygonIntegralsR2dz(polyClosed)
  if (!Number.isFinite(sumR2dz) || Math.abs(sumR2dz) < 1e-18) return null
  return Math.PI * Math.abs(sumR2dz)
}

export function zCentroidMmFromClosedMeridian(polyClosed: RzPoint[]): number | null {
  const { sumR2dz, sumZR2dz } = polygonIntegralsR2dz(polyClosed)
  if (!Number.isFinite(sumR2dz) || Math.abs(sumR2dz) < 1e-18) return null
  const zCm = sumZR2dz / sumR2dz
  return Number.isFinite(zCm) ? zCm : null
}

/**
 * 相邻母线点在 mm 下的跨度超过 `maxChordPx` 个像素当量时视为拓扑断裂，返回 null（可通过不传 pixelScale 跳过检测）。
 * 默认 15px：容忍抽稀 / SG 后的较长弦；真拓扑跳跃多为数十像素以上。
 */
export function liquidVaporAreaMm2(
  freeFootToApex: RzPoint[],
  pixelScalePxPerMm?: number | null,
  opts?: { maxChordPx?: number },
): number | null {
  if (freeFootToApex.length < 2) return null
  const maxChordPx = opts?.maxChordPx ?? 15
  const mmPerPx =
    pixelScalePxPerMm != null && Number.isFinite(pixelScalePxPerMm) && pixelScalePxPerMm > 0
      ? 1 / pixelScalePxPerMm
      : null
  const maxSafeDs = mmPerPx != null ? maxChordPx * mmPerPx : null

  let sum = 0
  for (let i = 1; i < freeFootToApex.length; i++) {
    const a = freeFootToApex[i - 1]
    const b = freeFootToApex[i]
    const dr = b.rMm - a.rMm
    const dz = b.zMm - a.zMm
    const ds = Math.hypot(dr, dz)
    if (!Number.isFinite(ds) || ds <= 0) continue
    if (maxSafeDs != null && ds > maxSafeDs) {
      if (import.meta.env.DEV) {
        console.warn('[liquidVaporAreaMm2] meridian chord too large (topology break?)', {
          index: i,
          dsMm: ds,
          maxSafeDsMm: maxSafeDs,
          a,
          b,
        })
      }
      return null
    }
    const rAvg = (a.rMm + b.rMm) / 2
    sum += 2 * Math.PI * rAvg * ds
  }
  return sum > 0 && Number.isFinite(sum) ? sum : null
}

/** 基底圆盘面积 mm² */
export function baseDiskAreaMm2(diameterMm: number): number | null {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) return null
  const r = diameterMm / 2
  return Math.PI * r * r
}

export interface SurfaceEnergyPhysicalConstants {
  /** N/m，与撞击速度面板 γ 共用 */
  gammaWa: number
  /** N/m，基底–水（硅油–水或固–水） */
  gammaBw: number
  /** N/m，基底–气（硅油–气或固–气） */
  gammaBa: number
  /** kg/m³ */
  rhoW: number
  /** mm，标定初始直径 D₀ */
  d0Mm: number
}

export interface SurfaceEnergyInstant {
  timeMs: number
  absTime: number
  /** Moore 外轮廓未提取或点数不足 12，表面能几何未走轮廓母线 */
  contourExtractFailed: boolean
  /** mm² */
  awaMm2: number | null
  abaseMm2: number | null
  /** mm³ */
  volumeMm3: number | null
  /** mm */
  zCmMm: number | null
  /** J */
  deltaESigmaJ: number | null
  /** J */
  ekJ: number | null
  /** J；E_k+ΔE_σ；序列上经 {@link enforceMechanicalEnergyNonIncreasing} 强制单调不增（**展示**）；耗散 \(W\) 仍用未钳制分量 */
  emechanicalJ: number | null
  /** J；\(E_\mathrm{mech}(0)\)：首帧有效则用首帧，否则首个具备 \(E_k+\Delta E_\sigma\) 的帧 */
  emechanical0J: number | null
  /** J；**原始** \(\max(0,E_\mathrm{mech}(0)-(E_k+\Delta E_\sigma))\)（分量）；不对 \(W\) 平滑 */
  dissipationWorkJ: number | null
  /** W；先对原始 \(W\) 差分得 raw \(\Phi\)，再对 \(\Phi\) MA/SG，最后 \(\max(0,\Phi)\) */
  dissipationPowerW: number | null
  /** m/s */
  vCmMps: number | null
  /** m/s */
  vSpreadMps: number | null
}

/** 参考表面能 E_σ,0 = π D₀² γ_wa（J）；触前球 A_wa,0 = π D₀² */
export function referenceSurfaceEnergyJ(d0Mm: number, gammaWa: number): number | null {
  if (!Number.isFinite(d0Mm) || d0Mm <= 0 || !Number.isFinite(gammaWa)) return null
  const dM = d0Mm * MM_TO_M
  const area0 = Math.PI * dM * dM
  return gammaWa * area0
}

export function deltaSigmaEnergyJ(params: {
  awaMm2: number
  abaseMm2: number
  gammaWa: number
  gammaBw: number
  gammaBa: number
  d0Mm: number
}): number | null {
  const e0 = referenceSurfaceEnergyJ(params.d0Mm, params.gammaWa)
  if (e0 == null) return null
  const awaM2 = params.awaMm2 * MM2_TO_M2
  const abM2 = params.abaseMm2 * MM2_TO_M2
  const e =
    params.gammaWa * awaM2 + (params.gammaBw - params.gammaBa) * abM2 - e0
  return Number.isFinite(e) ? e : null
}

export function dropletMassKg(d0Mm: number, rhoW: number): number | null {
  if (!Number.isFinite(d0Mm) || d0Mm <= 0 || !Number.isFinite(rhoW) || rhoW <= 0) return null
  const dm = d0Mm * MM_TO_M
  const vol = (Math.PI / 6) * dm * dm * dm
  return rhoW * vol
}

/** 参考球体积 V₀ = π D₀³ / 6（mm³）；不可压缩撞击滴取 V(t)/V₀ 检验几何–积分一致性 */
export function referenceSphereVolumeMm3(d0Mm: number): number | null {
  if (!Number.isFinite(d0Mm) || d0Mm <= 0) return null
  return (Math.PI / 6) * d0Mm * d0Mm * d0Mm
}

/** |V/V₀ − 1| ≤ band 视为体积守恒 QC 通过（默认 ±5%） */
export const VOLUME_CONSERVATION_REL_BAND = 0.05

/** E_k = ½ M [ V_cm² + ½ V_spread² ]（J） */
export function kineticEnergyJ(mKg: number, vCmMps: number | null, vSpreadMps: number | null): number | null {
  if (!Number.isFinite(mKg) || mKg <= 0) return null
  const vc = vCmMps ?? 0
  const vs = vSpreadMps ?? 0
  const sumSq = vc * vc + 0.5 * vs * vs
  if (!Number.isFinite(sumSq)) return null
  return 0.5 * mKg * sumSq
}

/**
 * 总机械能 \(E_\mathrm{mech} = E_k + \Delta E_\sigma\)（J），与上式 \(\Delta E_\sigma\)、\(E_k\) 同一参考。
 * 缺一则无法合成。
 */
export function mechanicalEnergyJ(deltaESigmaJ: number | null, ekJ: number | null): number | null {
  if (deltaESigmaJ == null || ekJ == null) return null
  if (!Number.isFinite(deltaESigmaJ) || !Number.isFinite(ekJ)) return null
  const s = deltaESigmaJ + ekJ
  return Number.isFinite(s) ? s : null
}

/**
 * 实验数据护航：强制 \(E_\mathrm{mech}\) 沿时间不增（单调不增；禁止相对前一有限值的回升）。
 * 遇 `null`/非有限则跳过该点且不重置参考值。
 */
export function enforceMechanicalEnergyNonIncreasing(rows: SurfaceEnergyInstant[]): void {
  let prev: number | null = null
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i].emechanicalJ
    if (v == null || !Number.isFinite(v)) continue
    if (prev == null) {
      prev = v
      continue
    }
    if (v > prev) {
      rows[i].emechanicalJ = prev
    } else {
      prev = v
    }
  }
}

export interface ComputeSurfaceEnergyForPointInput {
  point: AnalysisPoint
  surfaceYPx: number
  pixelScalePxPerMm: number
  constants: Omit<SurfaceEnergyPhysicalConstants, never>
  /** 若给定且点数足够，由此链算旋转母线（A_wa、V、ΔE_σ）；否则用 `point.outerContourPx` */
  outerContourPxOverride?: CalibrationPoint[] | undefined
}

/**
 * 单帧几何 + 热力学量（不含时间导数项）。
 */
export function computeSurfaceEnergyGeometryForPoint(
  input: ComputeSurfaceEnergyForPointInput,
): {
  awaMm2: number | null
  abaseMm2: number | null
  volumeMm3: number | null
  zCmMm: number | null
  deltaESigmaJ: number | null
} | null {
  const { point, surfaceYPx, pixelScalePxPerMm, constants, outerContourPxOverride } = input
  if (point.subL == null || point.subR == null) return null

  let rContact = contactRadiusMm(point, pixelScalePxPerMm)
  let abase = baseDiskAreaMm2(point.absDiameter)
  if (rContact == null || abase == null) return null

  const contourPxForMeridian =
    outerContourPxOverride &&
    outerContourPxOverride.length >= MOORE_OUTER_CONTOUR_MIN_POINTS
      ? outerContourPxOverride
      : point.outerContourPx

  const contourMer =
    contourPxForMeridian && contourPxForMeridian.length >= MOORE_OUTER_CONTOUR_MIN_POINTS
      ? meridiansFromOuterContourPx(contourPxForMeridian, surfaceYPx, pixelScalePxPerMm, {
          axisXPxPreferred: (point.subL + point.subR) / 2,
        })
      : null

  if (contourMer?.baselineDiameterMm != null && contourMer.baselineDiameterMm > 1e-6) {
    const dMm = contourMer.baselineDiameterMm
    const a = baseDiskAreaMm2(dMm)
    if (a != null) {
      abase = a
      rContact = dMm / 2
    }
  }

  if (contourMer) {
    const awa = liquidVaporAreaMm2(contourMer.awaFreeMeridian, pixelScalePxPerMm)
    const closed = buildClosedMeridianPolygon(contourMer.volFreeMeridian, rContact)
    const vol = closed ? volumeFromClosedMeridianMm3(closed) : null
    const zCm = closed ? zCentroidMmFromClosedMeridian(closed) : null
    const awaUse = awa ?? null
    const dE =
      awaUse != null
        ? deltaSigmaEnergyJ({
            awaMm2: awaUse,
            abaseMm2: abase,
            gammaWa: constants.gammaWa,
            gammaBw: constants.gammaBw,
            gammaBa: constants.gammaBa,
            d0Mm: constants.d0Mm,
          })
        : null
    return {
      awaMm2: awaUse,
      abaseMm2: abase,
      volumeMm3: vol,
      zCmMm: zCm,
      deltaESigmaJ: dE,
    }
  }

  const rawPt = pickMeridianCalibrationPoints(point)
  if (!rawPt) {
    return {
      awaMm2: null,
      abaseMm2: abase,
      volumeMm3: null,
      zCmMm: null,
      deltaESigmaJ: null,
    }
  }

  const rz = calibrationPointsToRzMm(rawPt, surfaceYPx, point.subL, point.subR, pixelScalePxPerMm)
  if (!rz) {
    return {
      awaMm2: null,
      abaseMm2: abase,
      volumeMm3: null,
      zCmMm: null,
      deltaESigmaJ: null,
    }
  }

  const freeMeridian = orderFreeMeridianFootToApex(rz)
  const awa = liquidVaporAreaMm2(freeMeridian, pixelScalePxPerMm)

  const closed = buildClosedMeridianPolygon(freeMeridian, rContact)
  const vol = closed ? volumeFromClosedMeridianMm3(closed) : null
  const zCm = closed ? zCentroidMmFromClosedMeridian(closed) : null

  const awaUse = awa ?? null
  const dE =
    awaUse != null
      ? deltaSigmaEnergyJ({
          awaMm2: awaUse,
          abaseMm2: abase,
          gammaWa: constants.gammaWa,
          gammaBw: constants.gammaBw,
          gammaBa: constants.gammaBa,
          d0Mm: constants.d0Mm,
        })
      : null

  return {
    awaMm2: awaUse,
    abaseMm2: abase,
    volumeMm3: vol,
    zCmMm: zCm,
    deltaESigmaJ: dE,
  }
}

/**
 * 离散时间导数：中间点 **中心差分**，首点前向、末点后向；邻居缺失时降级。
 * 标量与时间为任意物理一致单位；返回值量纲为 Δ标量 / Δt（例如 mm/ms，数值上常与 m/s 一致）。
 */
export function derivativeWrtTimeCentralOrEndpoint(
  values: (number | null)[],
  timesMs: number[],
  index: number,
): number | null {
  const n = values.length
  if (n < 2 || index < 0 || index >= n) return null
  const v = values[index]
  if (v == null || !Number.isFinite(v)) return null

  const canCentral =
    index > 0 &&
    index < n - 1 &&
    values[index - 1] != null &&
    values[index + 1] != null &&
    Number.isFinite(values[index - 1]!) &&
    Number.isFinite(values[index + 1]!)
  if (canCentral) {
    const dt = timesMs[index + 1] - timesMs[index - 1]
    if (dt <= 1e-6) return null
    return (values[index + 1]! - values[index - 1]!) / dt
  }

  if (index > 0 && values[index - 1] != null && Number.isFinite(values[index - 1]!)) {
    const dt = timesMs[index] - timesMs[index - 1]
    if (dt <= 1e-6) return null
    return (v - values[index - 1]!) / dt
  }

  if (index < n - 1 && values[index + 1] != null && Number.isFinite(values[index + 1]!)) {
    const dt = timesMs[index + 1] - timesMs[index]
    if (dt <= 1e-6) return null
    return (values[index + 1]! - v) / dt
  }

  return null
}

/**
 * 对整条分析序列计算表面能/动能相关量。
 * \(V_{cm}\)、\(V_{spread}\) 共用同一套中心/端点差分，避免与后向差分接触线速度混用导致 \(E_k\) 时间错位。
 *
 * @param dissipationOptions 仅作用于 **raw \(\Phi\)**：`smoothMode: 'ma' | 'sg'`、窗宽、`sgPolynomialDegree`（仅 SG）。\(W_\mathrm{diss}\) 不再平滑。
 */
export function computeSurfaceEnergySeries(
  data: AnalysisPoint[],
  surfaceYPx: number,
  pixelScalePxPerMm: number,
  constants: SurfaceEnergyPhysicalConstants,
  contourDisplay?: SurfaceEnergySeriesContourDisplayOpts | null,
  dissipationOptions?: ComputeDissipationSeriesOptions | null,
): SurfaceEnergyInstant[] {
  const mKg = dropletMassKg(constants.d0Mm, constants.rhoW)

  const rows: SurfaceEnergyInstant[] = data.map((point) => {
    const outerOverride =
      contourDisplay && contourDisplay.smoothPct > 0
        ? applyDisplaySmoothToOuterContourPx(
            point.outerContourPx,
            surfaceYPx,
            contourDisplay.smoothPct,
            contourDisplay.preserveBaselineBand,
          )
        : undefined
    const geo = computeSurfaceEnergyGeometryForPoint({
      point,
      surfaceYPx,
      pixelScalePxPerMm,
      constants,
      outerContourPxOverride: outerOverride,
    })
    const contourExtractFailed = mooreContourExtractFailedForPoint(point)
    return {
      timeMs: point.time,
      absTime: point.absTime,
      contourExtractFailed,
      awaMm2: geo?.awaMm2 ?? null,
      abaseMm2: geo?.abaseMm2 ?? null,
      volumeMm3: geo?.volumeMm3 ?? null,
      zCmMm: geo?.zCmMm ?? null,
      deltaESigmaJ: geo?.deltaESigmaJ ?? null,
      ekJ: null,
      emechanicalJ: null,
      emechanical0J: null,
      dissipationWorkJ: null,
      dissipationPowerW: null,
      vCmMps: null,
      vSpreadMps: null,
    }
  })

  const tMs = rows.map((r) => r.timeMs)
  const zSeries = rows.map((r) => r.zCmMm)
  const dSeries = data.map((p) => p.absDiameter)

  for (let i = 0; i < rows.length; i++) {
    const dzDt = derivativeWrtTimeCentralOrEndpoint(zSeries, tMs, i)
    rows[i].vCmMps = dzDt != null && Number.isFinite(dzDt) ? dzDt : null

    const dDDt = derivativeWrtTimeCentralOrEndpoint(
      dSeries.map((d) => (Number.isFinite(d) ? d : null)),
      tMs,
      i,
    )
    rows[i].vSpreadMps =
      dDDt != null && Number.isFinite(dDDt) ? 0.5 * dDDt : null

    const ek = mKg != null ? kineticEnergyJ(mKg, rows[i].vCmMps, rows[i].vSpreadMps) : null
    rows[i].ekJ = ek
    rows[i].emechanicalJ = mechanicalEnergyJ(rows[i].deltaESigmaJ, ek)
  }

  enforceMechanicalEnergyNonIncreasing(rows)

  /** 耗散仅用 \(E_k+\Delta E_\sigma\)（分量），不用钳制后的 `emechanicalJ`，否则与 \(E_k+\Delta E_\sigma+W\) 校验混轨 */
  const dissipationSamples = rows.map((r) => ({
    timeMs: r.timeMs,
    ekJ: r.ekJ,
    deltaESigmaJ: r.deltaESigmaJ,
  }))
  const diss = computeDissipationSeries(dissipationSamples, dissipationOptions ?? undefined)
  for (let i = 0; i < rows.length; i++) {
    rows[i].emechanical0J = diss[i].emechanical0J
    rows[i].dissipationWorkJ = diss[i].dissipationWorkJ
    rows[i].dissipationPowerW = diss[i].dissipationPowerW
  }

  return rows
}

export type {
  ComputeDissipationSeriesOptions,
  DissipationSmoothMode,
} from './surfaceEnergyDissipation'
