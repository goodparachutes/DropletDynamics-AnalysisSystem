import type { VideoProjectSnapshot } from '../../types/videoProject'
import type { AnalysisState } from './analysisStore'
import { initialAnalysisState } from './analysisStore'
import { defaultOverlayDisplay } from '../../types/overlayDisplay'
import { createDefaultCavityDynamicsSession } from '../../types/cavityDynamics'
import { createDefaultJetDynamicsSession } from '../../types/jetDynamics'

function cloneContourBgGray(bg: Uint8Array | null): Uint8Array | null {
  if (bg == null) return null
  return new Uint8Array(bg)
}

/** 新导入视频的初始快照（空分析、默认标定与轮廓选项） */
export function createEmptyVideoProjectSnapshot(sampleLabel: string): VideoProjectSnapshot {
  const analysis: AnalysisState = structuredClone(initialAnalysisState)
  analysis.isPlaying = false
  analysis.isAnalyzing = false
  const exportedFps = 30
  return {
    analysis,
    samplingFps: 5000,
    exportedFps,
    actualD0: 1.87,
    zeroTime: 0,
    pixelScale: null,
    surfaceY: null,
    intrinsicWidth: 0,
    intrinsicHeight: 0,
    threshold: 128,
    dropletIsBright: false,
    fitPrecision: 70,
    contactAngleMethod: 'linearRegression',
    algorithmMode: 'neckGradient',
    preImpactFrames: 5,
    fluidDensity: 997,
    surfaceTension: 0.0728,
    gammaBw: 0.041,
    gammaBa: 0.0205,
    impactResult: null,
    sampleLabel,
    overlayDisplay: { ...defaultOverlayDisplay },
    contourSegMode: 'luminance',
    contourBgGray: null,
    contourDiffThr: 14,
    contourMorphClose: 2,
    contourDisplaySmoothPct: 40,
    contourDisplayPreserveBaseline: false,
    dissipationSmoothMode: 'ma',
    globalBackgroundSuppressCircles: [],
    analysisRegion: null,
    savedVideoCurrentTime: 0,
    cavityDynamicsSession: createDefaultCavityDynamicsSession(exportedFps, 0.01),
    jetDynamicsSession: createDefaultJetDynamicsSession(exportedFps, 0.01),
  }
}

/** 从当前内存状态组装快照（调用时需传入最新 bundle；播放时刻由 videoCurrentTimeSec 写入） */
export function buildVideoProjectSnapshot(
  bundle: Omit<VideoProjectSnapshot, 'analysis' | 'savedVideoCurrentTime'> & { analysis: AnalysisState },
  videoCurrentTimeSec: number,
): VideoProjectSnapshot {
  const analysis: AnalysisState = structuredClone(bundle.analysis)
  analysis.isPlaying = false
  analysis.isAnalyzing = false
  const cds =
    bundle.cavityDynamicsSession ??
    createDefaultCavityDynamicsSession(
      bundle.exportedFps,
      bundle.pixelScale != null && bundle.pixelScale > 0 ? 1 / bundle.pixelScale : 0.01,
    )
  const jds =
    bundle.jetDynamicsSession ??
    createDefaultJetDynamicsSession(
      bundle.exportedFps,
      bundle.pixelScale != null && bundle.pixelScale > 0 ? 1 / bundle.pixelScale : 0.01,
    )
  return {
    ...bundle,
    analysis,
    contourBgGray: cloneContourBgGray(bundle.contourBgGray),
    globalBackgroundSuppressCircles: bundle.globalBackgroundSuppressCircles.map((c) => ({ ...c })),
    overlayDisplay: { ...bundle.overlayDisplay },
    analysisRegion: bundle.analysisRegion ? { ...bundle.analysisRegion } : null,
    savedVideoCurrentTime: Number.isFinite(videoCurrentTimeSec) ? videoCurrentTimeSec : 0,
    cavityDynamicsSession: {
      ...cds,
      roi: cds.roi ? { ...cds.roi } : null,
      lastResults: cds.lastResults.map((r) => ({ ...r })),
    },
    jetDynamicsSession: {
      ...jds,
      roi: jds.roi ? { ...jds.roi } : null,
      dropTracks: jds.dropTracks.map((t) => ({
        id: t.id,
        samples: t.samples.map((s) => ({ ...s })),
      })),
    },
  }
}

/** 恢复快照前：确保播放 / 分析关闭 */
export function normalizeSnapshotForApply(s: VideoProjectSnapshot): VideoProjectSnapshot {
  const out = structuredClone(s) as VideoProjectSnapshot
  out.analysis.isPlaying = false
  out.analysis.isAnalyzing = false
  out.contourBgGray = cloneContourBgGray(s.contourBgGray)
  out.globalBackgroundSuppressCircles = s.globalBackgroundSuppressCircles.map((c) => ({ ...c }))
  out.overlayDisplay = { ...defaultOverlayDisplay, ...s.overlayDisplay }
  out.analysisRegion = s.analysisRegion ? { ...s.analysisRegion } : null
  const cds = s.cavityDynamicsSession
  if (!cds) {
    out.cavityDynamicsSession = createDefaultCavityDynamicsSession(
      out.exportedFps,
      out.pixelScale != null && out.pixelScale > 0 ? 1 / out.pixelScale : 0.01,
    )
  } else {
    const mm = cds.mmPerPx
    const eps =
      typeof cds.otsuRelaxEpsilon === 'number' && Number.isFinite(cds.otsuRelaxEpsilon)
        ? Math.max(0, Math.min(60, Math.round(cds.otsuRelaxEpsilon)))
        : 20
    const morphR =
      typeof cds.morphCloseDiskRadiusPx === 'number' && Number.isFinite(cds.morphCloseDiskRadiusPx)
        ? Math.max(0, Math.min(24, Math.round(cds.morphCloseDiskRadiusPx)))
        : 6
    out.cavityDynamicsSession = {
      ...cds,
      otsuRelaxEpsilon: eps,
      morphCloseDiskRadiusPx: morphR,
      roi: cds.roi ? { ...cds.roi } : null,
      lastResults: cds.lastResults.map((r) => {
        const kappaMm =
          r.kappaApexPerMm != null
            ? r.kappaApexPerMm
            : r.kappaApexPerPx != null && mm > 0 && Number.isFinite(r.kappaApexPerPx)
              ? r.kappaApexPerPx / mm
              : null
        const vrAbs =
          r.vrAbsMmPerS != null
            ? r.vrAbsMmPerS
            : r.vrMmPerS != null && Number.isFinite(r.vrMmPerS)
              ? Math.abs(r.vrMmPerS)
              : null
        return { ...r, kappaApexPerMm: kappaMm, vrAbsMmPerS: vrAbs }
      }),
    }
  }
  const jds0 = s.jetDynamicsSession
  if (!jds0) {
    out.jetDynamicsSession = createDefaultJetDynamicsSession(
      out.exportedFps,
      out.pixelScale != null && out.pixelScale > 0 ? 1 / out.pixelScale : 0.01,
    )
  } else {
    const epsJ =
      typeof jds0.otsuRelaxEpsilon === 'number' && Number.isFinite(jds0.otsuRelaxEpsilon)
        ? Math.max(0, Math.min(60, Math.round(jds0.otsuRelaxEpsilon)))
        : 20
    const morphJ =
      typeof jds0.morphCloseDiskRadiusPx === 'number' && Number.isFinite(jds0.morphCloseDiskRadiusPx)
        ? Math.max(0, Math.min(24, Math.round(jds0.morphCloseDiskRadiusPx)))
        : 6
    out.jetDynamicsSession = {
      ...jds0,
      otsuRelaxEpsilon: epsJ,
      morphCloseDiskRadiusPx: morphJ,
      roi: jds0.roi ? { ...jds0.roi } : null,
      dropTracks: jds0.dropTracks.map((t) => ({
        id: t.id,
        samples: t.samples.map((s) => ({ ...s })),
      })),
    }
  }
  return out
}
