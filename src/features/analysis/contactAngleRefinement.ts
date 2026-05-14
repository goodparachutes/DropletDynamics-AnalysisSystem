import type { AnalysisPoint } from '../../types/analysis'

export type ContactAngleRefineOpts = {
  /** 左右 θ 差超过此值（°）则两侧取平均对齐（轴对称滴预期） */
  maxLeftRightDiffDeg?: number
  /** 与同侧前后邻帧插值偏差超过此值（°）则用邻域插值替换 */
  maxNeighborDeviationDeg?: number
  /** 向左右搜索最近有效 θ 的最大跨度（帧） */
  neighborSearchSpan?: number
  /** 时间轴平滑重复次数 */
  temporalPasses?: number
}

const defaultOpts: Required<ContactAngleRefineOpts> = {
  maxLeftRightDiffDeg: 16,
  maxNeighborDeviationDeg: 14,
  neighborSearchSpan: 4,
  temporalPasses: 2,
}

function clonePoint(p: AnalysisPoint): AnalysisPoint {
  return { ...p }
}

/** 由当前左右 θ 重写平均值字段（与 enrich / 修正一致） */
function attachContactAngleAvg(points: AnalysisPoint[]): AnalysisPoint[] {
  return points.map((p) => {
    const l = p.contactAngleLeftDeg
    const r = p.contactAngleRightDeg
    if (l != null && r != null && Number.isFinite(l) && Number.isFinite(r)) {
      return { ...p, contactAngleAvgDeg: +((l + r) / 2).toFixed(2) }
    }
    const { contactAngleAvgDeg: _a, ...rest } = p
    return rest
  })
}

function nearestTheta(
  points: AnalysisPoint[],
  i: number,
  dir: -1 | 1,
  side: 'left' | 'right',
  maxSpan: number,
): number | null {
  for (let step = 1; step <= maxSpan; step++) {
    const j = i + dir * step
    if (j < 0 || j >= points.length) return null
    const v =
      side === 'left' ? points[j].contactAngleLeftDeg : points[j].contactAngleRightDeg
    if (v != null && Number.isFinite(v)) return v
  }
  return null
}

/** 单遍：同侧 θ 与「前后最近有效帧」的线性插值偏差过大则替换为插值 */
function temporalSmoothPass(
  points: AnalysisPoint[],
  maxDev: number,
  maxSpan: number,
): AnalysisPoint[] {
  const out = points.map(clonePoint)
  for (let i = 0; i < out.length; i++) {
    for (const side of ['left', 'right'] as const) {
      const key = side === 'left' ? 'contactAngleLeftDeg' : 'contactAngleRightDeg'
      const cur = out[i][key]
      if (cur == null || !Number.isFinite(cur)) continue

      const prev = nearestTheta(out, i, -1, side, maxSpan)
      const next = nearestTheta(out, i, 1, side, maxSpan)
      if (prev == null || next == null) continue

      const predicted = (prev + next) / 2
      if (Math.abs(cur - predicted) > maxDev) {
        const nextPt = { ...out[i], [key]: +predicted.toFixed(2) } as AnalysisPoint
        out[i] = nextPt
      }
    }
  }
  return out
}

/** 左右都有 θ 且差过大时取平均 */
function symmetryPass(points: AnalysisPoint[], maxLR: number): AnalysisPoint[] {
  return points.map((p) => {
    const l = p.contactAngleLeftDeg
    const r = p.contactAngleRightDeg
    if (l == null || r == null || !Number.isFinite(l) || !Number.isFinite(r)) return { ...p }
    if (Math.abs(l - r) <= maxLR) return { ...p }
    const m = (l + r) / 2
    const v = +m.toFixed(2)
    return { ...p, contactAngleLeftDeg: v, contactAngleRightDeg: v }
  })
}

/**
 * 对整条分析序列做接触角后处理：
 * 1. 多遍时间邻域插值 — 剔除相对前后帧跳变过大的孤立点；
 * 2. 左右对称 — 两侧差过大时取平均（适用于近似轴对称铺展）。
 *
 * 不修改 β、直径与轮廓点；改写 contactAngleLeftDeg / contactAngleRightDeg，并同步 contactAngleAvgDeg。
 */
export function refineContactAnglesSeries(
  points: AnalysisPoint[],
  opts?: ContactAngleRefineOpts,
): AnalysisPoint[] {
  if (points.length === 0) return []

  const o = { ...defaultOpts, ...opts }
  let cur = points.map(clonePoint)

  for (let pass = 0; pass < o.temporalPasses; pass++) {
    cur = temporalSmoothPass(cur, o.maxNeighborDeviationDeg, o.neighborSearchSpan)
  }
  cur = symmetryPass(cur, o.maxLeftRightDiffDeg)

  return attachContactAngleAvg(cur)
}
