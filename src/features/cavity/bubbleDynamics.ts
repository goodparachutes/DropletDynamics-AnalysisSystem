import type { CalibrationPoint } from '../../types/analysis'
import type { AnalysisRegionRect } from '../analysis/analysisRegion'
import { cropImageData } from '../analysis/analysisRegion'
import { imageDataToGrayUint8, traceMooreOuterContour } from '../analysis/dropletContour'
import { binaryClosing3x3Iterations, binaryClosingDisk } from '../analysis/contourMorphology'
import {
  MOORE_OUTER_CONTOUR_MIN_POINTS,
  smoothClosedOuterContourPxForDisplay,
} from '../analysis/surfaceEnergy'
import savitzkyGolay from 'ml-savitzky-golay'
import type {
  CavityDynamicsFrameResult,
  CavityPipelineDebug,
  CavityStopReason,
} from '../../types/cavityDynamics'

const SG_POLY = 3

/** 轮廓包围盒 (ymax−ymin)/(xmax−xmin)；超出则视为抓到细长/扁片杂质 */
export const CAVITY_ASPECT_RATIO_MIN = 0.2
export const CAVITY_ASPECT_RATIO_MAX = 5.0

/** 写入 failedReason，供序列终止判断 */
export const CAVITY_DEBRIS_AR_FLAG = '非气泡杂质（长宽比护栏）'

/** ROI 内 CLAHE：Otsu 之前做限制对比度均衡，压局部极值、锐化界面灰度跳变（tile×clip） */
const CAVITY_CLAHE_TILE = 16
const CAVITY_CLAHE_CLIP = 4
/** Otsu 二值分界松弛 ε：暗泡放宽上界 g≤T+ε，亮泡放宽下界 g>T−ε，糊住腔内弱高光孔 */
const CAVITY_OTSU_RELAX_EPS_DEFAULT = 20
/** 圆盘闭运算默认半径（px），与常见镜面高光尺度同量级；过大易吞细节 */
const CAVITY_MORPH_DISK_RADIUS_DEFAULT = 6

export function isCavityDebrisAspectFailure(row: CavityDynamicsFrameResult): boolean {
  return row.failedReason?.includes(CAVITY_DEBRIS_AR_FLAG) ?? false
}

function normalizeSgWindow(ws: number): number {
  let w = Math.round(ws)
  if (w < 5) w = 5
  if (w % 2 === 0) w += 1
  return w
}

/** Otsu 阈值（0–255） */
export function otsuThresholdGray(gray: Uint8Array): number {
  const hist = new Uint32Array(256)
  const n = gray.length
  if (n === 0) return 128
  for (let i = 0; i < n; i++) hist[gray[i]!]++

  let sumAll = 0
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]!

  let sumB = 0
  let wB = 0
  let maxVar = -1
  let thresh = 128

  for (let t = 0; t < 256; t++) {
    wB += hist[t]!
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += t * hist[t]!
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > maxVar) {
      maxVar = between
      thresh = t
    }
  }
  return thresh
}

/**
 * CLAHE（8 位灰度）：分块直方图裁剪 + 双线性插值映射。
 * tileSize：块边长像素；clipLimit：典型 2–4。
 */
export function claheGray8(
  src: Uint8Array,
  width: number,
  height: number,
  tileSize = 16,
  clipLimit = 3,
): Uint8Array {
  const tw = Math.max(8, Math.min(tileSize, width))
  const th = Math.max(8, Math.min(tileSize, height))
  const tilesX = Math.max(1, Math.ceil(width / tw))
  const tilesY = Math.max(1, Math.ceil(height / th))

  const mapTiles: Uint8Array[] = []
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tw
      const y0 = ty * th
      const x1 = Math.min(width, x0 + tw)
      const y1 = Math.min(height, y0 + th)
      const tilePixels = (x1 - x0) * (y1 - y0)
      const hist = new Uint32Array(256)
      for (let y = y0; y < y1; y++) {
        const row = y * width
        for (let x = x0; x < x1; x++) hist[src[row + x]!]++
      }

      const clip = Math.max(1, Math.round((clipLimit * tilePixels) / 256))
      let clipped = 0
      for (let i = 0; i < 256; i++) {
        if (hist[i]! > clip) {
          clipped += hist[i]! - clip
          hist[i] = clip
        }
      }
      const redistribute = clipped > 0 ? Math.floor(clipped / 256) : 0
      let rem = clipped - redistribute * 256
      for (let i = 0; i < 256; i++) hist[i]! += redistribute
      for (let i = 0; rem > 0 && i < 256; i++, rem--) hist[i]!++

      const cdf = new Uint32Array(256)
      cdf[0] = hist[0]!
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1]! + hist[i]!

      const lut = new Uint8Array(256)
      const denom = Math.max(1, cdf[255]!)
      for (let i = 0; i < 256; i++) {
        lut[i] = Math.round((cdf[i]! * 255) / denom)
      }
      mapTiles.push(lut)
    }
  }

  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / tw - 0.5
      const fy = (y + 0.5) / th - 0.5
      const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(fx)))
      const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(fy)))
      const tx1 = Math.min(tilesX - 1, tx0 + 1)
      const ty1 = Math.min(tilesY - 1, ty0 + 1)
      const wx = fx - tx0
      const wy = fy - ty0

      const lut00 = mapTiles[ty0 * tilesX + tx0]!
      const lut01 = mapTiles[ty0 * tilesX + tx1]!
      const lut10 = mapTiles[ty1 * tilesX + tx0]!
      const lut11 = mapTiles[ty1 * tilesX + tx1]!
      const v = src[y * width + x]!
      const a = lut00[v]!
      const b = lut01[v]!
      const c = lut10[v]!
      const d = lut11[v]!
      const top = a + wx * (b - a)
      const bot = c + wx * (d - c)
      out[y * width + x] = Math.round(top + wy * (bot - top))
    }
  }
  return out
}

function largestComponentMask(mask: Uint8Array, w: number, h: number): Uint8Array | null {
  const n = w * h
  const labels = new Int32Array(n).fill(-1)
  let bestLabel = -1
  let bestCount = 0

  let nextLabel = 0
  for (let i = 0; i < n; i++) {
    if (mask[i] !== 1 || labels[i] >= 0) continue
    const stack = [i]
    let count = 0
    while (stack.length) {
      const j = stack.pop()!
      if (labels[j] >= 0) continue
      if (mask[j] !== 1) continue
      labels[j] = nextLabel
      count++
      const x = j % w
      const yy = (j / w) | 0
      if (x > 0) stack.push(j - 1)
      if (x + 1 < w) stack.push(j + 1)
      if (yy > 0) stack.push(j - w)
      if (yy + 1 < h) stack.push(j + w)
    }
    if (count > bestCount) {
      bestCount = count
      bestLabel = nextLabel
    }
    nextLabel++
  }

  if (bestLabel < 0 || bestCount < 1) return null
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (labels[i] === bestLabel) out[i] = 1
  }
  return out
}

function touchesRoiBorder(comp: Uint8Array, w: number, h: number): boolean {
  for (let x = 0; x < w; x++) {
    if (comp[x] === 1 || comp[(h - 1) * w + x] === 1) return true
  }
  for (let y = 0; y < h; y++) {
    if (comp[y * w] === 1 || comp[y * w + (w - 1)] === 1) return true
  }
  return false
}

function countForeground(comp: Uint8Array): number {
  let c = 0
  for (let i = 0; i < comp.length; i++) if (comp[i] === 1) c++
  return c
}

function contourCentroidPx(contour: CalibrationPoint[]): { x: number; y: number } {
  let sx = 0
  let sy = 0
  const n = contour.length - 1
  const m = contour[0]!.x === contour[contour.length - 1]!.x ? n : contour.length
  for (let i = 0; i < m; i++) {
    sx += contour[i]!.x
    sy += contour[i]!.y
  }
  const d = Math.max(1, m)
  return { x: sx / d, y: sy / d }
}

function bboxAspectRatio(contour: CalibrationPoint[]): number | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of contour) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const bw = maxX - minX
  const bh = maxY - minY
  if (!(bw > 1e-6 && bh > 1e-6)) return null
  return bh / bw
}

/** 周期闭合索引下的离散曲率（1/px） */
function curvatureAtRingIndex(ring: CalibrationPoint[], i: number): number {
  const n = ring.length
  if (n < 3) return 0
  const im = (i - 1 + n) % n
  const ip = (i + 1) % n
  const xm = ring[im]!.x
  const ym = ring[im]!.y
  const x0 = ring[i]!.x
  const y0 = ring[i]!.y
  const xp = ring[ip]!.x
  const yp = ring[ip]!.y
  const xp1 = (xp - xm) / 2
  const yp1 = (yp - ym) / 2
  const xpp = xp - 2 * x0 + xm
  const ypp = yp - 2 * y0 + ym
  const num = xp1 * ypp - yp1 * xpp
  const den = Math.pow(xp1 * xp1 + yp1 * yp1, 1.5)
  return den > 1e-9 ? num / den : 0
}

/** 图像「最上侧」轮廓点（y 最小）附近平均曲率（平滑后链） */
function apexCurvaturePerPx(smoothClosed: CalibrationPoint[]): number | null {
  const ring =
    smoothClosed.length >= 2 &&
    smoothClosed[0]!.x === smoothClosed[smoothClosed.length - 1]!.x &&
    smoothClosed[0]!.y === smoothClosed[smoothClosed.length - 1]!.y
      ? smoothClosed.slice(0, -1)
      : [...smoothClosed]
  if (ring.length < 8) return null
  const band = Math.max(2, (ring.length * 0.04) | 0)
  let apexIdx = 0
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    if (ring[i]!.y < best) {
      best = ring[i]!.y
      apexIdx = i
    }
  }
  let acc = 0
  let cnt = 0
  for (let k = -band; k <= band; k++) {
    const j = (apexIdx + k + ring.length) % ring.length
    acc += curvatureAtRingIndex(ring, j)
    cnt++
  }
  return cnt > 0 ? acc / cnt : null
}

export interface CavityExtractOptions {
  mmPerPx: number
  minPixels: number
  invertOtsu: boolean
  bubbleDark: boolean
  surfaceYPx: number | null
  /** SG 平滑窗口（奇数） */
  sgWindow?: number
  /** 单元测试：跳过 CLAHE，避免 Node 环境与极端平坦区数值差异 */
  skipClahe?: boolean
  /** Otsu 后二值松弛 ε（0–60），默认 20；见暗泡 g≤T+ε / 亮泡 g>T−ε */
  otsuRelaxEpsilon?: number
  /** 圆盘闭运算半径（px），默认 6 并按 ROI 短边上限裁剪 */
  morphCloseDiskRadiusPx?: number
  /** 为 UI 调试返回 Otsu/轮廓等中间结果（批量分析勿开，避免额外分配） */
  includePipelineDebug?: boolean
}

function grayMinMax(gray: Uint8Array): { grayMin: number; grayMax: number } {
  let grayMin = 255
  let grayMax = 0
  for (let i = 0; i < gray.length; i++) {
    const g = gray[i]!
    if (g < grayMin) grayMin = g
    if (g > grayMax) grayMax = g
  }
  return { grayMin, grayMax }
}

/**
 * 对单帧全幅 RGBA：在 ROI 内 CLAHE + Otsu 二值 → 最大连通域 → Moore 外轮廓 → 几何量。
 * 坐标输出为**全图画布**像素系（ROI 已偏移）。
 */
export function extractCavityMetricsOneFrame(
  fullImageData: ImageData,
  roi: AnalysisRegionRect,
  opts: CavityExtractOptions,
): Omit<
  CavityDynamicsFrameResult,
  'frameIndex' | 'timeSec' | 'vrMmPerS' | 'vrAbsMmPerS' | 'vCentroidMmPerS' | 'deltaPLaplacePa'
> & {
  touchesRoiBorder: boolean
  pipelineDebug?: CavityPipelineDebug
} {
  const mm = opts.mmPerPx
  const wantDbg = Boolean(opts.includePipelineDebug)
  const sgWinDefault = normalizeSgWindow(opts.sgWindow ?? 9)
  const emptyBase = {
    areaMm2: null,
    reqMm: null,
    xcPx: null,
    ycPx: null,
    zcMm: null,
    aspectRatio: null,
    kappaApexPerPx: null,
    kappaApexPerMm: null,
    pixelArea: null,
    touchesRoiBorder: false,
    failedReason: undefined as string | undefined,
  }

  const dbgShell = (patch: Partial<CavityPipelineDebug>): CavityPipelineDebug => ({
    otsuThreshold: -1,
    grayMin: -1,
    grayMax: -1,
    claheApplied: !opts.skipClahe,
    morphCloseIterations: 0,
    morphCloseDiskRadiusPx: 0,
    otsuRelaxEpsilon: 0,
    largestComponentPixels: null,
    moorePointCount: null,
    sgWindow: sgWinDefault,
    rawContourCanvas: [],
    smoothContourCanvas: [],
    ...patch,
  })

  if (!(roi.w >= 8 && roi.h >= 8 && mm > 0)) {
    return {
      ...emptyBase,
      failedReason: 'ROI 或标定无效',
      ...(wantDbg ? { pipelineDebug: dbgShell({}) } : {}),
    }
  }

  const crop = cropImageData(fullImageData, roi)
  const gray0 = imageDataToGrayUint8(crop)
  const w = crop.width
  const h = crop.height
  /** 方案一：仅在 ROI 裁剪后、Otsu 之前做 CLAHE（紫框内局部增强） */
  const gray = opts.skipClahe ? gray0 : claheGray8(gray0, w, h, CAVITY_CLAHE_TILE, CAVITY_CLAHE_CLIP)
  const gm = wantDbg ? grayMinMax(gray) : { grayMin: -1, grayMax: -1 }

  const otsuEps = Math.max(0, Math.min(60, Math.round(opts.otsuRelaxEpsilon ?? CAVITY_OTSU_RELAX_EPS_DEFAULT)))
  const morphRDefault = opts.morphCloseDiskRadiusPx ?? CAVITY_MORPH_DISK_RADIUS_DEFAULT
  const morphR = Math.max(0, Math.min(24, Math.min(morphRDefault, Math.floor(Math.min(w, h) / 4))))

  let thr = otsuThresholdGray(gray)
  let mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const g = gray[i]!
    /**
     * 方案二：分界松弛 ε — 暗泡前景 g≤T+ε；亮泡前景 g>T−ε（invert 前定义）。
     * 将腔内略高于 T 但仍偏暗的灰度并入流体，削弱镜面弱孔对 Moore 外轮廓的切割。
     */
    const fg = opts.bubbleDark
      ? (g <= Math.min(255, thr + otsuEps) ? 1 : 0)
      : (g > Math.max(0, thr - otsuEps) ? 1 : 0)
    mask[i] = fg
  }
  if (opts.invertOtsu) {
    for (let i = 0; i < mask.length; i++) mask[i] = mask[i] === 1 ? 0 : 1
  }

  /** 方案三：圆盘闭运算（半径与亮点尺度相当），弥合小孔；再 3×3×1 轻抹锯齿 */
  mask =
    morphR > 0
      ? new Uint8Array(binaryClosingDisk(mask, w, h, morphR))
      : new Uint8Array(mask)
  mask = new Uint8Array(binaryClosing3x3Iterations(mask, w, h, 1))

  const morphDbg = {
    morphCloseDiskRadiusPx: morphR,
    otsuRelaxEpsilon: otsuEps,
    morphCloseIterations: 1,
  } as const

  const comp = largestComponentMask(mask, w, h)
  if (!comp) {
    return {
      ...emptyBase,
      failedReason: '无前景连通域',
      ...(wantDbg
        ? {
            pipelineDebug: dbgShell({
              otsuThreshold: thr,
              grayMin: gm.grayMin,
              grayMax: gm.grayMax,
              ...morphDbg,
            }),
          }
        : {}),
    }
  }

  const pxArea = countForeground(comp)
  if (pxArea < opts.minPixels) {
    return {
      ...emptyBase,
      pixelArea: pxArea,
      failedReason: `面积低于阈值 (${pxArea} < ${opts.minPixels})`,
      ...(wantDbg
        ? {
            pipelineDebug: dbgShell({
              otsuThreshold: thr,
              grayMin: gm.grayMin,
              grayMax: gm.grayMax,
              largestComponentPixels: pxArea,
              ...morphDbg,
            }),
          }
        : {}),
    }
  }

  const borderTouch = touchesRoiBorder(comp, w, h)

  const contourCrop = traceMooreOuterContour(comp, w, h)
  if (!contourCrop || contourCrop.length < MOORE_OUTER_CONTOUR_MIN_POINTS) {
    return {
      ...emptyBase,
      pixelArea: pxArea,
      touchesRoiBorder: borderTouch,
      failedReason: 'Moore 轮廓无效或未闭合',
      ...(wantDbg
        ? {
            pipelineDebug: dbgShell({
              otsuThreshold: thr,
              grayMin: gm.grayMin,
              grayMax: gm.grayMax,
              largestComponentPixels: pxArea,
              moorePointCount: contourCrop ? contourCrop.length : 0,
              ...morphDbg,
            }),
          }
        : {}),
    }
  }

  const arCrop = bboxAspectRatio(contourCrop)
  if (
    arCrop != null &&
    Number.isFinite(arCrop) &&
    (arCrop < CAVITY_ASPECT_RATIO_MIN || arCrop > CAVITY_ASPECT_RATIO_MAX)
  ) {
    return {
      ...emptyBase,
      pixelArea: pxArea,
      touchesRoiBorder: borderTouch,
      aspectRatio: arCrop,
      failedReason: `${CAVITY_DEBRIS_AR_FLAG}：AR=${arCrop.toFixed(4)}，允许 [${CAVITY_ASPECT_RATIO_MIN}, ${CAVITY_ASPECT_RATIO_MAX}]`,
      ...(wantDbg
        ? {
            pipelineDebug: dbgShell({
              otsuThreshold: thr,
              grayMin: gm.grayMin,
              grayMax: gm.grayMax,
              largestComponentPixels: pxArea,
              moorePointCount: contourCrop.length,
              ...morphDbg,
            }),
          }
        : {}),
    }
  }

  const ox = roi.x
  const oy = roi.y
  const contourFull: CalibrationPoint[] = contourCrop.map((p) => ({ x: p.x + ox, y: p.y + oy }))

  const ws = normalizeSgWindow(opts.sgWindow ?? 9)
  const smoothFull = smoothClosedOuterContourPxForDisplay(contourFull, {
    windowSize: ws,
    polynomial: SG_POLY,
    preserveRawNearBaselinePx: 0,
  })

  /** 物理面积 mm²：最大连通域像素数 × (mm/px)²，与 A_b 一致 */
  const areaMm2 = pxArea * mm * mm
  /** 等效圆半径 mm：R_eq = √(A_b/π)，与面积同源；非对轮廓单独拟合的圆 */
  const reqMm = Math.sqrt(Math.max(0, areaMm2) / Math.PI)
  const cen = contourCentroidPx(contourCrop)
  const xcPx = cen.x + ox
  const ycPx = cen.y + oy
  const zcMm =
    opts.surfaceYPx != null && Number.isFinite(opts.surfaceYPx)
      ? (opts.surfaceYPx - ycPx) * mm
      : null

  const kap = apexCurvaturePerPx(smoothFull)
  /** κ_mm = κ_px / s，s = mm/px（曲率为长度倒数，须除以标定尺度） */
  const kapMm = kap != null && mm > 0 ? kap / mm : null

  return {
    areaMm2,
    reqMm,
    xcPx,
    ycPx,
    zcMm,
    aspectRatio: arCrop,
    kappaApexPerPx: kap,
    kappaApexPerMm: kapMm,
    pixelArea: pxArea,
    touchesRoiBorder: borderTouch,
    failedReason: undefined,
    ...(wantDbg
      ? {
          pipelineDebug: dbgShell({
            otsuThreshold: thr,
            grayMin: gm.grayMin,
            grayMax: gm.grayMax,
            largestComponentPixels: pxArea,
            moorePointCount: contourCrop.length,
            sgWindow: ws,
            rawContourCanvas: contourFull.map((p) => ({ x: p.x, y: p.y })),
            smoothContourCanvas: smoothFull.map((p) => ({ x: p.x, y: p.y })),
            ...morphDbg,
          }),
        }
      : {}),
  }
}

/** 对时间序列补算 V_r、V_z、ΔP（SG 平滑 + 中心差分） */
export function postprocessCavityDynamicsSeries(
  frames: CavityDynamicsFrameResult[],
  fps: number,
  sigmaNm: number,
): CavityDynamicsFrameResult[] {
  const dt = 1 / Math.max(1e-6, fps)
  const n = frames.length
  if (n === 0) return frames

  const req = frames.map((f) => (f.reqMm != null && Number.isFinite(f.reqMm) ? f.reqMm : NaN))
  const zc = frames.map((f) => (f.zcMm != null && Number.isFinite(f.zcMm) ? f.zcMm : NaN))

  let ws = normalizeSgWindow(Math.min(15, Math.max(5, (n / 6) | 1)))
  if (ws > n) ws = n % 2 === 1 ? n : n - 1
  if (ws < 5) ws = Math.min(5, n % 2 === 1 ? n : n - 1)

  const smoothSeries = (arr: number[]): number[] => {
    if (arr.every((v) => !Number.isFinite(v))) return arr
    const seg = arr.map((v) => (Number.isFinite(v) ? v : 0))
    let win = ws
    if (win > seg.length) win = seg.length % 2 === 1 ? seg.length : seg.length - 1
    if (win < 5) return arr
    try {
      const s = savitzkyGolay(seg, 1, {
        windowSize: win,
        polynomial: Math.min(SG_POLY, win - 2),
        derivative: 0,
        pad: 'post',
        padValue: 'replicate',
      }) as number[]
      if (s.length !== seg.length) return arr
      return arr.map((v, i) => (Number.isFinite(v) ? (s[i] as number) : NaN))
    } catch {
      return arr
    }
  }

  const reqS = smoothSeries(req)
  const zcS = smoothSeries(zc)

  const centralVel = (s: number[], i: number): number | null => {
    if (i <= 0 || i >= n - 1) return null
    const a = s[i - 1]!
    const b = s[i + 1]!
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    return (b - a) / (2 * dt)
  }

  const out = frames.map((f, i) => {
    const Rm = f.reqMm != null ? f.reqMm / 1000 : null
    const deltaP =
      Rm != null && Rm > 1e-9 && Number.isFinite(sigmaNm) ? (2 * sigmaNm) / Rm : null

    let vr: number | null = null
    if (f.reqMm != null && Number.isFinite(reqS[i]!)) {
      vr = centralVel(reqS, i)
    }
    const vrAbs = vr != null && Number.isFinite(vr) ? Math.abs(vr) : null

    let vz: number | null = null
    if (f.zcMm != null && Number.isFinite(zcS[i]!)) {
      vz = centralVel(zcS, i)
    }

    return {
      ...f,
      vrMmPerS: vr,
      vrAbsMmPerS: vrAbs,
      vCentroidMmPerS: vz,
      deltaPLaplacePa: deltaP,
    }
  })

  return out
}

/** 解码 / 流水线失败时的占位（与 extract 返回形状一致） */
export function cavityExtractFailure(
  reason: string,
): ReturnType<typeof extractCavityMetricsOneFrame> {
  return {
    areaMm2: null,
    reqMm: null,
    xcPx: null,
    ycPx: null,
    zcMm: null,
    aspectRatio: null,
    kappaApexPerPx: null,
    kappaApexPerMm: null,
    pixelArea: null,
    touchesRoiBorder: false,
    failedReason: reason,
  }
}

export function mergeFrameMeta(
  partial: ReturnType<typeof extractCavityMetricsOneFrame>,
  frameIndex: number,
  timeSec: number,
): CavityDynamicsFrameResult {
  const { touchesRoiBorder: _t, pipelineDebug: _dbg, ...rest } = partial
  void _t
  void _dbg
  const { failedReason, ...metrics } = rest
  return {
    frameIndex,
    timeSec,
    ...metrics,
    vrMmPerS: null,
    vrAbsMmPerS: null,
    vCentroidMmPerS: null,
    deltaPLaplacePa: null,
    failedReason,
  }
}

/** 溃灭终止：连通域像素低于阈值（已在 extract 中报错文案） */
export function collapseStopReasonFromRow(row: CavityDynamicsFrameResult): CavityStopReason | null {
  return row.failedReason?.includes('面积低于') ? 'collapse_area' : null
}
