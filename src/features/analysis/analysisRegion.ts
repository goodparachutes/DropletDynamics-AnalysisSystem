import type { AnalysisPoint, CalibrationPoint } from '../../types/analysis'

/** 全画布上的分析 ROI（像素，左上 + 宽高） */
export type AnalysisRegionRect = { x: number; y: number; w: number; h: number }

export const ANALYSIS_REGION_MIN_SIDE_PX = 40

/** 空泡 ROI 可框得更小（微气泡）；仍须 ≥ 2 以便二值与 Moore 有意义 */
export const CAVITY_ROI_MIN_SIDE_PX = 12

/**
 * 由拖拽两点得到矩形并夹在画幅内；边长过小返回 null。
 * 若给定 `surfaceYGlobal`，保证矩形竖向范围包含该基准行（否则铺展/Moore 无意义）。
 */
export function finalizeAnalysisRegionFromDrag(
  fullW: number,
  fullH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  surfaceYGlobal: number | null,
): AnalysisRegionRect | null {
  let x = Math.min(x0, x1)
  let y = Math.min(y0, y1)
  let x2 = Math.max(x0, x1)
  let y2 = Math.max(y0, y1)
  x = Math.max(0, Math.floor(x))
  y = Math.max(0, Math.floor(y))
  x2 = Math.min(fullW, Math.ceil(x2))
  y2 = Math.min(fullH, Math.ceil(y2))
  let w = x2 - x
  let h = y2 - y
  if (surfaceYGlobal != null && Number.isFinite(surfaceYGlobal)) {
    const sy = Math.floor(surfaceYGlobal)
    if (sy < y) {
      h += y - sy
      y = sy
    } else if (sy >= y + h) {
      h = sy - y + 1
    }
    y = Math.max(0, y)
    h = Math.min(fullH - y, h)
    w = Math.min(fullW - x, w)
  }
  if (w < ANALYSIS_REGION_MIN_SIDE_PX || h < ANALYSIS_REGION_MIN_SIDE_PX) return null
  return { x, y, w, h }
}

/** 空泡 ROI：不强制包含 Surface Y，仅夹在全画幅内 */
export function finalizeCavityRoiFromDrag(
  fullW: number,
  fullH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): AnalysisRegionRect | null {
  let x = Math.min(x0, x1)
  let y = Math.min(y0, y1)
  let x2 = Math.max(x0, x1)
  let y2 = Math.max(y0, y1)
  x = Math.max(0, Math.floor(x))
  y = Math.max(0, Math.floor(y))
  x2 = Math.min(fullW, Math.ceil(x2))
  y2 = Math.min(fullH, Math.ceil(y2))
  const w = x2 - x
  const h = y2 - y
  if (w < CAVITY_ROI_MIN_SIDE_PX || h < CAVITY_ROI_MIN_SIDE_PX) return null
  return { x, y, w, h }
}

/** 离散帧索引对应的 seek 时刻（秒）：取帧区间中点，避免 t=fi/fps 浮点落在上一帧 bucket 内 */
export function cavityDiscreteFrameSeekTimeSec(
  frameIndex: number,
  fps: number,
  durationSec: number,
): number {
  const f = Math.max(1, Math.floor(fps) || 1)
  const t = (Math.max(0, frameIndex) + 0.5) / f
  if (!Number.isFinite(durationSec) || durationSec <= 0) return Math.max(0, t)
  return Math.max(0, Math.min(t, durationSec - 1e-4))
}

export function cropImageData(imageData: ImageData, rect: AnalysisRegionRect): ImageData {
  const { x, y, w, h } = rect
  const src = imageData.data
  const srcW = imageData.width
  const data = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row++) {
    const srcRow = (y + row) * srcW * 4 + x * 4
    data.set(src.subarray(srcRow, srcRow + w * 4), row * w * 4)
  }
  return new ImageData(data, w, h)
}

/** 橡皮擦圆心在裁剪坐标系下（相对 ROI 左上） */
export function suppressCirclesInCropSpace(
  circles: ReadonlyArray<{ x: number; y: number; rPx: number }> | null | undefined,
  ox: number,
  oy: number,
  cropW: number,
  cropH: number,
): Array<{ x: number; y: number; rPx: number }> | undefined {
  if (!circles?.length) return undefined
  const out: Array<{ x: number; y: number; rPx: number }> = []
  for (const c of circles) {
    const cx = c.x - ox
    const cy = c.y - oy
    if (cx + c.rPx < 0 || cy + c.rPx < 0 || cx - c.rPx > cropW || cy - c.rPx > cropH) continue
    out.push({ x: cx, y: cy, rPx: c.rPx })
  }
  return out.length ? out : undefined
}

export function offsetAnalysisPointToFullImage(p: AnalysisPoint, rect: AnalysisRegionRect): AnalysisPoint {
  const ox = rect.x
  const oy = rect.y
  const q: AnalysisPoint = { ...p }
  if (p.subL != null) q.subL = p.subL + ox
  if (p.subR != null) q.subR = p.subR + ox
  if (p.ptsL?.length) q.ptsL = p.ptsL.map((c) => ({ x: c.x + ox, y: c.y + oy }))
  if (p.ptsR?.length) q.ptsR = p.ptsR.map((c) => ({ x: c.x + ox, y: c.y + oy }))
  if (p.outerContourPx?.length) q.outerContourPx = p.outerContourPx.map((c) => ({ x: c.x + ox, y: c.y + oy }))
  if (p.manualSuppressCircles?.length) {
    q.manualSuppressCircles = p.manualSuppressCircles.map((c) => ({ ...c, x: c.x + ox, y: c.y + oy }))
  }
  return q
}

export type AnalysisPipelineFrame = {
  imageData: ImageData
  surfaceY: number
  ox: number
  oy: number
  circlesForCrop: Array<{ x: number; y: number; rPx: number }> | undefined
}

/** 全局背景涂抹 + 单帧橡皮：合并后传入 `buildAnalysisPipelineFrame`（全画布坐标）。 */
export function mergeSuppressCircles(
  globalCircles: ReadonlyArray<{ x: number; y: number; rPx: number }> | null | undefined,
  perFrameCircles: ReadonlyArray<{ x: number; y: number; rPx: number }> | null | undefined,
): Array<{ x: number; y: number; rPx: number }> | undefined {
  const out: Array<{ x: number; y: number; rPx: number }> = []
  if (globalCircles?.length) {
    for (const c of globalCircles) out.push({ x: c.x, y: c.y, rPx: c.rPx })
  }
  if (perFrameCircles?.length) {
    for (const c of perFrameCircles) out.push({ x: c.x, y: c.y, rPx: c.rPx })
  }
  return out.length ? out : undefined
}

/** 供铺展 / Moore / 修正：可选 ROI 裁剪 + 橡皮擦坐标换算 */
export function buildAnalysisPipelineFrame(
  full: ImageData,
  surfaceYGlobal: number,
  region: AnalysisRegionRect | null,
  circles: ReadonlyArray<{ x: number; y: number; rPx: number }> | null | undefined,
): AnalysisPipelineFrame {
  if (!region) {
    return {
      imageData: full,
      surfaceY: surfaceYGlobal,
      ox: 0,
      oy: 0,
      circlesForCrop: circles?.length ? [...circles] : undefined,
    }
  }
  const cropped = cropImageData(full, region)
  return {
    imageData: cropped,
    surfaceY: surfaceYGlobal - region.y,
    ox: region.x,
    oy: region.y,
    circlesForCrop: suppressCirclesInCropSpace(circles, region.x, region.y, cropped.width, cropped.height),
  }
}

export function offsetContourToFullImage(
  contour: CalibrationPoint[] | null | undefined,
  rect: AnalysisRegionRect,
): CalibrationPoint[] | undefined {
  if (!contour?.length) return undefined
  const ox = rect.x
  const oy = rect.y
  return contour.map((c) => ({ x: c.x + ox, y: c.y + oy }))
}
