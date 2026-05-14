import type { CalibrationPoint } from '../../types/analysis'

/** `regression`：接触角/拟合用窄竖直带；`overlay`：画布铺展叠加用 pts 内「基准线上方」全部点（仍受限于边缘检测 ROI） */
export type SpreadSplineBandMode = 'regression' | 'overlay'

/**
 * 青样条结点（铺展测量与 spreadSpline 接触角共用）：
 * 在基准线上方固定高度带内，使用 **全部轮廓采样点**（按行检测到的边点，即画面上看到的轮廓），
 * 按 y 合并同行点后自然三次样条插值 x(y)，并强制锚定触点 `(handleX, surfaceY)`。
 *
 * 不再做「沿 y 排序后的邻接跳跃」筛选，避免丢点导致样条与真实轮廓脱节。
 *
 * @param otherFootX 若给定且与 handle 间距足够大，则剔除离对侧脚更近的点（与直线回归 foot 过滤一致）。
 * @param _isLeft 保留与旧 API 兼容；轮廓已由 ptsL/ptsR 分侧，此处不再按 x 侧向裁剪。
 * @param fitPrecision 0–100：`regression` 模式下控制竖直带深度（约 75–120px）；`overlay` 忽略此项竖直上限。
 * @param bandMode `overlay` 时使用 `pts` 内所有 `y ≤ surfaceY` 的点绘制整条可见母线（不再裁成 ~120px 带）。
 */
export function buildSpreadSplineDrawPoints(
  pts: CalibrationPoint[],
  surfaceY: number,
  handleX: number,
  _isLeft: boolean,
  fitPrecision: number,
  otherFootX?: number,
  bandMode: SpreadSplineBandMode = 'regression',
): CalibrationPoint[] | null {
  if (pts.length < 2) return null

  const precision = Math.max(0, Math.min(100, fitPrecision))
  const bandDepthPx = Math.round(75 + (precision / 100) * 45)
  const yTopLimit = bandMode === 'overlay' ? 0 : surfaceY - bandDepthPx
  let cand = pts.filter((p) => p.y <= surfaceY + 0.5 && p.y >= yTopLimit)

  if (
    otherFootX !== undefined &&
    Number.isFinite(handleX) &&
    Number.isFinite(otherFootX) &&
    Math.abs(otherFootX - handleX) > 2
  ) {
    cand = cand.filter((p) => {
      const dSelf = Math.abs(p.x - handleX)
      const dOther = Math.abs(p.x - otherFootX)
      return dSelf <= dOther + 1e-4
    })
  }

  if (cand.length < 1) return null

  /** 触点行附近用柄点代替轮廓上的 x，避免同一行多点拉扯 baseline */
  const body = cand.filter((p) => Math.abs(p.y - surfaceY) > 0.5)

  const merged = new Map<number, { sx: number; n: number }>()
  for (const p of body) {
    const yk = Math.round(p.y)
    const cell = merged.get(yk)
    if (cell) {
      cell.sx += p.x
      cell.n += 1
    } else {
      merged.set(yk, { sx: p.x, n: 1 })
    }
  }

  const knots: CalibrationPoint[] = []
  for (const [yk, { sx, n }] of merged) {
    knots.push({ x: sx / n, y: yk })
  }
  knots.push({ x: handleX, y: surfaceY })
  knots.sort((a, b) => a.y - b.y)

  const deduped: CalibrationPoint[] = []
  for (const k of knots) {
    const prev = deduped[deduped.length - 1]
    if (prev && Math.abs(k.y - prev.y) < 1e-6) {
      prev.x = (prev.x + k.x) / 2
    } else {
      deduped.push({ ...k })
    }
  }

  if (deduped.length < 2) return null
  return deduped
}
