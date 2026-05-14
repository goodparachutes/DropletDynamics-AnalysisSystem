import type { CalibrationPoint } from '../../types/analysis'
import { isDropletGray } from './dropletBinary'

/** 亮度分割下「备用阈值重试」相对全局阈值的步长（亮滴 +Δ / 暗滴 −Δ） */
export const CONTOUR_LUMINANCE_ALT_RETRY_DELTA = 18
import { applyCircularSuppressToBinaryMask, binaryClosing3x3Iterations } from './contourMorphology'

export type ContourSegmentationMode = 'luminance' | 'absDiff'

/** RGB 灰度 uint8，长度 width*height */
export function imageDataToGrayUint8(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData
  const g = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    g[i] = Math.round((data[o] + data[o + 1] + data[o + 2]) / 3)
  }
  return g
}

export function absDiffGray(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error('absDiffGray: length mismatch')
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) {
    out[i] = Math.abs(a[i]! - b[i]!)
  }
  return out
}

/** 差分大于阈值的像素标为前景 1（液滴运动/与背景不一致区域） */
export function thresholdAboveForBinaryMask(diff: Uint8Array, threshold: number): Uint8Array {
  const t = Math.max(0, Math.min(255, threshold))
  const out = new Uint8Array(diff.length)
  for (let i = 0; i < diff.length; i++) {
    out[i] = diff[i]! > t ? 1 : 0
  }
  return out
}

/** 二值 mask：1 = 液滴前景（与主流程 threshold / dropletIsBright 一致） */
export function imageDataToDropletMask(
  imageData: ImageData,
  threshold: number,
  dropletIsBright: boolean,
): Uint8Array {
  const { width, height, data } = imageData
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const gray = (data[o] + data[o + 1] + data[o + 2]) / 3
    mask[i] = isDropletGray(gray, threshold, dropletIsBright) ? 1 : 0
  }
  return mask
}

/**
 * 将基准线 **以下**（图像 y 更大的一侧：基底、倒影、台面亮斑）强制视为背景。
 * 保留行满足 `y <= floor(surfaceYPx)`，与 z_mm = (surfaceY - y) * mm/px 中 z≥0 的一侧一致。
 * @returns 最后保留的最大行索引（含该行）
 */
export function clampBinaryMaskBelowBaseline(
  mask: Uint8Array,
  width: number,
  height: number,
  surfaceYPx: number,
): number {
  const maxInclusiveRow = Math.max(0, Math.min(height - 1, Math.floor(surfaceYPx)))
  for (let y = maxInclusiveRow + 1; y < height; y++) {
    mask.fill(0, y * width, (y + 1) * width)
  }
  return maxInclusiveRow
}

const BG_REACHED = 2

/**
 * Shadowgraphy 透镜/TIR：二值后滴内常为 0「高光空洞」，Moore 会误拾内边界。
 * 从图像四边框所有背景像素出发做 4-连通泛洪，凡与边框连通的 0 标为真实背景；
 * 再反转：非背景一律为前景 1 → 实心液滴，仅保留最外层液–气轮廓。
 * （假定物理外轮廓闭合；若壳破裂且空洞与边框连通，该空洞会被正确视为背景。）
 */
export function solidifyDropletMaskByBackgroundFloodInvert(mask: Uint8Array, width: number, height: number): void {
  const n = width * height
  const reached = new Uint8Array(n)
  const stack: number[] = []

  const trySeed = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const i = y * width + x
    if (mask[i] !== 0 || reached[i]) return
    reached[i] = BG_REACHED
    stack.push(x, y)
  }

  for (let x = 0; x < width; x++) {
    trySeed(x, 0)
    trySeed(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    trySeed(0, y)
    trySeed(width - 1, y)
  }

  while (stack.length > 0) {
    const y = stack.pop()!
    const x = stack.pop()!
    trySeed(x - 1, y)
    trySeed(x + 1, y)
    trySeed(x, y - 1)
    trySeed(x, y + 1)
  }

  for (let i = 0; i < n; i++) {
    mask[i] = reached[i] === BG_REACHED ? 0 : 1
  }
}

function getM(mask: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || x >= w || y < 0 || y >= h) return 0
  return mask[y * w + x]
}

/** 4-连通 flood fill：仅保留包含种子点的连通分量（前景） */
/** 4-邻域膨胀 1 次（1=前景） */
function dilateForegroundMask4(mask: Uint8Array, width: number, height: number): Uint8Array {
  const n = mask.length
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    out[i] = 1
    const x = i % width
    const y = (i / width) | 0
    if (x > 0) out[i - 1] = 1
    if (x + 1 < width) out[i + 1] = 1
    if (y > 0) out[i - width] = 1
    if (y + 1 < height) out[i + width] = 1
  }
  return out
}

/**
 * 与前景掩码 4-邻接的外侧像素灰度（「一环」背景），用于合成静态背景。
 * 比全局域外中位数更贴近液滴边缘照明，减轻其它帧在参考液滴位置出现差分鬼影。
 */
function medianGrayOutsideAdjacentRing(
  gray: Uint8Array,
  foreground: Uint8Array,
  width: number,
  height: number,
): number | null {
  const vals: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (foreground[i]) continue
      let touchesFg = false
      if (x > 0 && foreground[i - 1]) touchesFg = true
      else if (x + 1 < width && foreground[i + 1]) touchesFg = true
      else if (y > 0 && foreground[i - width]) touchesFg = true
      else if (y + 1 < height && foreground[i + width]) touchesFg = true
      if (touchesFg) vals.push(gray[i]!)
    }
  }
  if (vals.length === 0) return null
  vals.sort((a, b) => a - b)
  return vals[Math.floor(vals.length / 2)]!
}

export function floodFillForegroundMask(
  mask: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
): Uint8Array {
  const out = new Uint8Array(width * height)
  const sx = Math.max(0, Math.min(width - 1, Math.round(seedX)))
  const sy = Math.max(0, Math.min(height - 1, Math.round(seedY)))
  if (getM(mask, width, height, sx, sy) !== 1) return out

  const stack: number[] = [sx, sy]
  while (stack.length > 0) {
    const y = stack.pop()!
    const x = stack.pop()!
    const i = y * width + x
    if (out[i]) continue
    if (getM(mask, width, height, x, y) !== 1) continue
    out[i] = 1
    if (x > 0) stack.push(x - 1, y)
    if (x + 1 < width) stack.push(x + 1, y)
    if (y > 0) stack.push(x, y - 1)
    if (y + 1 < height) stack.push(x, y + 1)
  }
  return out
}

/** Moore 边界追踪起点搜索：`raster` 全图行优先；`horizontalRayLeft` 仅在指定行从左向右找第一条左背景右前景边 */
export type MooreContourStartSearch = 'raster' | 'horizontalRayLeft'

function findMooreStartPixelPadded(
  getP: (x: number, y: number) => number,
  width: number,
  height: number,
  startSearch: MooreContourStartSearch,
  rayRowOriginal: number,
): { sx: number; sy: number } | null {
  if (startSearch === 'horizontalRayLeft') {
    const ry = Math.max(0, Math.min(height - 1, Math.round(rayRowOriginal)))
    for (let xOrig = 0; xOrig < width; xOrig++) {
      const px = xOrig + 1
      const py = ry + 1
      if (getP(px, py) === 1 && getP(px - 1, py) === 0) {
        return { sx: px, sy: py }
      }
    }
    return null
  }
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      if (getP(x, y) === 1 && getP(x - 1, y) === 0) {
        return { sx: x, sy: y }
      }
    }
  }
  return null
}

/**
 * Moore 邻域外轮廓（8–连通），顺时针环绕物体外侧。
 * 默认起点为全图行优先首个「当前为前景、西侧为背景」的像素；可选仅在基准线附近一行从左向右射线，优先击中物理外壳左侧。
 */
export function traceMooreOuterContour(
  comp: Uint8Array,
  width: number,
  height: number,
  options?: {
    startSearch?: MooreContourStartSearch
    /** 图像 y（像素，顶为 0）；仅 `horizontalRayLeft` 使用，常用 surfaceY−3 */
    rayRowPx?: number
  },
): CalibrationPoint[] | null {
  const pw = width + 2
  const ph = height + 2
  const pad = new Uint8Array(pw * ph)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pad[(y + 1) * pw + x + 1] = comp[y * width + x]
    }
  }

  const getP = (x: number, y: number) => pad[y * pw + x]

  const startSearch = options?.startSearch ?? 'raster'
  const rayRow =
    options?.rayRowPx != null && Number.isFinite(options.rayRowPx) ? options.rayRowPx : 0

  const start = findMooreStartPixelPadded(getP, width, height, startSearch, rayRow)
  if (!start) return null
  const sx = start.sx
  const sy = start.sy

  /** 相对当前边界像素的 8 邻域，自 NW 起顺时针（图像坐标 y 向下） */
  const cwFromNw: Array<[number, number]> = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
  ]

  const contour: CalibrationPoint[] = []
  let bx = sx
  let by = sy
  let prevX = sx - 1
  let prevY = sy

  const maxIter = pw * ph * 16
  for (let iter = 0; iter < maxIter; iter++) {
    contour.push({ x: bx - 1, y: by - 1 })

    let pi = cwFromNw.findIndex(([ox, oy]) => bx + ox === prevX && by + oy === prevY)
    if (pi < 0) break

    let moved = false
    for (let k = 1; k <= 8; k++) {
      const [ox, oy] = cwFromNw[(pi + k) % 8]!
      const tx = bx + ox
      const ty = by + oy
      if (getP(tx, ty) !== 1) continue
      prevX = bx
      prevY = by
      bx = tx
      by = ty
      moved = true
      break
    }
    if (!moved) break
    if (bx === sx && by === sy && contour.length > 1) break
  }

  if (contour.length < 8) return null
  const f = contour[0]!
  const last = contour[contour.length - 1]!
  if (last.x !== f.x || last.y !== f.y) contour.push({ ...f })
  return contour
}

/** 沿闭合链均匀抽稀，避免单帧点过多 */
export function subsampleContourClosed(pts: CalibrationPoint[], maxPts: number): CalibrationPoint[] {
  if (pts.length <= maxPts) return pts
  const n = pts.length - 1
  const step = n / maxPts
  const out: CalibrationPoint[] = []
  for (let k = 0; k < maxPts; k++) {
    const idx = Math.min(n - 1, Math.floor(k * step))
    out.push(pts[idx]!)
  }
  if (out.length > 0 && (out[out.length - 1].x !== pts[n]?.x || out[out.length - 1].y !== pts[n]?.y)) {
    out.push(pts[n]!)
  }
  return out
}

export interface ExtractOuterContourParams {
  imageData: ImageData
  threshold: number
  dropletIsBright: boolean
  /** 基底水平线（px）；其下方像素在二值图中一律剔除，避免台面/倒影与液滴连通 */
  surfaceYPx: number
  seedXPx: number
  seedYPx: number
  /** 亮度阈值 或 absDiff 时的图像设置占位（absDiff 主要用 diffThreshold） */
  segmentationMode?: ContourSegmentationMode
  /** absDiff 模式：与当前帧同尺寸的参考灰度（采集的无液滴背景，或首帧合成背景） */
  backgroundGray?: Uint8Array | null
  /** absDiff：|I−I_bg| 的低阈值二值化，默认 14 */
  diffThreshold?: number
  /** 形态学闭运算次数（3×3，膨胀→腐蚀），弥合高光孔洞；0 关闭 */
  morphCloseIterations?: number
  /** 单帧橡皮擦：圆域内强制为背景后再提取 Moore */
  manualSuppressCircles?: ReadonlyArray<{ x: number; y: number; rPx: number }>
  /** 仅 luminance 模式：覆盖全局亮度阈值（本帧） */
  luminanceThresholdOverride?: number | null
  /** Moore 起点策略；`horizontalRayLeft` 在单行从左向右找首条边界，利于只跟物理外壳 */
  mooreStartSearch?: MooreContourStartSearch
  /** 射线扫描行（图像 y）；null 则用 floor(surfaceYPx)−3 */
  mooreRayRowPx?: number | null
  /** 轮廓最大点数（闭合链抽稀） */
  maxContourPoints?: number
  /** 连通域最小像素数，不足则尝试更低阈值或失败 */
  minComponentPixels?: number
}

/**
 * 首帧/当前帧含有近似圆形液滴时：用亮度阈值得到连通域，将域内灰度替换为域外中位数，得到合成静态背景灰度。
 */
export function syntheticBackgroundGrayFromFrame(
  imageData: ImageData,
  threshold: number,
  dropletIsBright: boolean,
  surfaceYPx: number,
  seedXPx: number,
  seedYPx: number,
): Uint8Array | null {
  const { width, height } = imageData
  const mask = imageDataToDropletMask(imageData, threshold, dropletIsBright)
  solidifyDropletMaskByBackgroundFloodInvert(mask, width, height)
  clampBinaryMaskBelowBaseline(mask, width, height, surfaceYPx)
  const sx = Math.max(0, Math.min(width - 1, Math.round(seedXPx)))
  const sy = Math.max(0, Math.min(height - 1, Math.round(seedYPx)))
  const compCore = floodFillForegroundMask(mask, width, height, sx, sy)
  let cnt = 0
  for (let i = 0; i < compCore.length; i++) if (compCore[i]) cnt++
  if (cnt < 35) return null
  /** 含一圈过渡边缘，避免二值边界外灰度与填色不一致导致其它帧出现「旧液滴」轮廓 */
  const compFill = dilateForegroundMask4(compCore, width, height)
  const gray = imageDataToGrayUint8(imageData)
  const ringMed = medianGrayOutsideAdjacentRing(gray, compFill, width, height)
  const outside: number[] = []
  for (let i = 0; i < gray.length; i++) {
    if (!compFill[i]) outside.push(gray[i]!)
  }
  outside.sort((a, b) => a - b)
  const globalMed = outside[Math.floor(outside.length / 2)] ?? 128
  const fillGray = ringMed ?? globalMed
  const out = new Uint8Array(gray)
  for (let i = 0; i < compFill.length; i++) {
    if (compFill[i]) out[i] = fillGray
  }
  return out
}

/** 与 `extractDropletOuterContourPx` 相同的二值掩码流水线（用于 UI 预览） */
export function buildForegroundMaskForContour(params: {
  imageData: ImageData
  threshold: number
  dropletIsBright: boolean
  surfaceYPx: number
  segmentationMode: ContourSegmentationMode
  backgroundGray: Uint8Array | null | undefined
  diffThreshold: number
  morphCloseIterations: number
  manualSuppressCircles?: ReadonlyArray<{ x: number; y: number; rPx: number }>
  luminanceThresholdOverride?: number | null
}): Uint8Array {
  const { width, height } = params.imageData
  let mask: Uint8Array
  const useDiff =
    params.segmentationMode === 'absDiff' &&
    params.backgroundGray != null &&
    params.backgroundGray.length === width * height

  if (useDiff) {
    const cur = imageDataToGrayUint8(params.imageData)
    const diff = absDiffGray(cur, params.backgroundGray!)
    mask = thresholdAboveForBinaryMask(diff, params.diffThreshold)
  } else {
    const thr =
      params.luminanceThresholdOverride != null && Number.isFinite(params.luminanceThresholdOverride)
        ? Math.max(0, Math.min(255, params.luminanceThresholdOverride))
        : params.threshold
    mask = imageDataToDropletMask(params.imageData, thr, params.dropletIsBright)
  }

  solidifyDropletMaskByBackgroundFloodInvert(mask, width, height)

  if (params.morphCloseIterations > 0) {
    mask = binaryClosing3x3Iterations(mask, width, height, params.morphCloseIterations)
  }

  clampBinaryMaskBelowBaseline(mask, width, height, params.surfaceYPx)

  /** 橡皮擦须在闭运算**之后**：否则膨胀会把邻近前景重新铺回已挖空的圆域，预览里表现为「涂了还在」。 */
  if (params.manualSuppressCircles?.length) {
    applyCircularSuppressToBinaryMask(mask, width, height, params.manualSuppressCircles)
  }

  return mask
}

/**
 * 等价流程：二值化 → 种子 flood-fill 连通域 → Moore 外轮廓（类似 cv2.findContours RETR_EXTERNAL）。
 * 失败（种子不在液滴内、轮廓过短）时返回 null。
 */
function buildContourSeeds(
  width: number,
  seedXPx: number,
  seedYPx: number,
  maxInclusiveRow: number,
): Array<[number, number]> {
  const sx0 = Math.max(0, Math.min(width - 1, Math.round(seedXPx)))
  const syHint = Math.max(0, Math.min(maxInclusiveRow, Math.round(seedYPx)))
  const anchorY = Math.max(0, Math.min(maxInclusiveRow, syHint))

  const raw: Array<[number, number]> = [
    [sx0, syHint],
    [sx0, anchorY],
    [sx0, maxInclusiveRow],
  ]
  for (const dy of [0, 2, 5, 10, 18, 28, 40, 55]) {
    const sy = anchorY - dy
    if (sy >= 0 && sy <= maxInclusiveRow) raw.push([sx0, sy])
  }
  for (const dx of [-48, -32, -20, -12, -6, 6, 12, 20, 32, 48]) {
    const sx = sx0 + dx
    if (sx >= 0 && sx < width) raw.push([sx, anchorY])
  }
  for (const dx of [-24, -12, 12, 24]) {
    const sx = sx0 + dx
    const sy = Math.max(0, anchorY - 12)
    if (sx >= 0 && sx < width && sy <= maxInclusiveRow) raw.push([sx, sy])
  }

  const seen = new Set<string>()
  const seeds: Array<[number, number]> = []
  for (const [x, y] of raw) {
    const sx = Math.max(0, Math.min(width - 1, x))
    const sy = Math.max(0, Math.min(maxInclusiveRow, y))
    const key = `${sx},${sy}`
    if (seen.has(key)) continue
    seen.add(key)
    seeds.push([sx, sy])
  }
  return seeds
}

function clipClosedContourToMaxRow(
  contour: CalibrationPoint[],
  maxInclusiveRow: number,
): CalibrationPoint[] | null {
  const clipped = contour.filter((p) => p.y <= maxInclusiveRow + 1e-6)
  if (clipped.length < 8) return null
  const f = clipped[0]!
  const last = clipped[clipped.length - 1]!
  if (last.x !== f.x || last.y !== f.y) clipped.push({ x: f.x, y: f.y })
  return clipped
}

export function extractDropletOuterContourPx(params: ExtractOuterContourParams): CalibrationPoint[] | null {
  const {
    imageData,
    threshold,
    dropletIsBright,
    surfaceYPx,
    seedXPx,
    seedYPx,
    segmentationMode = 'luminance',
    backgroundGray = null,
    diffThreshold = 14,
    morphCloseIterations = 0,
    manualSuppressCircles,
    luminanceThresholdOverride = null,
    mooreStartSearch = 'raster',
    mooreRayRowPx = null,
    maxContourPoints = 4500,
    minComponentPixels = 45,
  } = params
  const { width, height } = imageData
  if (width < 4 || height < 4) return null

  const mask = buildForegroundMaskForContour({
    imageData,
    threshold,
    dropletIsBright,
    surfaceYPx,
    segmentationMode,
    backgroundGray,
    diffThreshold,
    morphCloseIterations,
    manualSuppressCircles,
    luminanceThresholdOverride,
  })
  const maxInclusiveRow = Math.max(0, Math.min(height - 1, Math.floor(surfaceYPx)))

  const seeds = buildContourSeeds(width, seedXPx, seedYPx, maxInclusiveRow)

  const tryMinPixels = [minComponentPixels, Math.max(22, Math.floor(minComponentPixels * 0.5))]
  let comp: Uint8Array | null = null
  let bestArea = 0

  for (const minPx of tryMinPixels) {
    bestArea = 0
    comp = null
    for (const [sx, sy] of seeds) {
      if (getM(mask, width, height, sx, sy) !== 1) continue
      const c = floodFillForegroundMask(mask, width, height, sx, sy)
      let cnt = 0
      for (let i = 0; i < c.length; i++) if (c[i]) cnt++
      if (cnt >= minPx && cnt > bestArea) {
        bestArea = cnt
        comp = c
      }
    }
    if (comp && bestArea >= minPx) break
  }

  if (!comp) return null

  const defaultRayRow = Math.max(0, Math.min(height - 1, Math.floor(surfaceYPx) - 3))
  const rayRowResolved =
    mooreRayRowPx != null && Number.isFinite(mooreRayRowPx)
      ? Math.max(0, Math.min(height - 1, Math.round(mooreRayRowPx)))
      : defaultRayRow

  const raw = traceMooreOuterContour(comp, width, height, {
    startSearch: mooreStartSearch,
    rayRowPx: mooreStartSearch === 'horizontalRayLeft' ? rayRowResolved : undefined,
  })
  if (!raw || raw.length < 12) return null
  const clipped = clipClosedContourToMaxRow(raw, maxInclusiveRow)
  if (!clipped) return null
  return subsampleContourClosed(clipped, maxContourPoints)
}
