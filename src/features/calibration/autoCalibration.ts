import type { AutoCalibrationResult } from '../../types/analysis'
import { cropImageData, type AnalysisRegionRect } from '../analysis/analysisRegion'
import { fitDropletDiskFromImageData } from '../analysis/dropletSilhouette'

export interface AutoCalibrationInput {
  imageData: ImageData
  threshold: number
  actualD0: number
  /** true：液滴比背景亮（深色基底）；false：液滴偏暗（浅色背景） */
  dropletIsBright?: boolean
  /**
   * 仅在该全画布矩形内做二值直方图与圆拟合；`pixelScale` / `surfaceY` / 圆心等仍返回全画布坐标。
   * 用于全图杂散前景导致自动标定失败时，先框选含液滴的小区域再标定。
   */
  analysisRegion?: AnalysisRegionRect | null
}

export interface AutoCalibrationOutput {
  pixelScale: number
  surfaceY: number
  result: AutoCalibrationResult
}

export function runAutoCalibration(input: AutoCalibrationInput): AutoCalibrationOutput | null {
  const { imageData, threshold, actualD0, dropletIsBright = false, analysisRegion = null } = input
  const width = imageData.width
  const height = imageData.height
  if (width === 0 || height === 0) return null

  const region =
    analysisRegion != null && analysisRegion.w > 0 && analysisRegion.h > 0 ? analysisRegion : null
  const work = region != null ? cropImageData(imageData, region) : imageData
  if (work.width === 0 || work.height === 0) return null

  const fit = fitDropletDiskFromImageData(work, threshold, dropletIsBright)
  if (!fit) return null

  const safeD0 = actualD0 > 0 ? actualD0 : 1.87
  const ox = region?.x ?? 0
  const oy = region?.y ?? 0
  return {
    pixelScale: fit.dPx / safeD0,
    surfaceY: fit.baselineY + oy,
    result: {
      dropletX: Math.round(fit.cx + ox),
      dropletY: Math.round(fit.cy + oy),
      radius: fit.radius,
      dPx: fit.dPx,
    },
  }
}
