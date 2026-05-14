import { fitDropletDiskFromImageData } from './dropletSilhouette'

export interface CircleFitResult {
  centerX: number
  centerY: number
  radius: number
}

/** 回归中用到的某一帧液滴圆拟合（画布像素坐标）。 */
export interface ImpactCircleSnapshot {
  centerX: number
  centerY: number
  radius: number
  /** 相对 t0 的物理时间 (s)，用于最小二乘回归 */
  time: number
}

export interface ImpactResult {
  velocityMps: number
  velocityPxPerS: number
  weber: number
  usedFrames: number
  /** 参与回归的最早一帧（时间最早） */
  firstCircle: ImpactCircleSnapshot
  /** 参与回归的最晚一帧（最接近 t0） */
  lastCircle: ImpactCircleSnapshot
  /** 首末帧圆心在像素平面上的直线距离 */
  displacementPx: number
}

function fitCircleFromFrame(
  imageData: ImageData,
  threshold: number,
  dropletIsBright: boolean,
  surfaceY: number | null | undefined,
): CircleFitResult | null {
  const fit = fitDropletDiskFromImageData(imageData, threshold, dropletIsBright, {
    surfaceY: surfaceY ?? undefined,
  })
  if (!fit) return null
  return { centerX: fit.cx, centerY: fit.cy, radius: fit.radius }
}

function linearSlope(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0
  for (let i = 0; i < n; i++) {
    sumX += xs[i]
    sumY += ys[i]
    sumXX += xs[i] * xs[i]
    sumXY += xs[i] * ys[i]
  }
  const den = n * sumXX - sumX * sumX
  if (Math.abs(den) < 1e-8) return 0
  return (n * sumXY - sumX * sumY) / den
}

export function calculateImpactResult(params: {
  frames: Array<{ time: number; imageData: ImageData }>
  threshold: number
  dropletIsBright?: boolean
  /** 与空间标定中 Surface Y（红线）一致；传入后与自动标定共用同一裁剪，撞击前无倒影时必选 */
  surfaceY?: number | null
  pixelScale: number | null
  actualD0: number
  fluidDensity?: number
  surfaceTension?: number
}): ImpactResult | null {
  const {
    frames,
    threshold,
    dropletIsBright = false,
    surfaceY,
    pixelScale,
    actualD0,
    fluidDensity = 997,
    surfaceTension = 0.0728,
  } = params
  const valid: Array<{ t: number; cx: number; cy: number; r: number }> = []
  for (const frame of frames) {
    const fit = fitCircleFromFrame(frame.imageData, threshold, dropletIsBright, surfaceY)
    if (!fit) continue
    valid.push({ t: frame.time, cx: fit.centerX, cy: fit.centerY, r: fit.radius })
  }
  if (valid.length < 2) return null

  const ts = valid.map((v) => v.t)
  const ys = valid.map((v) => v.cy)
  const xs = valid.map((v) => v.cx)
  const vy = linearSlope(ts, ys)
  const vx = linearSlope(ts, xs)
  const speedPxPerS = Math.hypot(vx, vy)

  const pxPerMm = pixelScale && pixelScale > 0 ? pixelScale : 50
  const speedMps = speedPxPerS / pxPerMm / 1000
  const d0m = Math.max(1e-9, actualD0 / 1000)
  const weber = (fluidDensity * speedMps * speedMps * d0m) / surfaceTension

  const first = valid[0]
  const last = valid[valid.length - 1]
  const displacementPx = Math.hypot(last.cx - first.cx, last.cy - first.cy)

  return {
    velocityMps: speedMps,
    velocityPxPerS: speedPxPerS,
    weber,
    usedFrames: valid.length,
    firstCircle: {
      centerX: first.cx,
      centerY: first.cy,
      radius: first.r,
      time: first.t,
    },
    lastCircle: {
      centerX: last.cx,
      centerY: last.cy,
      radius: last.r,
      time: last.t,
    },
    displacementPx,
  }
}
