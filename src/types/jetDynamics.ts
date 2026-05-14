import type { AnalysisRegionRect } from '../features/analysis/analysisRegion'

/** 单滴在单帧上的采样（物理时间轴与空泡一致：t = frame / fs，fs 为侧栏采样 Hz） */
export interface JetDropSample {
  frameIndex: number
  timeSec: number
  /** 形心（全图画布 px），用于曲线选点后重提同一连通域轮廓 */
  cxPx?: number
  cyPx?: number
  /** 椭圆中心（无椭圆时为连通域形心）相对自由面的竖直高度 mm，向上为正：Z_c = (SurfaceY − y_ref_px) × mm/px */
  zTipMm: number | null
  /** 整条轨迹上由 Z_c–t 弹道线性拟合得到的常数 V（mm/s），不再做逐帧数值差分 */
  vJetMmPerS: number | null
  areaDropMm2: number
  volMm3: number
  aspectRatio: number
  /** LS 椭圆长/短半轴（mm），a≥b；拟合失败时为空 */
  ellipseSemiMajorMm?: number | null
  ellipseSemiMinorMm?: number | null
  /** 长轴相对 +x 的转角（rad） */
  ellipsePhiRad?: number | null
  /** E_k = ½ ρ ⟨V⟩² · ⟨V_sphere⟩ [J]：V 为拟合常速（m³ 用 vol 算术平均） */
  ekJoule?: number | null
  /** η = E_k / E_in（无量纲），E_in = ½M₀U₀² + σ(4πR₀²)，M₀=ρ(4/3 πR₀³)，R₀=D₀/2；缺撞击速度 U₀ 等时为 null */
  efficiencyEta?: number | null
  /** β = (V_jet/U₀)²，速度均用 m/s；缺 U₀ 时为 null */
  amplificationBeta?: number | null
}

/** 一个追踪 ID 的完整时间序列 */
export interface JetDropTrack {
  id: number
  samples: JetDropSample[]
}

export interface JetDynamicsSessionPersisted {
  frameStart: number
  frameEnd: number
  /** 与全局 mm/px 同步 */
  mmPerPx: number
  minJetPixels: number
  invertOtsu: boolean
  bubbleDark: boolean
  otsuRelaxEpsilon: number
  morphCloseDiskRadiusPx: number
  roi: AnalysisRegionRect | null
  /** 最近一次追踪结果 */
  dropTracks: JetDropTrack[]
}

export function createDefaultJetDynamicsSession(
  fpsDefault: number,
  mmPerPxFallback: number,
): JetDynamicsSessionPersisted {
  const mm = mmPerPxFallback > 0 && Number.isFinite(mmPerPxFallback) ? mmPerPxFallback : 0.01
  return {
    frameStart: 0,
    frameEnd: Math.max(0, Math.floor(fpsDefault) || 30),
    mmPerPx: mm,
    minJetPixels: 30,
    invertOtsu: false,
    bubbleDark: true,
    otsuRelaxEpsilon: 20,
    morphCloseDiskRadiusPx: 6,
    roi: null,
    dropTracks: [],
  }
}
