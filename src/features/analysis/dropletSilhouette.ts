import { isDropletGray } from './dropletBinary'

function medianOfSorted(sorted: number[]): number {
  const n = sorted.length
  if (n === 0) return 0
  const m = Math.floor(n / 2)
  return n % 2 === 1 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2
}

/** 升序数组上的分位数 q∈[0,1]，线性插值 */
function percentileOfSorted(sorted: number[], q: number): number {
  const n = sorted.length
  if (n === 0) return 0
  const clamped = Math.min(1, Math.max(0, q))
  const idx = (n - 1) * clamped
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo >= hi) return sorted[lo]!
  const t = idx - lo
  return sorted[lo]! * (1 - t) + sorted[hi]! * t
}

export interface RowHistogramResult {
  colHist: Int32Array
  cxAtRow: Float32Array
  scanLimit: number
}

/**
 * 单行 ROI 内全部前景像素的左右包络宽度。
 * 中部高光把液滴切成左右两段、或运动拖尾与主体断开时，仍取整体外接弦宽，避免圆偏小、质心偏一侧。
 */
export function foregroundRowBoundingSpan(
  data: Uint8ClampedArray,
  width: number,
  y: number,
  x0: number,
  x1: number,
  threshold: number,
  dropletIsBright: boolean,
  /** 包络中心允许偏离图像中心的相对比例（模糊拖尾易偏心） */
  maxCenterDistFrac = 0.42,
): { left: number; right: number; width: number } | null {
  const rowOffset = y * width * 4
  let minX = x1
  let maxX = x0 - 1
  for (let x = x0; x < x1; x++) {
    const idx = rowOffset + x * 4
    const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
    if (!isDropletGray(gray, threshold, dropletIsBright)) continue
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
  }
  if (maxX < minX) return null
  const w = maxX - minX + 1
  if (w < 8) return null
  const mid = width / 2
  const rc = (minX + maxX) / 2
  if (Math.abs(rc - mid) > width * maxCenterDistFrac) return null
  return { left: minX, right: maxX, width: w }
}

export function buildForegroundRowHistogram(
  imageData: ImageData,
  threshold: number,
  dropletIsBright: boolean,
  options?: { scanLimitFrac?: number; xMarginFrac?: number },
): RowHistogramResult | null {
  const width = imageData.width
  const height = imageData.height
  const data = imageData.data
  if (width === 0 || height === 0) return null

  const scanLimitFrac = options?.scanLimitFrac ?? 0.95
  /** 略收窄边距，便于纳入贴近边缘的运动拖尾（仍以画面中心排除两侧杂点） */
  const xMarginFrac = options?.xMarginFrac ?? 0.06
  const scanLimit = Math.floor(height * scanLimitFrac)
  const startX = Math.floor(width * xMarginFrac)
  const endX = Math.floor(width * (1 - xMarginFrac))

  const colHist = new Int32Array(height)
  const cxAtRow = new Float32Array(height)

  for (let y = 0; y < scanLimit; y++) {
    const run = foregroundRowBoundingSpan(data, width, y, startX, endX, threshold, dropletIsBright)
    if (!run) {
      colHist[y] = 0
      cxAtRow[y] = width / 2
    } else {
      colHist[y] = run.width
      cxAtRow[y] = (run.left + run.right) / 2
    }
  }

  return { colHist, cxAtRow, scanLimit }
}

/** 与自动标定一致：自上向下找液滴主体最宽行 */
export function findDropletBulkFromHistogram(
  colHist: Int32Array,
  scanLimit: number,
  width: number,
): { maxW: number; centerY: number; topY: number } | null {
  let topY = -1
  for (let y = 0; y < scanLimit; y++) {
    if (colHist[y] > 10) {
      topY = y
      break
    }
  }
  if (topY === -1) return null

  let maxW = 0
  let centerY = topY
  const searchDepth = Math.min(scanLimit, topY + Math.floor(colHist.length * 0.62))
  let belowPeak = 0
  for (let y = topY; y < searchDepth; y++) {
    const w = colHist[y]
    if (w > maxW) {
      maxW = w
      centerY = y
      belowPeak = 0
    } else if (maxW > 40 && w < maxW * 0.72) {
      belowPeak++
      // 单行变细可能是中部高光分裂，多行持续变细才结束搜索
      if (belowPeak >= 5) break
    } else {
      belowPeak = 0
    }
  }

  if (maxW < 20 || maxW > width * 0.9) return null

  return { maxW, centerY, topY }
}

/**
 * 典型高速摄影：亮背景 + 暗液滴 + 下方镜面倒影，二者之间有一条亮间隙。
 * 撞击面基准线取该间隙在竖直方向上的中线（液滴底与倒影顶的对称轴）。
 */
export function findBaselineInReflectionGap(
  colHist: Int32Array,
  scanLimit: number,
  bulk: { centerY: number; maxW: number },
): number | null {
  const { centerY, maxW } = bulk
  const sig = Math.max(12, Math.floor(maxW * 0.14))

  let y = centerY
  let mainBottom = centerY
  while (y < scanLimit && colHist[y] >= sig) {
    mainBottom = y
    y++
  }

  while (y < scanLimit && colHist[y] < sig) {
    y++
  }
  const gapStart = mainBottom + 1
  const gapRows = y - gapStart
  if (gapRows < 2 || y >= scanLimit) return null

  const reflTop = y
  let reflDepth = 0
  for (let yy = reflTop; yy < Math.min(scanLimit, reflTop + 14); yy++) {
    if (colHist[yy] >= sig) reflDepth++
    else break
  }
  if (reflDepth < 2) return null

  return Math.floor((mainBottom + reflTop) / 2)
}

/**
 * 在撞击面以上-only 区域，用各行弦宽加权估计圆心与直径像素。
 * 横向灰带 / 阈值泄漏可能导致单行包络接近全宽，不能用 max(colHist) 作直径；剔除异常大行后，
 * 直径用偏高弦高分位（约接近最大弦）与中位数混合，避免仅用 median 在「撞击面上方半截弧」上系统性偏小。
 */
export function estimateDropletDiskAboveSurface(
  colHist: Int32Array,
  cxAtRow: Float32Array,
  topY: number,
  surfaceY: number,
  width: number,
): { cx: number; cy: number; radius: number; dPx: number } | null {
  const margin = Math.max(4, Math.min(14, Math.floor(surfaceY * 0.006)))
  const yMax = Math.floor(surfaceY) - margin
  if (yMax <= topY + 10) return null

  let rawMax = 0
  for (let y = topY; y < yMax; y++) {
    rawMax = Math.max(rawMax, colHist[y])
  }
  if (rawMax < 12) return null

  const enterThr = Math.max(12, Math.floor(rawMax * 0.18))
  let yBodyStart = topY
  for (let y = topY; y < yMax; y++) {
    if (colHist[y] >= enterThr) {
      yBodyStart = y
      break
    }
  }

  const chordThr = Math.max(5, Math.floor(rawMax * 0.065))
  const bandWidths: number[] = []
  for (let y = yBodyStart; y < yMax; y++) {
    const w = colHist[y]
    if (w >= chordThr) bandWidths.push(w)
  }
  if (bandWidths.length === 0) return null
  bandWidths.sort((a, b) => a - b)
  const medianChord = medianOfSorted(bandWidths)
  if (medianChord < 14 || medianChord > width * 0.52) return null

  let outlierCap = Math.min(
    Math.floor(width * 0.42),
    Math.max(Math.floor(medianChord * 1.82), medianChord + 38),
  )

  const accumulate = (cap: number) => {
    let sumWY = 0
    let sumW = 0
    let sumCXW = 0
    const clean: number[] = []
    for (let y = yBodyStart; y < yMax; y++) {
      const w = colHist[y]
      if (w < chordThr || w > cap) continue
      clean.push(w)
      sumWY += y * w
      sumW += w
      sumCXW += cxAtRow[y] * w
    }
    return { sumWY, sumW, sumCXW, clean }
  }

  let { sumWY, sumW, sumCXW, clean } = accumulate(outlierCap)
  if (sumW < 1e-3 || clean.length === 0) {
    outlierCap = Math.min(Math.floor(width * 0.5), Math.floor(medianChord * 2.35))
    ;({ sumWY, sumW, sumCXW, clean } = accumulate(outlierCap))
  }
  if (sumW < 1e-3 || clean.length === 0) return null

  clean.sort((a, b) => a - b)
  const med = medianOfSorted(clean)
  const p82 = percentileOfSorted(clean, 0.82)
  const p91 = percentileOfSorted(clean, 0.91)
  const dPx = Math.max(14, Math.round(0.2 * med + 0.45 * p82 + 0.35 * p91))

  return {
    cx: sumCXW / sumW,
    cy: sumWY / sumW,
    radius: Math.max(1, dPx / 2),
    dPx,
  }
}

/** 未检测到倒影间隙时的兜底：允许穿过 colHist=0 的亮带继续向下找窄颈。 */
export function findNeckYFromHistogram(
  colHist: Int32Array,
  centerY: number,
  maxW: number,
  scanLimit: number,
): number {
  let neckY = centerY
  let minW = maxW
  for (let y = centerY; y < scanLimit; y++) {
    const w = colHist[y]
    if (w === 0) {
      neckY = y
      continue
    }
    if (w <= minW) {
      minW = w
      neckY = y
    }
    if (minW > 10 && w > minW * 1.1) break
  }
  if (neckY === centerY) neckY = Math.floor(centerY + maxW / 2)
  return neckY
}

/** 与自动标定完全一致的液滴圆盘拟合结果 */
export interface DropletDiskFitResult {
  cx: number
  cy: number
  radius: number
  dPx: number
  /** 用于截取液滴主体的撞击面 y（自动检测到的基准线，或由调用方传入的 surfaceY） */
  baselineY: number
}

/**
 * 单帧图像上的液滴拟合：直方图、bulk、基准线、`estimateDropletDiskAboveSurface` 与自动标定同源。
 * @param options.surfaceY 若已标定撞击面（与画布里红线一致），撞击速度分析务必传入，否则撞击前帧常无倒影会导致基准误判。
 */
export function fitDropletDiskFromImageData(
  imageData: ImageData,
  threshold: number,
  dropletIsBright: boolean,
  options?: {
    scanLimitFrac?: number
    xMarginFrac?: number
    surfaceY?: number | null
  },
): DropletDiskFitResult | null {
  const width = imageData.width
  const height = imageData.height
  if (width === 0 || height === 0) return null

  const hist = buildForegroundRowHistogram(imageData, threshold, dropletIsBright, {
    scanLimitFrac: options?.scanLimitFrac ?? 0.95,
    xMarginFrac: options?.xMarginFrac ?? 0.06,
  })
  if (!hist) return null

  const bulk = findDropletBulkFromHistogram(hist.colHist, hist.scanLimit, width)
  if (!bulk) return null

  const { maxW, centerY } = bulk
  const sy = options?.surfaceY
  const baselineY =
    sy != null && Number.isFinite(sy)
      ? Math.round(sy)
      : (findBaselineInReflectionGap(hist.colHist, hist.scanLimit, bulk) ??
        findNeckYFromHistogram(hist.colHist, centerY, maxW, hist.scanLimit))

  const disk = estimateDropletDiskAboveSurface(
    hist.colHist,
    hist.cxAtRow,
    bulk.topY,
    baselineY,
    width,
  )
  const dPx = disk?.dPx ?? maxW
  const cx = disk?.cx ?? hist.cxAtRow[centerY]
  const cy = disk?.cy ?? centerY
  const radius = disk?.radius ?? Math.max(1, dPx / 2)

  return { cx, cy, radius, dPx, baselineY }
}
