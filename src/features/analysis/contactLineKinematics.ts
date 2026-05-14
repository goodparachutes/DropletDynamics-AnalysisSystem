import type { AnalysisPoint } from '../../types/analysis'

/** 由直径序列差分得到的接触线运动学量（单侧速度 v = (1/2)·dD/dt） */
export type ContactLineKinematicsFields = {
  contactLineVelocityMmS: number | null
  contactLineAccelMmS2: number | null
}

export type AnalysisPointWithKinematics = AnalysisPoint & ContactLineKinematicsFields

/**
 * 单侧接触线沿铺展方向速度：v = (1/2) · dD/dt（mm/s）。
 * D 为绝对直径(mm)，t 为分析点时间 `time`(ms)。
 * 铺展系数 β=0（通常为刚接触参考帧）时不计算速度与加速度。
 */
export function enrichWithContactLineKinematics(data: AnalysisPoint[]): AnalysisPointWithKinematics[] {
  const rows: AnalysisPointWithKinematics[] = data.map((d) => ({
    ...d,
    contactLineVelocityMmS: null,
    contactLineAccelMmS2: null,
  }))

  for (let i = 1; i < data.length; i++) {
    if (data[i].beta === 0) continue
    const dtMs = data[i].time - data[i - 1].time
    if (dtMs <= 1e-6) continue
    const dD = data[i].absDiameter - data[i - 1].absDiameter
    const v = 0.5 * (dD / dtMs) * 1000
    if (Number.isFinite(v)) {
      rows[i] = { ...rows[i], contactLineVelocityMmS: +v.toFixed(6) }
    }
  }

  for (let i = 2; i < data.length; i++) {
    if (data[i].beta === 0) continue
    const vPrev = rows[i - 1].contactLineVelocityMmS
    const vCur = rows[i].contactLineVelocityMmS
    if (vPrev == null || vCur == null) continue
    const dtMs = data[i].time - data[i - 1].time
    if (dtMs <= 1e-6) continue
    const dtS = dtMs / 1000
    const a = (vCur - vPrev) / dtS
    if (Number.isFinite(a)) {
      rows[i] = { ...rows[i], contactLineAccelMmS2: +a.toFixed(6) }
    }
  }

  return rows
}
