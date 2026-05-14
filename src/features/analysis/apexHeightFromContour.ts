import type { CalibrationPoint } from '../../types/analysis'

function minContourYPx(contour: CalibrationPoint[] | undefined): number | null {
  if (!contour || contour.length === 0) return null
  let minY = Infinity
  for (const p of contour) {
    if (typeof p.y === 'number' && Number.isFinite(p.y) && p.y < minY) minY = p.y
  }
  return Number.isFinite(minY) ? minY : null
}

/**
 * 侧视图像 y 向下：轮廓「最高点」对应最小像素 y。
 * 与基准线 Surface Y 的竖直距离（px）再按标定换算为 mm。
 *
 * @param pixelScalePxPerMm 空间标定（px/mm）
 */
export function apexHeightAboveBaselineMm(params: {
  surfaceYPx: number
  outerContourPx: CalibrationPoint[] | undefined
  pixelScalePxPerMm: number
}): number | null {
  const { surfaceYPx, outerContourPx, pixelScalePxPerMm } = params
  if (!(pixelScalePxPerMm > 0) || !Number.isFinite(pixelScalePxPerMm) || !Number.isFinite(surfaceYPx)) {
    return null
  }
  const apexY = minContourYPx(outerContourPx)
  if (apexY == null) return null
  const heightPx = surfaceYPx - apexY
  if (!Number.isFinite(heightPx)) return null
  const hPx = Math.max(0, heightPx)
  return hPx / pixelScalePxPerMm
}
