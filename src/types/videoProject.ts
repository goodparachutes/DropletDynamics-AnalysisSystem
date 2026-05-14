import type { AnalysisState } from '../features/analysis/analysisStore'
import type { OverlayDisplayState } from './overlayDisplay'
import type { AnalysisRegionRect } from '../features/analysis/analysisRegion'
import type { ContactAngleMethod } from '../features/analysis/contactAngle'
import type { ContourSegmentationMode } from '../features/analysis/dropletContour'
import type { DissipationSmoothMode } from '../features/analysis/surfaceEnergy'
import type { ImpactResult } from '../features/analysis/impact'
import type { CavityDynamicsSessionPersisted } from './cavityDynamics'
import type { JetDynamicsSessionPersisted } from './jetDynamics'

/** 单个实验视频对应的全部可持久化 UI / 分析状态（切换视频时整体换入换出） */
export interface VideoProjectSnapshot {
  analysis: AnalysisState
  samplingFps: number
  exportedFps: number
  actualD0: number
  zeroTime: number
  pixelScale: number | null
  surfaceY: number | null
  intrinsicWidth: number
  intrinsicHeight: number
  threshold: number
  dropletIsBright: boolean
  fitPrecision: number
  contactAngleMethod: ContactAngleMethod
  algorithmMode: 'legacy' | 'neckGradient'
  preImpactFrames: number
  fluidDensity: number
  surfaceTension: number
  gammaBw: number
  gammaBa: number
  impactResult: ImpactResult | null
  sampleLabel: string
  overlayDisplay: OverlayDisplayState
  contourSegMode: ContourSegmentationMode
  contourBgGray: Uint8Array | null
  contourDiffThr: number
  contourMorphClose: number
  contourDisplaySmoothPct: number
  contourDisplayPreserveBaseline: boolean
  dissipationSmoothMode: DissipationSmoothMode
  globalBackgroundSuppressCircles: Array<{ x: number; y: number; rPx: number }>
  analysisRegion: AnalysisRegionRect | null
  savedVideoCurrentTime: number
  /** 空泡动力学（独立于铺展自动分析）；旧快照可能缺省，由 normalize 补默认 */
  cavityDynamicsSession?: CavityDynamicsSessionPersisted
  /** 射流动力学（溃灭后 Singular Jet）；旧快照可能缺省 */
  jetDynamicsSession?: JetDynamicsSessionPersisted
}

export interface VideoProjectEntry {
  id: string
  /** 列表展示名，默认取文件名 */
  label: string
  /** Blob URL；移除项目时必须 revoke */
  videoSrc: string
}
