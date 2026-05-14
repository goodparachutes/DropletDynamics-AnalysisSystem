import type { AnalysisPoint } from '../../types/analysis'

/** β 视为“零接触”的阈值 */
const BETA_ZERO_EPS = 0.05
/** 认为发生过铺展的最小 β */
const BETA_SPREAD_MIN = 0.08

/**
 * 接触时间：从第一次 β≈0（撞击瞬间）到铺展过程中再次出现 β≈0（弹起离基）。
 * 若从未在铺展后再次归零（液滴未弹起），返回 null。
 */
export function computeContactTimeMs(points: AnalysisPoint[]): number | null {
  if (points.length < 2) return null
  const sorted = [...points].sort((a, b) => a.time - b.time)

  const tFirstZero = sorted.find((p) => p.beta <= BETA_ZERO_EPS)?.time
  if (tFirstZero === undefined) return null

  let sawSpread = false
  let tSecondZero: number | null = null

  for (const p of sorted) {
    if (p.beta > BETA_SPREAD_MIN) sawSpread = true
    if (sawSpread && p.beta <= BETA_ZERO_EPS && p.time > tFirstZero + 1e-6) {
      tSecondZero = p.time
      break
    }
  }

  if (tSecondZero === null) return null
  return +(tSecondZero - tFirstZero).toFixed(3)
}
