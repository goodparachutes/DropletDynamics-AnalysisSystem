import type { AnalysisRegionRect } from '../features/analysis/analysisRegion'
import type { CalibrationPoint } from './analysis'

/** 单帧调试：仅在「点击曲线点」时按需计算，不写入会话快照 */
export interface CavityPipelineDebug {
  otsuThreshold: number
  grayMin: number
  grayMax: number
  claheApplied: boolean
  /** 兼容旧 UI；圆盘闭运算为主时可为 0 */
  morphCloseIterations: number
  /** 圆盘形态学闭运算半径（px），0 表示未使用 */
  morphCloseDiskRadiusPx: number
  /** Otsu 后二值分界灰度松弛 ε（0–255） */
  otsuRelaxEpsilon: number
  largestComponentPixels: number | null
  moorePointCount: number | null
  sgWindow: number
  /** Moore 外轮廓，全图画布坐标 */
  rawContourCanvas: CalibrationPoint[]
  /** SG 平滑后闭合轮廓，全图画布坐标（与主画布叠加一致） */
  smoothContourCanvas: CalibrationPoint[]
}

/** 空泡分析终止原因 */
export type CavityStopReason =
  | 'complete'
  | 'collapse_area'
  | 'open_to_roi_edge'
  | 'extract_failed'
  | 'invalid_range'
  /** 连通域长宽比超出护栏，判定为非气泡杂质并终止序列 */
  | 'debris_ar'

/** 单帧提取结果（失败时几何量为 null，帧索引与时间仍保留便于对齐） */
export interface CavityDynamicsFrameResult {
  frameIndex: number
  /** 物理时间（秒）：t = frameIndex / fs，fs 为侧栏「采样 fs」（Hz）；展示 ms 时乘 1000 */
  timeSec: number
  /** 闭合孔洞面积 mm² */
  areaMm2: number | null
  /** 等效半径 mm：R_eq = √(A_b/π)，与 {@link areaMm2} 同源（非单独圆拟合） */
  reqMm: number | null
  /** 形心（全图画布坐标，px） */
  xcPx: number | null
  ycPx: number | null
  /**
   * 物理竖直坐标 mm，向上为正：若给定 surfaceYPx，则 Zc = (surfaceY − yc) × mmPerPx；
   * 否则为 null（需在侧栏设定基准线后重算导出）。
   */
  zcMm: number | null
  /** 轮廓包围盒 (ymax − ymin) / (xmax − xmin)；细长条 AR 大、扁片 AR 小 */
  aspectRatio: number | null
  /**
   * 平滑轮廓顶点带平均曲率（像素空间），单位 1/px。
   * 换算到物理空间须 **除以** 标定 s (mm/px)：κ_mm = κ_px / s（不可乘 s；曲率为长度倒数）。
   */
  kappaApexPerPx: number | null
  /** 与 {@link kappaApexPerPx} 对应：κ_mm = κ_px / s，单位 1/mm；s = mmPerPx */
  kappaApexPerMm: number | null
  /**
   * dR_eq/dt（中心差分，对 SG 平滑后的 R_eq），mm/s。
   * **符号**：负值 = 等效半径减小（向内坍塌），正值 = 半径增大（反弹/膨胀）。
   */
  vrMmPerS: number | null
  /** |dR_eq/dt|，mm/s；溃灭阶段「径向变化速率」量级，与 {@link vrMmPerS} 同帧 */
  vrAbsMmPerS: number | null
  /** dZc/dt，mm/s（Z 向上） */
  vCentroidMmPerS: number | null
  /** 拉普拉斯压差 ΔP = 2σ/R（R 用 m），Pa */
  deltaPLaplacePa: number | null
  /** 内部连通域像素数（填充计数） */
  pixelArea: number | null
  /**
   * 手绘闭合轮廓顶点（全图画布 px）；存在时点曲线不再用 Otsu 重算 pipeline，几何量以本帧已存结果为准。
   */
  manualContourCanvas?: CalibrationPoint[] | null
  failedReason?: string
}

/** 持久化到视频快照的空泡会话（不含 UI 临时状态） */
export interface CavityDynamicsSessionPersisted {
  frameStart: number
  frameEnd: number
  fps: number
  mmPerPx: number
  sigmaNm: number
  minPixels: number
  invertOtsu: boolean
  /** true：灰度低于阈值为气泡；false：高于阈值为气泡 */
  bubbleDark: boolean
  /**
   * Otsu 二值分界松弛 ε（0–60，默认 20）：暗泡 g≤T+ε、亮泡 g>T−ε；攻坚阶段可调以适配不同黏度/反光。
   */
  otsuRelaxEpsilon: number
  /**
   * 圆盘形态学闭运算半径（0–24 px，默认 6）；0 仅保留 3×3 闭运算。大半径弥合更大高光孔。
   */
  morphCloseDiskRadiusPx: number
  roi: AnalysisRegionRect | null
  lastResults: CavityDynamicsFrameResult[]
  lastCollapseFrameIndex: number | null
  lastStopReason: CavityStopReason | null
}

export function createDefaultCavityDynamicsSession(
  fpsDefault: number,
  mmPerPxFallback: number,
): CavityDynamicsSessionPersisted {
  const mm = mmPerPxFallback > 0 && Number.isFinite(mmPerPxFallback) ? mmPerPxFallback : 0.01
  return {
    frameStart: 0,
    frameEnd: 0,
    fps: Math.max(1, Math.round(fpsDefault) || 30),
    mmPerPx: mm,
    sigmaNm: 0.0728,
    minPixels: 40,
    invertOtsu: false,
    bubbleDark: true,
    otsuRelaxEpsilon: 20,
    morphCloseDiskRadiusPx: 6,
    roi: null,
    lastResults: [],
    lastCollapseFrameIndex: null,
    lastStopReason: null,
  }
}
