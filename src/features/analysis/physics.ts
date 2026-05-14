import type { AnalysisPoint, CalibrationPoint } from '../../types/analysis'
import { isDropletGray } from './dropletBinary'
import { createCubicSpline } from './spline'

export function findSubPixelEdgePeak(
  profile: Float32Array,
  start: number,
  end: number,
  isLeft: boolean,
): number {
  let maxG = -1
  let peak = -1
  for (let x = Math.round(start); x < Math.round(end); x++) {
    if (x < 1 || x >= profile.length - 2) continue
    const g = Math.abs(profile[x + 1] - profile[x - 1])
    if (g > maxG) {
      maxG = g
      peak = x
    }
  }
  if (peak === -1) return -1
  const g1 = Math.abs(profile[peak] - profile[peak - 1])
  const g2 = Math.abs(profile[peak + 1] - profile[peak])
  const g3 = Math.abs(profile[peak + 2] - profile[peak + 1])
  const den = 2 * (g1 - 2 * g2 + g3)
  const shift = Math.abs(den) > 1e-6 ? (g1 - g3) / den : 0
  return peak + shift + (isLeft ? -0.35 : 0.35)
}

/**
 * 从左向右第一条「背景→液滴」阈值穿越（气–液外边界），避免在局部窗口内取最大梯度时误抓内部高光边。
 */
function outerEdgeXFromLeft(
  smooth: Float32Array,
  thr: number,
  dropletIsBright: boolean,
  xMin: number,
  xMax: number,
): number {
  const lo = Math.max(2, Math.floor(xMin))
  const hi = Math.min(smooth.length - 3, Math.ceil(xMax))
  for (let x = lo; x <= hi; x++) {
    if (!isDropletGray(smooth[x], thr, dropletIsBright)) continue
    if (!isDropletGray(smooth[x - 1], thr, dropletIsBright)) {
      return findSubPixelEdgePeak(smooth, x - 3, x + 4, true)
    }
  }
  return -1
}

/** 从右向左第一条「背景→液滴」穿越（外侧右缘） */
function outerEdgeXFromRight(
  smooth: Float32Array,
  thr: number,
  dropletIsBright: boolean,
  xMin: number,
  xMax: number,
): number {
  const lo = Math.max(2, Math.floor(xMin))
  const hi = Math.min(smooth.length - 3, Math.ceil(xMax))
  for (let x = hi; x >= lo; x--) {
    if (!isDropletGray(smooth[x], thr, dropletIsBright)) continue
    if (!isDropletGray(smooth[x + 1], thr, dropletIsBright)) {
      return findSubPixelEdgePeak(smooth, x - 4, x + 3, false)
    }
  }
  return -1
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function smoothProfile(profile: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(profile.length)
  for (let i = 0; i < profile.length; i++) {
    let sum = 0
    let count = 0
    for (let k = -radius; k <= radius; k++) {
      const idx = i + k
      if (idx < 0 || idx >= profile.length) continue
      sum += profile[idx]
      count++
    }
    out[i] = count > 0 ? sum / count : profile[i]
  }
  return out
}

/** 基准行上连续「判为液滴」的区间（用于区分主液滴与两侧倒影/噪声条带） */
function collectForegroundRunsOnBaseline(
  profile: Float32Array,
  threshold: number,
  dropletIsBright: boolean,
): Array<{ start: number; end: number }> {
  const soft = dropletIsBright ? -20 : 20
  const thr = threshold + soft
  const w = profile.length
  const runs: Array<{ start: number; end: number }> = []
  let x = 0
  while (x < w) {
    while (x < w && !isDropletGray(profile[x], thr, dropletIsBright)) x++
    if (x >= w) break
    const start = x
    while (x < w && isDropletGray(profile[x], thr, dropletIsBright)) x++
    runs.push({ start, end: x - 1 })
  }
  return runs
}

/**
 * 在基准行多条前景带中选一对接触脚：优先宽度接近上一帧 `hintWidthPx`、且几何中心靠近画幅中心，
 * 避免「从左第一个像素」落到远处倒影上导致整轨向上跟错边。
 */
function pickBaselineContactSeeds(
  baselineProfile: Float32Array,
  width: number,
  threshold: number,
  dropletIsBright: boolean,
  hintWidthPx: number,
): { seedL: number; seedR: number } | null {
  const runs = collectForegroundRunsOnBaseline(baselineProfile, threshold, dropletIsBright)
  const mid = width / 2
  const maxCenterDist = width * 0.36
  const cands: Array<{ seedL: number; seedR: number; score: number }> = []

  for (const run of runs) {
    const span = run.end - run.start + 1
    if (span < 7) continue
    const seedL = findSubPixelEdgePeak(
      baselineProfile,
      Math.max(2, run.start - 16),
      Math.min(width - 3, run.start + 12),
      true,
    )
    const seedR = findSubPixelEdgePeak(
      baselineProfile,
      Math.max(2, run.end - 12),
      Math.min(width - 3, run.end + 16),
      false,
    )
    if (seedL === -1 || seedR === -1) continue
    const runW = seedR - seedL
    if (runW < 12 || runW > width * 0.56) continue
    const cx = (seedL + seedR) / 2
    if (Math.abs(cx - mid) > maxCenterDist) continue

    let score = Math.abs(cx - mid) / width
    if (hintWidthPx >= 10) {
      const ratio = runW / hintWidthPx
      if (ratio < 0.38 || ratio > 2.4) continue
      score += Math.abs(runW - hintWidthPx) / Math.max(hintWidthPx, 40)
    } else {
      score -= (runW / width) * 0.06
    }
    cands.push({ seedL, seedR, score })
  }

  if (cands.length === 0) return null
  cands.sort((a, b) => a.score - b.score)
  return { seedL: cands[0].seedL, seedR: cands[0].seedR }
}

/** 按 x 的 IQR 去掉飞点（倒影轨、误跟踪） */
function tukeyFenceFilterContourByX(pts: CalibrationPoint[]): CalibrationPoint[] {
  if (pts.length < 6) return pts
  const xs = [...pts.map((p) => p.x)].sort((a, b) => a - b)
  const q1 = xs[Math.floor(xs.length * 0.25)]
  const q3 = xs[Math.floor(xs.length * 0.75)]
  const iqr = Math.max(q3 - q1, 3)
  const low = q1 - 2.2 * iqr
  const high = q3 + 2.2 * iqr
  const next = pts.filter((p) => p.x >= low && p.x <= high)
  return next.length >= 3 ? next : pts
}

function detectEdgePointsLegacy(
  pixels: Uint8ClampedArray,
  width: number,
  startY: number,
  scanH: number,
  threshold: number,
  dropletIsBright: boolean,
  hintWidthPx = 0,
): { leftPts: CalibrationPoint[]; rightPts: CalibrationPoint[] } {
  const profiles: Float32Array[] = []
  for (let r = 0; r < scanH; r++) {
    const prof = new Float32Array(width)
    for (let x = 0; x < width; x++) {
      const idx = (r * width + x) * 4
      prof[x] = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3
    }
    profiles.push(prof)
  }

  const baselineRow = scanH - 1
  const baselineProfile = profiles[baselineRow]
  const mid = width / 2
  const soft = dropletIsBright ? -20 : 20

  const picked = pickBaselineContactSeeds(baselineProfile, width, threshold, dropletIsBright, hintWidthPx)

  let seedL: number
  let seedR: number
  if (picked) {
    seedL = picked.seedL
    seedR = picked.seedR
  } else {
    let cL = -1
    let cR = -1
    for (let x = 10; x < mid - 10; x++) {
      if (isDropletGray(baselineProfile[x], threshold + soft, dropletIsBright)) {
        cL = x
        break
      }
    }
    for (let x = width - 10; x > mid + 10; x--) {
      if (isDropletGray(baselineProfile[x], threshold + soft, dropletIsBright)) {
        cR = x
        break
      }
    }
    if (cL === -1 || cR === -1) return { leftPts: [], rightPts: [] }
    const sl = findSubPixelEdgePeak(baselineProfile, cL - 10, cL + 10, true)
    const sr = findSubPixelEdgePeak(baselineProfile, cR - 10, cR + 10, false)
    if (sl === -1 || sr === -1) return { leftPts: [], rightPts: [] }
    seedL = sl
    seedR = sr
  }

  const leftPts: CalibrationPoint[] = []
  const rightPts: CalibrationPoint[] = []

  // Anchor on baseline first.
  leftPts.push({ x: seedL, y: startY + baselineRow })
  rightPts.push({ x: seedR, y: startY + baselineRow })

  let prevL = seedL
  let prevR = seedR
  const trackWindow = 12
  const maxJumpPx = 7
  for (let r = baselineRow - 1; r >= 0; r--) {
    const prof = profiles[r]
    const sL = findSubPixelEdgePeak(prof, prevL - trackWindow, prevL + trackWindow, true)
    const sR = findSubPixelEdgePeak(prof, prevR - trackWindow, prevR + trackWindow, false)
    if (sL !== -1 && Math.abs(sL - prevL) <= maxJumpPx) {
      leftPts.push({ x: sL, y: startY + r })
      prevL = sL
    }
    if (sR !== -1 && Math.abs(sR - prevR) <= maxJumpPx) {
      rightPts.push({ x: sR, y: startY + r })
      prevR = sR
    }
  }

  const leftF = tukeyFenceFilterContourByX(leftPts)
  const rightF = tukeyFenceFilterContourByX(rightPts)
  return {
    leftPts: leftF.length >= 3 ? leftF : leftPts,
    rightPts: rightF.length >= 3 ? rightF : rightPts,
  }
}

function readGrayProfile(imageData: ImageData, y: number): Float32Array | null {
  const { width, height, data } = imageData
  if (y < 0 || y >= height) return null
  const profile = new Float32Array(width)
  const rowOffset = y * width * 4
  for (let x = 0; x < width; x++) {
    const idx = rowOffset + x * 4
    profile[x] = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
  }
  return smoothProfile(profile, 2)
}

/**
 * 基准线附近是否存在“局部液滴接触”（中间区域有宽度合理的前景带，亮/暗由 dropletIsBright 决定）。
 * 若液滴已弹起、仅有背景/倒影宽带，返回 false → 铺展直径应为 0。
 */
export function baselineHasDropletContact(
  imageData: ImageData,
  surfaceY: number,
  threshold: number,
  dropletIsBright = false,
): boolean {
  const y = Math.round(surfaceY)
  const profile = readGrayProfile(imageData, y)
  if (!profile) return false
  const w = profile.length
  const margin = Math.max(8, Math.floor(w * 0.12))
  const mid = w / 2
  const med = median(Array.from(profile))
  const adapt = dropletIsBright ? Math.max(threshold - 22, med + 8) : Math.min(threshold + 22, med - 8)

  let start = -1
  let bestWidth = 0
  let bestCenterDist = Infinity

  for (let x = margin; x < w - margin; x++) {
    const fg = isDropletGray(profile[x], adapt, dropletIsBright)
    if (fg && start < 0) start = x
    if (!fg && start >= 0) {
      const left = start
      const right = x - 1
      const rw = right - left + 1
      const rc = (left + right) / 2
      if (rw >= 10 && rw < w * 0.58 && Math.abs(rc - mid) < w * 0.24) {
        const cd = Math.abs(rc - mid)
        if (rw > bestWidth || (rw === bestWidth && cd < bestCenterDist)) {
          bestWidth = rw
          bestCenterDist = cd
        }
      }
      start = -1
    }
  }
  return bestWidth >= 10
}

function estimateByNeckSymmetry(
  imageData: ImageData,
  surfaceY: number,
  threshold: number,
  dropletIsBright: boolean,
): { subL: number; subR: number } | null {
  const baseY = Math.round(surfaceY)
  const neckProfile = readGrayProfile(imageData, baseY)
  if (!neckProfile) return null
  const reflProfile = readGrayProfile(imageData, Math.min(imageData.height - 1, baseY + 8))

  const fused = new Float32Array(neckProfile.length)
  for (let i = 0; i < neckProfile.length; i++) {
    const rp = reflProfile ? reflProfile[i] : neckProfile[i]
    fused[i] = neckProfile[i] * 0.68 + rp * 0.32
  }

  let weightSum = 0
  let moment = 0
  for (let x = 0; x < fused.length; x++) {
    const w = dropletIsBright ? fused[x] : Math.max(0, 255 - fused[x])
    weightSum += w
    moment += w * x
  }
  if (weightSum <= 1e-6) return null
  const center = moment / weightSum
  const medF = median(Array.from(fused))
  const adaptiveThreshold = dropletIsBright
    ? Math.max(threshold - 20, medF + 10)
    : Math.min(threshold + 20, medF - 10)

  let leftSeed = -1
  let rightSeed = -1
  for (let x = Math.floor(center); x >= 6; x--) {
    if (isDropletGray(fused[x], adaptiveThreshold, dropletIsBright)) {
      leftSeed = x
      break
    }
  }
  for (let x = Math.ceil(center); x <= fused.length - 7; x++) {
    if (isDropletGray(fused[x], adaptiveThreshold, dropletIsBright)) {
      rightSeed = x
      break
    }
  }
  if (leftSeed === -1 || rightSeed === -1) return null

  const subL = findSubPixelEdgePeak(fused, leftSeed - 10, leftSeed + 10, true)
  const subR = findSubPixelEdgePeak(fused, rightSeed - 10, rightSeed + 10, false)
  if (subL === -1 || subR === -1) return null

  const dL = center - subL
  const dR = subR - center
  const minD = Math.max(1e-6, Math.min(dL, dR))
  const maxD = Math.max(dL, dR)
  const symmetryRatio = maxD / minD
  if (symmetryRatio > 1.7 || subR - subL < 5) return null

  return { subL, subR }
}

export interface PhysicsInput {
  imageData: ImageData
  surfaceY: number
  threshold: number
  /** 液滴较亮、背景偏暗时为 true（二值条件与预览一致） */
  dropletIsBright?: boolean
  absTime: number
  zeroTime: number
  timeScaleFactor: number
  actualD0: number
  pixelScale: number | null
  isAnalyzing: boolean
  /** 上一采样帧的铺展宽度(px)；Legacy 在基准线上从多条前景带里选股脚时优先贴合该宽度 */
  lastWidth: number
  algorithmMode?: 'legacy' | 'neckGradient'
  guidedSearch?: {
    expectedLeft: number
    expectedRight: number
    windowPx?: number
  }
}

/** 在 expectedLeft/Right 附近按行扫描左右轮廓点；竖向范围越大越利于接触角回归 */
function detectGuidedEdgePolylines(
  imageData: ImageData,
  surfaceY: number,
  threshold: number,
  dropletIsBright: boolean,
  expectedLeft: number,
  expectedRight: number,
  windowPx: number,
  dyMin: number,
  dyMax: number,
): { leftPts: CalibrationPoint[]; rightPts: CalibrationPoint[] } {
  const { width, height, data } = imageData
  const leftPts: CalibrationPoint[] = []
  const rightPts: CalibrationPoint[] = []
  const y0 = Math.round(surfaceY)
  for (let dy = dyMin; dy <= dyMax; dy++) {
    const y = y0 + dy
    if (y < 0 || y >= height) continue
    const prof = new Float32Array(width)
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x * 4
      prof[x] = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
    }
    const smooth = smoothProfile(prof, 1)
    const medS = median(Array.from(smooth))
    const localThr = dropletIsBright ? Math.max(threshold - 18, medS + 6) : Math.min(threshold + 18, medS - 6)
    const cL = Math.max(2, Math.floor(expectedLeft - windowPx))
    const cR = Math.min(width - 3, Math.ceil(expectedRight + windowPx))

    const leftScanHi = Math.min(width - 3, Math.ceil(expectedLeft + windowPx * 0.65))
    const rightScanLo = Math.max(2, Math.floor(expectedRight - windowPx * 0.65))
    let subL = outerEdgeXFromLeft(smooth, localThr, dropletIsBright, cL, leftScanHi)
    let subR = outerEdgeXFromRight(smooth, localThr, dropletIsBright, rightScanLo, cR)

    if (subL === -1 || subR === -1 || subR - subL < 5) {
      let seedL = -1
      let seedR = -1
      for (let x = Math.floor(expectedLeft); x >= cL; x--) {
        if (isDropletGray(smooth[x], localThr, dropletIsBright)) {
          seedL = x
          break
        }
      }
      for (let x = Math.ceil(expectedRight); x <= cR; x++) {
        if (isDropletGray(smooth[x], localThr, dropletIsBright)) {
          seedR = x
          break
        }
      }
      if (seedL === -1 || seedR === -1 || seedR - seedL < 5) continue
      const fbL = findSubPixelEdgePeak(smooth, seedL - 8, seedL + 8, true)
      const fbR = findSubPixelEdgePeak(smooth, seedR - 8, seedR + 8, false)
      if (fbL === -1 || fbR === -1 || fbR - fbL < 5) continue
      subL = fbL
      subR = fbR
    }
    leftPts.push({ x: subL, y })
    rightPts.push({ x: subR, y })
  }
  return { leftPts, rightPts }
}

function detectGuidedAtSurface(
  imageData: ImageData,
  surfaceY: number,
  threshold: number,
  dropletIsBright: boolean,
  expectedLeft: number,
  expectedRight: number,
  windowPx = 24,
): { leftPts: CalibrationPoint[]; rightPts: CalibrationPoint[] } {
  return detectGuidedEdgePolylines(
    imageData,
    surfaceY,
    threshold,
    dropletIsBright,
    expectedLeft,
    expectedRight,
    windowPx,
    -3,
    2,
  )
}

/** neckGradient / neckFallback 等仅有颈宽时，补采样轮廓供接触角回归 */
function tryPolylinesForContactAngle(
  imageData: ImageData,
  surfaceY: number,
  threshold: number,
  dropletIsBright: boolean,
  subL: number,
  subR: number,
): { ptsL: CalibrationPoint[]; ptsR: CalibrationPoint[] } | null {
  const deep = detectGuidedEdgePolylines(
    imageData,
    surfaceY,
    threshold,
    dropletIsBright,
    subL,
    subR,
    36,
    -16,
    2,
  )
  if (deep.leftPts.length >= 3 && deep.rightPts.length >= 3) {
    return { ptsL: deep.leftPts, ptsR: deep.rightPts }
  }
  const mid = detectGuidedEdgePolylines(
    imageData,
    surfaceY,
    threshold,
    dropletIsBright,
    subL,
    subR,
    28,
    -8,
    2,
  )
  if (mid.leftPts.length >= 3 && mid.rightPts.length >= 3) {
    return { ptsL: mid.leftPts, ptsR: mid.rightPts }
  }
  return null
}

function parabolicSubPixel(left: number, center: number, right: number): number {
  const den = left - 2 * center + right
  if (Math.abs(den) < 1e-6) return 0
  return 0.5 * (left - right) / den
}

function detectByNeckGradient(
  imageData: ImageData,
  surfaceY: number,
): { subL: number; subR: number } | null {
  const { width, height, data } = imageData
  const yCenter = Math.round(surfaceY)
  const roiTop = Math.max(1, yCenter - 2)
  const roiBottom = Math.min(height - 2, yCenter + 2)
  if (roiBottom < roiTop) return null

  const profile = new Float32Array(width)
  let countRows = 0
  for (let y = roiTop; y <= roiBottom; y++) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x * 4
      profile[x] += (data[idx] + data[idx + 1] + data[idx + 2]) / 3
    }
    countRows++
  }
  for (let x = 0; x < width; x++) profile[x] /= Math.max(1, countRows)

  const smooth = smoothProfile(profile, 1)
  const grad = new Float32Array(width)
  for (let x = 1; x < width - 1; x++) grad[x] = Math.abs(smooth[x + 1] - smooth[x - 1])

  const mid = Math.floor(width / 2)
  let bestL = -1
  let bestR = -1
  let maxGL = -1
  let maxGR = -1
  for (let x = 8; x < mid - 6; x++) {
    if (grad[x] > maxGL) {
      maxGL = grad[x]
      bestL = x
    }
  }
  for (let x = width - 9; x > mid + 6; x--) {
    if (grad[x] > maxGR) {
      maxGR = grad[x]
      bestR = x
    }
  }
  if (bestL < 1 || bestR < 1 || bestR - bestL < 6) return null

  const noiseFloor = median(Array.from(grad))
  if (maxGL < noiseFloor * 1.8 || maxGR < noiseFloor * 1.8) return null

  const shiftL = parabolicSubPixel(grad[bestL - 1], grad[bestL], grad[bestL + 1])
  const shiftR = parabolicSubPixel(grad[bestR - 1], grad[bestR], grad[bestR + 1])
  const subL = bestL + shiftL
  const subR = bestR + shiftR
  if (!Number.isFinite(subL) || !Number.isFinite(subR) || subR - subL < 6) return null
  return { subL, subR }
}

export function extractPhysicsAtSurface(input: PhysicsInput): { point: AnalysisPoint; widthPx: number } {
  const {
    imageData,
    threshold,
    dropletIsBright = false,
    surfaceY,
    absTime,
    zeroTime,
    timeScaleFactor,
    actualD0,
    pixelScale,
    algorithmMode = 'neckGradient',
    guidedSearch,
    lastWidth = 0,
  } = input
  const width = imageData.width
  const relTimeMs = (absTime - zeroTime) * timeScaleFactor * 1000
  const centerX = width / 2

  const noContactPoint = (): { point: AnalysisPoint; widthPx: number } => ({
    point: {
      time: +relTimeMs.toFixed(3),
      absTime,
      beta: 0,
      absDiameter: 0,
      subL: centerX,
      subR: centerX,
      isInvalid: false,
    },
    widthPx: 0,
  })

  // 基准线上无局部液滴接触（已弹起等）→ 铺展为 0，不画全长伪直径
  if (!guidedSearch && !baselineHasDropletContact(imageData, surfaceY, threshold, dropletIsBright)) {
    return noContactPoint()
  }

  if (algorithmMode === 'neckGradient') {
    const neck = detectByNeckGradient(imageData, surfaceY)
    if (!neck) {
      return {
        point: { time: +relTimeMs.toFixed(3), absTime, beta: 0, absDiameter: 0, isInvalid: true },
        widthPx: 0,
      }
    }
    const widthPx = neck.subR - neck.subL
    if (widthPx > width * 0.62) {
      return noContactPoint()
    }
    const safeScale = pixelScale && pixelScale > 0 ? pixelScale : 50
    const safeD0 = actualD0 > 0 ? actualD0 : 1.87
    const diameterMm = widthPx / safeScale
    const neckPoly = tryPolylinesForContactAngle(
      imageData,
      surfaceY,
      threshold,
      dropletIsBright,
      neck.subL,
      neck.subR,
    )
    return {
      point: {
        time: +relTimeMs.toFixed(3),
        absTime,
        beta: +(diameterMm / safeD0).toFixed(4),
        absDiameter: +diameterMm.toFixed(3),
        subL: neck.subL,
        subR: neck.subR,
        ...(neckPoly ? { ptsL: neckPoly.ptsL, ptsR: neckPoly.ptsR } : {}),
      },
      widthPx,
    }
  }

  /** 向上取样行数：上限 220px，覆盖更高液滴轮廓（旧 12 行仅够触点邻域，铺展叠加青样条会缺上半） */
  const scanH = Math.min(220, Math.max(12, Math.floor(surfaceY) + 1))
  const startY = Math.max(0, Math.floor(surfaceY - (scanH - 1)))
  const rowData = new Uint8ClampedArray(width * scanH * 4)
  for (let r = 0; r < scanH; r++) {
    const srcOffset = ((startY + r) * width) * 4
    rowData.set(imageData.data.subarray(srcOffset, srcOffset + width * 4), r * width * 4)
  }

  const { leftPts, rightPts } = detectEdgePointsLegacy(
    rowData,
    width,
    startY,
    scanH,
    threshold,
    dropletIsBright,
    Math.max(0, lastWidth),
  )

  if (guidedSearch) {
    const guided = detectGuidedAtSurface(
      imageData,
      surfaceY,
      threshold,
      dropletIsBright,
      guidedSearch.expectedLeft,
      guidedSearch.expectedRight,
      guidedSearch.windowPx ?? 24,
    )
    if (guided.leftPts.length >= 2 && guided.rightPts.length >= 2) {
      leftPts.push(...guided.leftPts)
      rightPts.push(...guided.rightPts)
    }
  }

  if (leftPts.length < 3 || rightPts.length < 3) {
    const neckFallback = baselineHasDropletContact(imageData, surfaceY, threshold, dropletIsBright)
      ? estimateByNeckSymmetry(imageData, surfaceY, threshold, dropletIsBright)
      : null
    if (neckFallback) {
      const widthPx = neckFallback.subR - neckFallback.subL
      if (widthPx > width * 0.62) {
        return noContactPoint()
      }
      const safeScale = pixelScale && pixelScale > 0 ? pixelScale : 50
      const safeD0 = actualD0 > 0 ? actualD0 : 1.87
      const diameterMm = widthPx / safeScale
      const neckFbPoly = tryPolylinesForContactAngle(
        imageData,
        surfaceY,
        threshold,
        dropletIsBright,
        neckFallback.subL,
        neckFallback.subR,
      )
      return {
        point: {
          time: +relTimeMs.toFixed(3),
          absTime,
          beta: +(diameterMm / safeD0).toFixed(4),
          absDiameter: +diameterMm.toFixed(3),
          subL: neckFallback.subL,
          subR: neckFallback.subR,
          isInvalid: false,
          recoveredByNeck: true,
          ...(neckFbPoly ? { ptsL: neckFbPoly.ptsL, ptsR: neckFbPoly.ptsR } : {}),
        },
        widthPx,
      }
    }
    return {
      point: { time: +relTimeMs.toFixed(3), absTime, beta: 0, absDiameter: 0, isInvalid: true },
      widthPx: 0,
    }
  }

  leftPts.sort((a, b) => a.y - b.y)
  rightPts.sort((a, b) => a.y - b.y)
  const splineL = createCubicSpline(
    leftPts.map((p) => p.y),
    leftPts.map((p) => p.x),
  )
  const splineR = createCubicSpline(
    rightPts.map((p) => p.y),
    rightPts.map((p) => p.x),
  )
  const xL = splineL(surfaceY)
  const xR = splineR(surfaceY)
  let widthPx = xR - xL
  if (!Number.isFinite(widthPx) || widthPx < 5) {
    return {
      point: {
        time: +relTimeMs.toFixed(3),
        absTime,
        beta: 0,
        absDiameter: 0,
        subL: centerX,
        subR: centerX,
        isInvalid: true,
      },
      widthPx: 0,
    }
  }

  // 异常大的宽度视为无有效接触（伪全长）
  if (!guidedSearch && widthPx > width * 0.62) {
    return noContactPoint()
  }

  const safeScale = pixelScale && pixelScale > 0 ? pixelScale : 50
  const safeD0 = actualD0 > 0 ? actualD0 : 1.87
  const diameterMm = widthPx / safeScale
  return {
    point: {
      time: +relTimeMs.toFixed(3),
      absTime,
      beta: +(diameterMm / safeD0).toFixed(4),
      absDiameter: +diameterMm.toFixed(3),
      subL: xL,
      subR: xR,
      ptsL: leftPts,
      ptsR: rightPts,
    },
    widthPx,
  }
}
