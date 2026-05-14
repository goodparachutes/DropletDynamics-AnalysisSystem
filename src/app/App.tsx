import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { ChevronsLeft, ChevronsRight, CircleHelp, Download, Pause, Play, Upload, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import { analysisReducer, initialAnalysisState } from '../features/analysis/analysisStore'
import { createPchipSpline } from '../features/analysis/spline'
import { isDropletGray } from '../features/analysis/dropletBinary'
import { extractPhysicsAtSurface } from '../features/analysis/physics'
import {
  enrichAnalysisPointContactAngles,
  getContactAngleFitGeometry,
  linearRegressionDepthPxFromFitPrecision,
  linearRegressionMaxPointsFromFitPrecision,
  mergeContactAngleFitOptsForPoint,
  type ContactAngleFitOpts,
  type ContactAngleMethod,
} from '../features/analysis/contactAngle'
import { buildSpreadSplineDrawPoints } from '../features/analysis/spreadSplinePoints'
import { drawContactAngleFitOverlay } from '../features/analysis/contactAngleOverlay'
import { refineContactAnglesSeries } from '../features/analysis/contactAngleRefinement'
import { enrichWithContactLineKinematics } from '../features/analysis/contactLineKinematics'
import {
  buildForegroundMaskForContour,
  CONTOUR_LUMINANCE_ALT_RETRY_DELTA,
  extractDropletOuterContourPx,
  imageDataToGrayUint8,
  syntheticBackgroundGrayFromFrame,
  type ContourSegmentationMode,
  type MooreContourStartSearch,
} from '../features/analysis/dropletContour'
import {
  computeSurfaceEnergySeries,
  MOORE_OUTER_CONTOUR_MIN_POINTS,
  type DissipationSmoothMode,
  type SurfaceEnergySeriesContourDisplayOpts,
} from '../features/analysis/surfaceEnergy'
import {
  buildAnalysisPipelineFrame,
  finalizeAnalysisRegionFromDrag,
  CAVITY_ROI_MIN_SIDE_PX,
  cavityDiscreteFrameSeekTimeSec,
  finalizeCavityRoiFromDrag,
  mergeSuppressCircles,
  offsetAnalysisPointToFullImage,
  offsetContourToFullImage,
  type AnalysisRegionRect,
} from '../features/analysis/analysisRegion'
import {
  cavityExtractFailure,
  collapseStopReasonFromRow,
  extractCavityMetricsOneFrame,
  isCavityDebrisAspectFailure,
  mergeFrameMeta,
  postprocessCavityDynamicsSeries,
} from '../features/cavity/bubbleDynamics'
import {
  cavityPipelineDebugFromManualVertices,
  computeCavityMetricsFromManualPolygon,
  polygonShoelaceAreaPx,
} from '../features/cavity/manualPolygonCavity'
import {
  exportJetDynamicsCsv,
  extractJetBlobsOneFrame,
  extractJetContourAtAnchor,
  runJetDynamicsTracking,
  type JetBlobFrame,
  type JetImpactTimeCalib,
  type JetMacroEnergyParams,
} from '../features/jet/jetDynamics'
import { fitEllipseFromContourPx } from '../features/jet/ellipseAlgebraicFit'
import type { FittedEllipsePx } from '../features/jet/ellipseAlgebraicFit'
import type {
  CavityDynamicsFrameResult,
  CavityDynamicsSessionPersisted,
  CavityPipelineDebug,
  CavityStopReason,
} from '../types/cavityDynamics'
import { createDefaultCavityDynamicsSession } from '../types/cavityDynamics'
import type { JetDynamicsSessionPersisted } from '../types/jetDynamics'
import { createDefaultJetDynamicsSession } from '../types/jetDynamics'
import { captureVideoFrameImageData } from '../features/analysis/videoFrameImageData'
import { runAutoCalibration } from '../features/calibration/autoCalibration'
import { useVideoFrame } from '../features/video/useVideoFrame'
import { getCanvasCoordinates } from '../utils/canvas'
import { CollapsibleSidebarSection } from '../components/layout/CollapsibleSidebarSection'
import { AlgorithmHelpDrawer } from '../components/help/AlgorithmHelpDrawer'
import { TimeCalibrationPanel } from '../components/panels/TimeCalibrationPanel'
import { SpatialPanel } from '../components/panels/SpatialPanel'
import { ContactAngleManualPanel } from '../components/panels/ContactAngleManualPanel'
import { OverlayDisplayPanel } from '../components/panels/OverlayDisplayPanel'
import { defaultOverlayDisplay } from '../types/overlayDisplay'
import { ImageSettingsPanel } from '../components/panels/ImageSettingsPanel'
import { ImpactPanel } from '../components/panels/ImpactPanel'
import {
  ContourMaskRepairModal,
  type ContourMaskRepairSavePayload,
} from '../components/panels/ContourMaskRepairModal'
import {
  GlobalBackgroundSuppressModal,
  type GlobalBackgroundSuppressSavePayload,
} from '../components/panels/GlobalBackgroundSuppressModal'
import { ContourSegmentationPanel } from '../components/panels/ContourSegmentationPanel'
import { ContourSequencePanel } from '../components/panels/ContourSequencePanel'
import { SurfaceEnergyPanel } from '../components/panels/SurfaceEnergyPanel'
import { BubbleDynamicsPanel } from '../components/panels/BubbleDynamicsPanel'
import { JetDynamicsPanel } from '../components/panels/JetDynamicsPanel'
import { VideoCanvas } from '../components/video/VideoCanvas'
import { ApexHeightChart } from '../components/chart/ApexHeightChart'
import { BetaChart, type ChartPointClickMeta } from '../components/chart/BetaChart'
import { SurfaceEnergyChart } from '../components/chart/SurfaceEnergyChart'
import { VolumeConservationChart } from '../components/chart/VolumeConservationChart'
import { BubbleDynamicsResultChart } from '../components/chart/BubbleDynamicsResultChart'
import { JetDynamicsResultChart } from '../components/chart/JetDynamicsResultChart'
import type { AnalysisPoint, CalibrationPoint } from '../types/analysis'
import { calculateImpactResult, type ImpactResult } from '../features/analysis/impact'
import { computeContactTimeMs } from '../features/analysis/contactTime'
import { sanitizeFilenameSegment } from '../utils/filenameSanitize'
import { waitNextVideoFrame } from '../utils/videoFrame'
import type { VideoProjectEntry, VideoProjectSnapshot } from '../types/videoProject'
import {
  buildVideoProjectSnapshot,
  createEmptyVideoProjectSnapshot,
  normalizeSnapshotForApply,
} from '../features/analysis/videoProjectSnapshot'

function seekVideoToTime(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const d = video.duration
  const t =
    Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(timeSec, d - 1e-4)) : Math.max(0, timeSec)
  if (Math.abs(video.currentTime - t) < 1e-3) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener('seeked', onSeeked)
      window.clearTimeout(timeoutId)
      resolve()
    }
    const onSeeked = () => finish()
    /** 部分编码/管线不触发 seeked，会导致空泡选帧一直停在「正在解码…」 */
    const timeoutId = window.setTimeout(finish, 3500)
    video.addEventListener('seeked', onSeeked, { once: true })
    video.currentTime = t
  })
}

function newVideoProjectId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `vid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function App() {
  const [videoProjects, setVideoProjects] = useState<VideoProjectEntry[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [samplingFps, setSamplingFps] = useState(5000)
  const [exportedFps, setExportedFps] = useState(30)
  const [actualD0, setActualD0] = useState(1.87)
  const [zeroTime, setZeroTime] = useState(0)
  const [pixelScale, setPixelScale] = useState<number | null>(null)
  const [surfaceY, setSurfaceY] = useState<number | null>(null)
  const [intrinsicWidth, setIntrinsicWidth] = useState(0)
  const [intrinsicHeight, setIntrinsicHeight] = useState(0)
  const [threshold, setThreshold] = useState(128)
  /** 与图像设置一致：true 表示液滴偏亮、背景偏暗（二值取灰度 > 阈值 为液滴） */
  const [dropletIsBright, setDropletIsBright] = useState(false)
  const [fitPrecision, setFitPrecision] = useState(70)
  const [contactAngleMethod, setContactAngleMethod] = useState<ContactAngleMethod>('linearRegression')
  const [currentRealTime, setCurrentRealTime] = useState(0)
  const [videoAbsoluteTime, setVideoAbsoluteTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [algorithmHelpOpen, setAlgorithmHelpOpen] = useState(false)
  const [algorithmMode, setAlgorithmMode] = useState<'legacy' | 'neckGradient'>('neckGradient')
  const [preImpactFrames, setPreImpactFrames] = useState(5)
  const [fluidDensity, setFluidDensity] = useState(997)
  const [surfaceTension, setSurfaceTension] = useState(0.0728)
  const [gammaBw, setGammaBw] = useState(0.041)
  const [gammaBa, setGammaBa] = useState(0.0205)
  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null)
  const [isImpactRunning, setIsImpactRunning] = useState(false)
  /** 导出 Excel 文件名用；导入视频时默认取文件名（无扩展名） */
  const [sampleLabel, setSampleLabel] = useState('')
  const [isRefitting, setIsRefitting] = useState(false)
  /** 外轮廓序列：逐帧 seek + Moore 批量重算（勿与自动分析并行） */
  const [isBatchRecalcContours, setIsBatchRecalcContours] = useState(false)
  const [autoCalibError, setAutoCalibError] = useState<string | null>(null)
  const [overlayDisplay, setOverlayDisplay] = useState(() => ({ ...defaultOverlayDisplay }))

  const [contourSegMode, setContourSegMode] = useState<ContourSegmentationMode>('luminance')
  const [contourBgGray, setContourBgGray] = useState<Uint8Array | null>(null)
  const [contourDiffThr, setContourDiffThr] = useState(14)
  const [contourMorphClose, setContourMorphClose] = useState(2)
  /** 与外轮廓序列预览一致，驱动表面能/体积曲线的轮廓 SG */
  const [contourDisplaySmoothPct, setContourDisplaySmoothPct] = useState(40)
  const [contourDisplayPreserveBaseline, setContourDisplayPreserveBaseline] = useState(false)
  /** 表面能图中 **Φ** 的平滑（原始 W 差分之后）：MA 或 SG */
  const [dissipationSmoothMode, setDissipationSmoothMode] = useState<DissipationSmoothMode>('ma')
  const [contourRepairOpen, setContourRepairOpen] = useState(false)
  const [contourRepairFrame, setContourRepairFrame] = useState<ImageData | null>(null)
  /** 全序列共用：每帧二值掩码在固定画布坐标强制为背景（静止杂质） */
  const [globalBackgroundSuppressCircles, setGlobalBackgroundSuppressCircles] = useState<
    Array<{ x: number; y: number; rPx: number }>
  >([])
  const [globalSuppressModalOpen, setGlobalSuppressModalOpen] = useState(false)
  const [globalSuppressFrame, setGlobalSuppressFrame] = useState<ImageData | null>(null)
  /** 仅该矩形内做二值化与铺展/Moore（全画布坐标） */
  const [analysisRegion, setAnalysisRegion] = useState<AnalysisRegionRect | null>(null)
  const [analysisRegionSelectMode, setAnalysisRegionSelectMode] = useState(false)
  const [analysisRegionDrag, setAnalysisRegionDrag] = useState<{
    a: CalibrationPoint
    b: CalibrationPoint
  } | null>(null)

  const [cavityDynamicsSession, setCavityDynamicsSession] = useState<CavityDynamicsSessionPersisted>(() =>
    createDefaultCavityDynamicsSession(30, 0.01),
  )
  const [jetDynamicsSession, setJetDynamicsSession] = useState<JetDynamicsSessionPersisted>(() =>
    createDefaultJetDynamicsSession(30, 0.01),
  )
  const [isJetRunning, setIsJetRunning] = useState(false)
  const [jetRoiSelectMode, setJetRoiSelectMode] = useState(false)
  const [jetRoiDrag, setJetRoiDrag] = useState<{
    a: CalibrationPoint
    b: CalibrationPoint
  } | null>(null)
  const jetRoiDragRef = useRef<{ a: CalibrationPoint; b: CalibrationPoint } | null>(null)
  const [cavityRoiSelectMode, setCavityRoiSelectMode] = useState(false)
  const [cavityRoiDrag, setCavityRoiDrag] = useState<{
    a: CalibrationPoint
    b: CalibrationPoint
  } | null>(null)
  const [isCavityRunning, setIsCavityRunning] = useState(false)
  /** 空泡 ROI 框选过小时提示（非持久化） */
  const [cavityRoiUserMessage, setCavityRoiUserMessage] = useState<string | null>(null)
  /** 手绘单帧轮廓：冻结当前帧示意，点击加点、双击闭合后替换该帧几何量 */
  const [cavityManualTraceMode, setCavityManualTraceMode] = useState(false)
  const [cavityManualVertices, setCavityManualVertices] = useState<CalibrationPoint[]>([])
  const [cavityManualTargetResultIndex, setCavityManualTargetResultIndex] = useState<number | null>(null)
  const [cavityManualHover, setCavityManualHover] = useState<CalibrationPoint | null>(null)
  const cavityManualVerticesRef = useRef<CalibrationPoint[]>([])
  const cavityManualTargetResultIndexRef = useRef<number | null>(null)
  const cavityManualTraceModeRef = useRef(false)
  const cavityManualHoverRef = useRef<CalibrationPoint | null>(null)
  const cavityManualClickTimerRef = useRef<number | null>(null)
  /** 主图空泡曲线点击：结果索引 + 按需提取的 pipeline（不入快照） */
  const cavitySelectTokenRef = useRef(0)
  const [cavityChartPick, setCavityChartPick] = useState<{
    resultIndex: number | null
    loading: boolean
    pipeline: CavityPipelineDebug | null
  }>({ resultIndex: null, loading: false, pipeline: null })
  /** 与 state 同步；在 setState 后立刻 drawFrame 时须先写 ref，否则微任务仍读到旧闭包 */
  const cavityChartPickRef = useRef(cavityChartPick)
  useLayoutEffect(() => {
    cavityChartPickRef.current = cavityChartPick
  }, [cavityChartPick])

  const jetSelectTokenRef = useRef(0)
  const [jetChartPick, setJetChartPick] = useState<{
    frameIndex: number | null
    dropId: number | null
    loading: boolean
    contourPx: CalibrationPoint[] | null
    fittedEllipsePx: FittedEllipsePx | null
  }>({ frameIndex: null, dropId: null, loading: false, contourPx: null, fittedEllipsePx: null })
  const jetChartPickRef = useRef(jetChartPick)
  useLayoutEffect(() => {
    jetChartPickRef.current = jetChartPick
  }, [jetChartPick])

  useLayoutEffect(() => {
    cavityManualVerticesRef.current = cavityManualVertices
  }, [cavityManualVertices])
  useLayoutEffect(() => {
    cavityManualTargetResultIndexRef.current = cavityManualTargetResultIndex
  }, [cavityManualTargetResultIndex])
  useLayoutEffect(() => {
    cavityManualTraceModeRef.current = cavityManualTraceMode
  }, [cavityManualTraceMode])
  useLayoutEffect(() => {
    cavityManualHoverRef.current = cavityManualHover
  }, [cavityManualHover])

  /** 空泡 t=frame/fps 与主区帧索引对齐：fps = 导出 fe；mm/px = 1/(侧栏 px/mm) */
  useEffect(() => {
    setCavityDynamicsSession((prev) => {
      const fps = Math.max(1, Math.floor(exportedFps) || 1)
      let mmPerPx = prev.mmPerPx
      if (pixelScale != null && pixelScale > 0 && Number.isFinite(pixelScale)) {
        mmPerPx = 1 / pixelScale
      }
      if (prev.fps === fps && prev.mmPerPx === mmPerPx) return prev
      return { ...prev, fps, mmPerPx }
    })
  }, [exportedFps, pixelScale])

  useEffect(() => {
    setJetDynamicsSession((prev) => {
      let mmPerPx = prev.mmPerPx
      if (pixelScale != null && pixelScale > 0 && Number.isFinite(pixelScale)) {
        mmPerPx = 1 / pixelScale
      }
      if (prev.mmPerPx === mmPerPx) return prev
      return { ...prev, mmPerPx }
    })
  }, [pixelScale])

  const [state, dispatch] = useReducer(analysisReducer, initialAnalysisState)

  const activeVideoEntry = useMemo(
    () => videoProjects.find((p) => p.id === activeProjectId) ?? null,
    [videoProjects, activeProjectId],
  )
  const videoSrc = activeVideoEntry?.videoSrc ?? null

  const projectSnapshotsRef = useRef<Map<string, VideoProjectSnapshot>>(new Map())
  type SnapshotFields = Omit<VideoProjectSnapshot, 'savedVideoCurrentTime'>
  const snapshotSourceRef = useRef<SnapshotFields>({} as SnapshotFields)
  const activeProjectIdRef = useRef<string | null>(null)
  const videoProjectsRef = useRef(videoProjects)
  const pendingVideoSeekSecRef = useRef(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analysisRegionDragRef = useRef<{ a: CalibrationPoint; b: CalibrationPoint } | null>(null)
  const cavityRoiDragRef = useRef<{ a: CalibrationPoint; b: CalibrationPoint } | null>(null)
  const processedCanvasRef = useRef<HTMLCanvasElement>(null)
  const lastWidthRef = useRef(0)
  const dataRef = useRef<AnalysisPoint[]>([])

  const timeScaleFactor = useMemo(() => exportedFps / Math.max(1, samplingFps), [exportedFps, samplingFps])

  /** 与下方 ±1 帧（步长 1/导出帧率）一致：从 0 起计的视频帧索引，便于填写空泡起止帧 */
  const playbackFrameLabel = useMemo(() => {
    const fps = Math.max(1, Math.floor(exportedFps) || 1)
    const t = videoAbsoluteTime || 0
    const d = videoDuration || 0
    const idx = Math.floor(t * fps + 1e-9)
    const current = Math.max(0, idx)
    if (Number.isFinite(d) && d > 0) {
      const last = Math.max(0, Math.floor(d * fps + 1e-9))
      return { current: Math.min(last, current), last }
    }
    return { current, last: null as number | null }
  }, [videoAbsoluteTime, videoDuration, exportedFps])

  /** 背景灰度与当前视频分辨率一致时才可用于差分与预览 */
  const contourBgMatchesVideo = useMemo(
    () =>
      contourBgGray != null &&
      intrinsicWidth > 0 &&
      intrinsicHeight > 0 &&
      contourBgGray.length === intrinsicWidth * intrinsicHeight,
    [contourBgGray, intrinsicWidth, intrinsicHeight],
  )

  const binaryPreviewHandleLabel = useMemo(() => {
    if (contourSegMode !== 'absDiff') {
      return '亮度二值 — 拖此移动 · 滚轮缩放窗口'
    }
    if (!contourBgMatchesVideo) {
      return '差分模式：侧栏「采集背景」后此处显示 |ΔI−I_bg|（当前仍为亮度二值）'
    }
    return `差分二值 |ΔI−I_bg|>${contourDiffThr} — 拖此移动 · 滚轮缩放窗口`
  }, [contourSegMode, contourBgMatchesVideo, contourDiffThr])

  const contactAngleFitOpts = useMemo(
    (): ContactAngleFitOpts => ({
      method: contactAngleMethod,
      fitPrecision,
      maxDepthPx: linearRegressionDepthPxFromFitPrecision(fitPrecision),
      nearBaselineMaxPoints: linearRegressionMaxPointsFromFitPrecision(fitPrecision),
    }),
    [contactAngleMethod, fitPrecision],
  )
  const maxAbsDiameter = useMemo(() => {
    if (state.analysisData.length === 0) return 0
    return state.analysisData.reduce((max, p) => Math.max(max, p.absDiameter || 0), 0)
  }, [state.analysisData])

  const contactTimeMs = useMemo(
    () => computeContactTimeMs(state.analysisData),
    [state.analysisData],
  )

  const surfaceEnergyContourDisplay = useMemo(
    (): SurfaceEnergySeriesContourDisplayOpts => ({
      smoothPct: contourDisplaySmoothPct,
      preserveBaselineBand: contourDisplayPreserveBaseline,
    }),
    [contourDisplaySmoothPct, contourDisplayPreserveBaseline],
  )

  const dissipationComputeOptions = useMemo(
    () => ({ smoothMode: dissipationSmoothMode }),
    [dissipationSmoothMode],
  )

  const surfaceEnergySeries = useMemo(() => {
    if (
      surfaceY === null ||
      pixelScale === null ||
      pixelScale <= 0 ||
      state.analysisData.length === 0
    ) {
      return []
    }
    return computeSurfaceEnergySeries(
      state.analysisData,
      surfaceY,
      pixelScale,
      {
        gammaWa: surfaceTension,
        gammaBw,
        gammaBa,
        rhoW: fluidDensity,
        d0Mm: actualD0,
      },
      surfaceEnergyContourDisplay,
      dissipationComputeOptions,
    )
  }, [
    state.analysisData,
    surfaceY,
    pixelScale,
    surfaceTension,
    gammaBw,
    gammaBa,
    fluidDensity,
    actualD0,
    surfaceEnergyContourDisplay,
    dissipationComputeOptions,
  ])
  useEffect(() => {
    dataRef.current = state.analysisData
  }, [state.analysisData])

  useLayoutEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  useEffect(() => {
    videoProjectsRef.current = videoProjects
  }, [videoProjects])

  useEffect(() => {
    snapshotSourceRef.current = {
      analysis: state,
      samplingFps,
      exportedFps,
      actualD0,
      zeroTime,
      pixelScale,
      surfaceY,
      intrinsicWidth,
      intrinsicHeight,
      threshold,
      dropletIsBright,
      fitPrecision,
      contactAngleMethod,
      algorithmMode,
      preImpactFrames,
      fluidDensity,
      surfaceTension,
      gammaBw,
      gammaBa,
      impactResult,
      sampleLabel,
      overlayDisplay,
      contourSegMode,
      contourBgGray,
      contourDiffThr,
      contourMorphClose,
      contourDisplaySmoothPct,
      contourDisplayPreserveBaseline,
      dissipationSmoothMode,
      globalBackgroundSuppressCircles,
      analysisRegion,
      cavityDynamicsSession,
      jetDynamicsSession,
    }
  }, [
    state,
    samplingFps,
    exportedFps,
    actualD0,
    zeroTime,
    pixelScale,
    surfaceY,
    intrinsicWidth,
    intrinsicHeight,
    threshold,
    dropletIsBright,
    fitPrecision,
    contactAngleMethod,
    algorithmMode,
    preImpactFrames,
    fluidDensity,
    surfaceTension,
    gammaBw,
    gammaBa,
    impactResult,
    sampleLabel,
    overlayDisplay,
    contourSegMode,
    contourBgGray,
    contourDiffThr,
    contourMorphClose,
    contourDisplaySmoothPct,
    contourDisplayPreserveBaseline,
    dissipationSmoothMode,
    globalBackgroundSuppressCircles,
    analysisRegion,
    cavityDynamicsSession,
    jetDynamicsSession,
  ])

  const persistActiveProjectSnapshot = useCallback(() => {
    const id = activeProjectIdRef.current
    if (!id) return
    const videoEl = videoRef.current
    const t = videoEl && Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0
    projectSnapshotsRef.current.set(id, buildVideoProjectSnapshot(snapshotSourceRef.current, t))
  }, [])

  const applySnapshotToUi = useCallback((raw: VideoProjectSnapshot) => {
    const s = normalizeSnapshotForApply(raw)
    setSamplingFps(s.samplingFps)
    setExportedFps(s.exportedFps)
    setActualD0(s.actualD0)
    setZeroTime(s.zeroTime)
    setPixelScale(s.pixelScale)
    setSurfaceY(s.surfaceY)
    setIntrinsicWidth(s.intrinsicWidth)
    setIntrinsicHeight(s.intrinsicHeight)
    setThreshold(s.threshold)
    setDropletIsBright(s.dropletIsBright)
    setFitPrecision(s.fitPrecision)
    setContactAngleMethod(s.contactAngleMethod)
    setAlgorithmMode(s.algorithmMode)
    setPreImpactFrames(s.preImpactFrames)
    setFluidDensity(s.fluidDensity)
    setSurfaceTension(s.surfaceTension)
    setGammaBw(s.gammaBw)
    setGammaBa(s.gammaBa)
    setImpactResult(s.impactResult)
    setSampleLabel(s.sampleLabel)
    setOverlayDisplay({ ...defaultOverlayDisplay, ...s.overlayDisplay })
    setContourSegMode(s.contourSegMode)
    setContourBgGray(s.contourBgGray)
    setContourDiffThr(s.contourDiffThr)
    setContourMorphClose(s.contourMorphClose)
    setContourDisplaySmoothPct(s.contourDisplaySmoothPct)
    setContourDisplayPreserveBaseline(s.contourDisplayPreserveBaseline)
    setDissipationSmoothMode(s.dissipationSmoothMode)
    setGlobalBackgroundSuppressCircles(s.globalBackgroundSuppressCircles)
    setAnalysisRegion(s.analysisRegion)
    setCavityDynamicsSession(
      s.cavityDynamicsSession ??
        createDefaultCavityDynamicsSession(
          s.exportedFps,
          s.pixelScale != null && s.pixelScale > 0 ? 1 / s.pixelScale : 0.01,
        ),
    )
    setJetDynamicsSession(
      s.jetDynamicsSession ??
        createDefaultJetDynamicsSession(
          s.exportedFps,
          s.pixelScale != null && s.pixelScale > 0 ? 1 / s.pixelScale : 0.01,
        ),
    )
    dispatch({ type: 'hydrate', state: s.analysis })
    setAnalysisRegionSelectMode(false)
    setAnalysisRegionDrag(null)
    analysisRegionDragRef.current = null
    setCavityRoiSelectMode(false)
    setCavityRoiDrag(null)
    cavityRoiDragRef.current = null
    setJetRoiSelectMode(false)
    setJetRoiDrag(null)
    jetRoiDragRef.current = null
    cavitySelectTokenRef.current += 1
    setCavityChartPick({ resultIndex: null, loading: false, pipeline: null })
    setContourRepairOpen(false)
    setContourRepairFrame(null)
    setGlobalSuppressModalOpen(false)
    setGlobalSuppressFrame(null)
    setIsRefitting(false)
    setIsImpactRunning(false)
    setAutoCalibError(null)
    lastWidthRef.current = 0
  }, [dispatch])

  const resetUiToEmptySession = useCallback(() => {
    applySnapshotToUi(normalizeSnapshotForApply(createEmptyVideoProjectSnapshot('')))
  }, [applySnapshotToUi])

  const switchToVideoProject = useCallback(
    (targetId: string) => {
      if (targetId === activeProjectId) return
      persistActiveProjectSnapshot()
      const snap = projectSnapshotsRef.current.get(targetId)
      if (!snap) return
      const normalized = normalizeSnapshotForApply(snap)
      pendingVideoSeekSecRef.current = normalized.savedVideoCurrentTime
      flushSync(() => {
        setActiveProjectId(targetId)
        applySnapshotToUi(normalized)
        setVideoProjects((prev) =>
          prev.map((p) => (p.id === targetId ? { ...p, label: normalized.sampleLabel || p.label } : p)),
        )
      })
    },
    [activeProjectId, applySnapshotToUi, persistActiveProjectSnapshot],
  )

  const removeVideoProject = useCallback(
    (id: string, ev?: ReactMouseEvent) => {
      ev?.stopPropagation()
      const entry = videoProjectsRef.current.find((p) => p.id === id)
      if (!entry) return

      const wasActive = activeProjectIdRef.current === id
      if (!wasActive && activeProjectIdRef.current) persistActiveProjectSnapshot()

      URL.revokeObjectURL(entry.videoSrc)
      projectSnapshotsRef.current.delete(id)

      const others = videoProjectsRef.current.filter((p) => p.id !== id)

      if (!wasActive) {
        setVideoProjects(others)
        return
      }

      if (others.length === 0) {
        setVideoProjects([])
        setActiveProjectId(null)
        flushSync(() => resetUiToEmptySession())
        pendingVideoSeekSecRef.current = 0
        return
      }

      const nextId = others[0]!.id
      const nextSnap = projectSnapshotsRef.current.get(nextId)
      if (!nextSnap) {
        setVideoProjects(others)
        setActiveProjectId(nextId)
        return
      }
      const normalized = normalizeSnapshotForApply(nextSnap)
      pendingVideoSeekSecRef.current = normalized.savedVideoCurrentTime
      flushSync(() => {
        setVideoProjects(
          others.map((p) => (p.id === nextId ? { ...p, label: normalized.sampleLabel || p.label } : p)),
        )
        setActiveProjectId(nextId)
        applySnapshotToUi(normalized)
      })
    },
    [applySnapshotToUi, persistActiveProjectSnapshot, resetUiToEmptySession],
  )

  const addVideoFiles = useCallback(
    (files: File[]) => {
      const videoFiles = files.filter((f) => f.type.startsWith('video/'))
      if (videoFiles.length === 0) return
      setAutoCalibError(null)
      persistActiveProjectSnapshot()

      const additions: VideoProjectEntry[] = []
      for (const file of videoFiles) {
        const id = newVideoProjectId()
        const url = URL.createObjectURL(file)
        const stem = file.name.replace(/\.[^/.]+$/, '').trim()
        const label = stem.length > 0 ? stem : `视频 ${videoProjectsRef.current.length + additions.length + 1}`
        additions.push({ id, label, videoSrc: url })
        projectSnapshotsRef.current.set(id, createEmptyVideoProjectSnapshot(label))
      }

      const lastId = additions[additions.length - 1]!.id
      const initialSnap = normalizeSnapshotForApply(projectSnapshotsRef.current.get(lastId)!)
      pendingVideoSeekSecRef.current = initialSnap.savedVideoCurrentTime

      flushSync(() => {
        setVideoProjects((prev) => [...prev, ...additions])
        setActiveProjectId(lastId)
        applySnapshotToUi(initialSnap)
      })
    },
    [applySnapshotToUi, persistActiveProjectSnapshot],
  )

  useEffect(() => {
    return () => {
      for (const p of videoProjectsRef.current) {
        URL.revokeObjectURL(p.videoSrc)
      }
    }
  }, [])

  const buildFallbackLine = useCallback(
    (base: AnalysisPoint, canvasWidth?: number): AnalysisPoint => {
      const width = Math.max(120, (canvasWidth ?? intrinsicWidth) || 640)
      const centerX = width / 2
      const pxPerMm = pixelScale && pixelScale > 0 ? pixelScale : 50
      const safeD0 = actualD0 > 0 ? actualD0 : 1.87
      const atZeroMoment = Math.abs(base.absTime - zeroTime) <= 0.5 / Math.max(1, exportedFps)
      const fallbackPx = Math.max(24, Math.min(width * 0.28, safeD0 * pxPerMm))
      const subL = atZeroMoment ? centerX : centerX - fallbackPx / 2
      const subR = atZeroMoment ? centerX : centerX + fallbackPx / 2
      const absDiameter = atZeroMoment ? 0 : (subR - subL) / pxPerMm
      const beta = atZeroMoment ? 0 : absDiameter / safeD0
      return {
        ...base,
        subL,
        subR,
        absDiameter: +absDiameter.toFixed(3),
        beta: +beta.toFixed(4),
        isInvalid: true,
      }
    },
    [actualD0, exportedFps, intrinsicWidth, pixelScale, zeroTime],
  )

  const runContourExtract = useCallback(
    (
      imageData: ImageData,
      seedXPx: number,
      seedYPx: number,
      opts?: {
        suppressCircles?: ReadonlyArray<{ x: number; y: number; rPx: number }> | null
        luminanceThresholdOverride?: number | null
        /** absDiff：覆盖全局差分阈值（本帧）；null/undefined 表示用全局 */
        diffThresholdOverride?: number | null
        mooreStartSearch?: MooreContourStartSearch
        mooreRayRowPx?: number | null
        /** 与 `imageData` 同一坐标系下的撞击面 y：`buildAnalysisPipelineFrame` 的 `pipe.surfaceY`（全幅时等于全局 Surface Y，ROI 时为减去过 region.y 的值） */
        surfaceYPxForImage?: number
      } | null,
    ) => {
      if (surfaceY === null) return null
      const surfaceYPx = opts?.surfaceYPxForImage ?? surfaceY
      const effDiffThr =
        opts?.diffThresholdOverride != null && Number.isFinite(opts.diffThresholdOverride)
          ? Math.max(4, Math.min(80, Math.round(opts.diffThresholdOverride)))
          : contourDiffThr
      return extractDropletOuterContourPx({
        imageData,
        threshold,
        dropletIsBright,
        surfaceYPx,
        seedXPx,
        seedYPx,
        segmentationMode: contourSegMode,
        backgroundGray: contourSegMode === 'absDiff' ? contourBgGray : null,
        diffThreshold: effDiffThr,
        morphCloseIterations: contourMorphClose,
        manualSuppressCircles: opts?.suppressCircles ?? undefined,
        luminanceThresholdOverride: opts?.luminanceThresholdOverride ?? null,
        mooreStartSearch: opts?.mooreStartSearch ?? 'raster',
        mooreRayRowPx: opts?.mooreRayRowPx ?? null,
      })
    },
    [
      surfaceY,
      threshold,
      dropletIsBright,
      contourSegMode,
      contourBgGray,
      contourDiffThr,
      contourMorphClose,
    ],
  )

  const captureContourBackgroundFromCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
    setContourBgGray(imageDataToGrayUint8(id))
  }, [])

  const syntheticContourBackgroundFromCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx || surfaceY === null) return
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const sx = Math.round(canvas.width / 2)
    const sy = Math.round(surfaceY - 5)
    const g = syntheticBackgroundGrayFromFrame(id, threshold, dropletIsBright, surfaceY, sx, sy)
    if (g) setContourBgGray(g)
  }, [surfaceY, threshold, dropletIsBright])

  const openContourMaskRepair = useCallback(async () => {
    const idx = state.selectedIdx
    const videoEl = videoRef.current
    const pt = idx >= 0 ? state.analysisData[idx] : undefined
    if (!videoEl || !pt || surfaceY === null) return
    dispatch({ type: 'setPlaying', isPlaying: false })
    await seekVideoToTime(videoEl, pt.absTime)
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    drawFrameRef.current()
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    const raw = captureVideoFrameImageData(videoEl)
    if (!raw) return
    setContourRepairFrame(raw)
    setContourRepairOpen(true)
  }, [state.selectedIdx, state.analysisData, surfaceY, dispatch])

  const openGlobalBackgroundSuppressPaint = useCallback(async () => {
    const videoEl = videoRef.current
    const canvas = canvasRef.current
    if (!videoEl || !canvas || surfaceY === null) return
    dispatch({ type: 'setPlaying', isPlaying: false })
    const idx = state.selectedIdx
    if (idx >= 0 && idx < state.analysisData.length) {
      await seekVideoToTime(videoEl, state.analysisData[idx]!.absTime)
    }
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    drawFrameRef.current()
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    const raw = captureVideoFrameImageData(videoEl)
    if (!raw) return
    setGlobalSuppressFrame(raw)
    setGlobalSuppressModalOpen(true)
  }, [state.selectedIdx, state.analysisData, surfaceY, dispatch])

  const saveGlobalBackgroundSuppress = useCallback((payload: GlobalBackgroundSuppressSavePayload) => {
    setGlobalBackgroundSuppressCircles(payload.circles)
    setGlobalSuppressModalOpen(false)
    setGlobalSuppressFrame(null)
  }, [])

  const saveContourMaskRepair = useCallback(
    (payload: ContourMaskRepairSavePayload) => {
      const idx = state.selectedIdx
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d', { alpha: false })
      if (idx < 0 || idx >= state.analysisData.length || !canvas || !ctx || surfaceY === null) {
        setContourRepairOpen(false)
        setContourRepairFrame(null)
        return
      }
      const pt = state.analysisData[idx]!
      const videoEl = videoRef.current
      const imageData =
        (videoEl && captureVideoFrameImageData(videoEl)) ?? ctx.getImageData(0, 0, canvas.width, canvas.height)
      const pipe = buildAnalysisPipelineFrame(
        imageData,
        surfaceY,
        analysisRegion,
        mergeSuppressCircles(globalBackgroundSuppressCircles, payload.circles),
      )
      const seedContourX =
        Math.round(((pt.subL ?? canvas.width / 2) + (pt.subR ?? canvas.width / 2)) / 2) - pipe.ox
      const nextContourPerFrameThreshold =
        contourSegMode === 'luminance' && payload.luminanceThreshold !== undefined
          ? payload.luminanceThreshold === threshold
            ? undefined
            : payload.luminanceThreshold
          : pt.contourPerFrameThreshold

      const nextContourPerFrameDiffThreshold =
        contourSegMode === 'absDiff' && payload.diffThreshold !== undefined
          ? payload.diffThreshold === contourDiffThr
            ? undefined
            : payload.diffThreshold
          : pt.contourPerFrameDiffThreshold

      const contour =
        runContourExtract(pipe.imageData, seedContourX, pipe.surfaceY - 3, {
          surfaceYPxForImage: pipe.surfaceY,
          suppressCircles: pipe.circlesForCrop,
          luminanceThresholdOverride:
            contourSegMode === 'luminance' ? nextContourPerFrameThreshold ?? null : null,
          diffThresholdOverride:
            contourSegMode === 'absDiff' ? nextContourPerFrameDiffThreshold ?? null : null,
          mooreStartSearch: payload.mooreStrictOuterRaySeed ? 'horizontalRayLeft' : 'raster',
        }) ?? undefined
      const contourFull =
        contour != null && analysisRegion != null ? offsetContourToFullImage(contour, analysisRegion) : contour
      const mooreContourExtractOk =
        contourFull != null && contourFull.length >= MOORE_OUTER_CONTOUR_MIN_POINTS
      const patched = [...state.analysisData]
      patched[idx] = {
        ...pt,
        manualSuppressCircles: payload.circles.length > 0 ? payload.circles : undefined,
        contourPerFrameThreshold: nextContourPerFrameThreshold,
        contourPerFrameDiffThreshold: nextContourPerFrameDiffThreshold,
        mooreStrictOuterRaySeed: payload.mooreStrictOuterRaySeed ? true : undefined,
        outerContourPx: contourFull,
        mooreContourExtractOk,
      }
      dispatch({ type: 'setAnalysisData', analysisData: patched })
      setContourRepairOpen(false)
      setContourRepairFrame(null)
      requestAnimationFrame(() => drawFrameRef.current())
    },
    [
      state.selectedIdx,
      state.analysisData,
      surfaceY,
      contourSegMode,
      contourDiffThr,
      threshold,
      runContourExtract,
      dispatch,
      analysisRegion,
      globalBackgroundSuppressCircles,
    ],
  )

  const retryContourAltThresholdForSelectedFrame = useCallback(async () => {
    const idx = state.selectedIdx
    const videoEl = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (idx < 0 || idx >= state.analysisData.length || !videoEl || !canvas || !ctx || surfaceY === null)
      return
    if (contourSegMode !== 'luminance') return

    const pt = state.analysisData[idx]!
    dispatch({ type: 'setPlaying', isPlaying: false })
    await seekVideoToTime(videoEl, pt.absTime)
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    drawFrameRef.current()
    await new Promise<void>((r) => requestAnimationFrame(() => r()))

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pipe = buildAnalysisPipelineFrame(
      imageData,
      surfaceY,
      analysisRegion,
      mergeSuppressCircles(globalBackgroundSuppressCircles, pt.manualSuppressCircles ?? null),
    )
    const seedContourX =
      Math.round(((pt.subL ?? canvas.width / 2) + (pt.subR ?? canvas.width / 2)) / 2) - pipe.ox
    const alt = dropletIsBright
      ? Math.min(255, threshold + CONTOUR_LUMINANCE_ALT_RETRY_DELTA)
      : Math.max(0, threshold - CONTOUR_LUMINANCE_ALT_RETRY_DELTA)

    const contour =
      runContourExtract(pipe.imageData, seedContourX, pipe.surfaceY - 3, {
        surfaceYPxForImage: pipe.surfaceY,
        suppressCircles: pipe.circlesForCrop,
        luminanceThresholdOverride: alt,
        mooreStartSearch: pt.mooreStrictOuterRaySeed ? 'horizontalRayLeft' : 'raster',
      }) ?? null

    if (!contour || contour.length < MOORE_OUTER_CONTOUR_MIN_POINTS) return

    const contourFull =
      analysisRegion != null ? offsetContourToFullImage(contour, analysisRegion) : contour

    const patched = [...state.analysisData]
    patched[idx] = {
      ...pt,
      outerContourPx: contourFull,
      mooreContourExtractOk: true,
      contourPerFrameThreshold: alt,
    }
    dispatch({ type: 'setAnalysisData', analysisData: patched })
    requestAnimationFrame(() => drawFrameRef.current())
  }, [
    state.selectedIdx,
    state.analysisData,
    surfaceY,
    contourSegMode,
    threshold,
    dropletIsBright,
    runContourExtract,
    dispatch,
    analysisRegion,
    globalBackgroundSuppressCircles,
  ])

  const retryContourStrictOuterRayForSelectedFrame = useCallback(async () => {
    const idx = state.selectedIdx
    const videoEl = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (idx < 0 || idx >= state.analysisData.length || !videoEl || !canvas || !ctx || surfaceY === null)
      return

    const pt = state.analysisData[idx]!
    dispatch({ type: 'setPlaying', isPlaying: false })
    await seekVideoToTime(videoEl, pt.absTime)
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    drawFrameRef.current()
    await new Promise<void>((r) => requestAnimationFrame(() => r()))

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pipe = buildAnalysisPipelineFrame(
      imageData,
      surfaceY,
      analysisRegion,
      mergeSuppressCircles(globalBackgroundSuppressCircles, pt.manualSuppressCircles ?? null),
    )
    const seedContourX =
      Math.round(((pt.subL ?? canvas.width / 2) + (pt.subR ?? canvas.width / 2)) / 2) - pipe.ox

    const contour =
      runContourExtract(pipe.imageData, seedContourX, pipe.surfaceY - 3, {
        surfaceYPxForImage: pipe.surfaceY,
        suppressCircles: pipe.circlesForCrop,
        luminanceThresholdOverride: pt.contourPerFrameThreshold ?? null,
        mooreStartSearch: 'horizontalRayLeft',
      }) ?? null

    if (!contour || contour.length < MOORE_OUTER_CONTOUR_MIN_POINTS) return

    const contourFull =
      analysisRegion != null ? offsetContourToFullImage(contour, analysisRegion) : contour

    const patched = [...state.analysisData]
    patched[idx] = {
      ...pt,
      outerContourPx: contourFull,
      mooreContourExtractOk: true,
      mooreStrictOuterRaySeed: true,
    }
    dispatch({ type: 'setAnalysisData', analysisData: patched })
    requestAnimationFrame(() => drawFrameRef.current())
  }, [
    state.selectedIdx,
    state.analysisData,
    surfaceY,
    runContourExtract,
    dispatch,
    analysisRegion,
    globalBackgroundSuppressCircles,
  ])

  const resetContourDefaultsForSelectedFrame = useCallback(async () => {
    const idx = state.selectedIdx
    const videoEl = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (idx < 0 || idx >= state.analysisData.length || !videoEl || !canvas || !ctx || surfaceY === null)
      return

    const pt = state.analysisData[idx]!
    dispatch({ type: 'setPlaying', isPlaying: false })
    await seekVideoToTime(videoEl, pt.absTime)
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    drawFrameRef.current()
    await new Promise<void>((r) => requestAnimationFrame(() => r()))

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pipe = buildAnalysisPipelineFrame(
      imageData,
      surfaceY,
      analysisRegion,
      mergeSuppressCircles(globalBackgroundSuppressCircles, null),
    )
    const seedContourX =
      Math.round(((pt.subL ?? canvas.width / 2) + (pt.subR ?? canvas.width / 2)) / 2) - pipe.ox

    const contour =
      runContourExtract(pipe.imageData, seedContourX, pipe.surfaceY - 3, {
        surfaceYPxForImage: pipe.surfaceY,
        suppressCircles: pipe.circlesForCrop,
        luminanceThresholdOverride: null,
        mooreStartSearch: 'raster',
      }) ?? null

    const contourFull =
      contour != null && analysisRegion != null ? offsetContourToFullImage(contour, analysisRegion) : contour

    const mooreContourExtractOk =
      contourFull != null && contourFull.length >= MOORE_OUTER_CONTOUR_MIN_POINTS

    const patched = [...state.analysisData]
    patched[idx] = {
      ...pt,
      manualSuppressCircles: undefined,
      contourPerFrameThreshold: undefined,
      contourPerFrameDiffThreshold: undefined,
      mooreStrictOuterRaySeed: undefined,
      outerContourPx: contourFull ?? undefined,
      mooreContourExtractOk,
    }
    dispatch({ type: 'setAnalysisData', analysisData: patched })
    requestAnimationFrame(() => drawFrameRef.current())
  }, [
    state.selectedIdx,
    state.analysisData,
    surfaceY,
    runContourExtract,
    dispatch,
    analysisRegion,
    globalBackgroundSuppressCircles,
  ])

  const recalculateAllOuterContours = useCallback(async () => {
    if (state.isAnalyzing) return
    const videoEl = videoRef.current
    if (!videoEl || surfaceY === null) return
    const source = dataRef.current
    if (source.length === 0) return

    dispatch({ type: 'setPlaying', isPlaying: false })
    dispatch({ type: 'setAnalyzing', isAnalyzing: false })

    const restoreTime = videoEl.currentTime
    setIsBatchRecalcContours(true)
    try {
      const patched = [...source]
      for (let i = 0; i < patched.length; i++) {
        const pt = patched[i]!
        await seekVideoToTime(videoEl, pt.absTime)
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        await new Promise<void>((r) => requestAnimationFrame(() => r()))

        // 与「掩码橡皮擦 → 保存并重算轮廓」一致：必须用视频裸帧，不可用主画布（含基准线/铺展等叠加）
        let imageData = captureVideoFrameImageData(videoEl)
        if (!imageData) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
          imageData = captureVideoFrameImageData(videoEl)
        }
        if (!imageData) continue

        const pipe = buildAnalysisPipelineFrame(
          imageData,
          surfaceY,
          analysisRegion,
          mergeSuppressCircles(globalBackgroundSuppressCircles, pt.manualSuppressCircles ?? null),
        )

        // 与 saveContourMaskRepair 相同的单帧阈值规范化（与全局相同时视为不覆盖）
        const nextContourPerFrameThreshold =
          contourSegMode === 'luminance' && pt.contourPerFrameThreshold !== undefined
            ? pt.contourPerFrameThreshold === threshold
              ? undefined
              : pt.contourPerFrameThreshold
            : pt.contourPerFrameThreshold
        const nextContourPerFrameDiffThreshold =
          contourSegMode === 'absDiff' && pt.contourPerFrameDiffThreshold !== undefined
            ? pt.contourPerFrameDiffThreshold === contourDiffThr
              ? undefined
              : pt.contourPerFrameDiffThreshold
            : pt.contourPerFrameDiffThreshold

        const imgW = imageData.width
        const seedContourX =
          Math.round(((pt.subL ?? imgW / 2) + (pt.subR ?? imgW / 2)) / 2) - pipe.ox

        const contour =
          runContourExtract(pipe.imageData, seedContourX, pipe.surfaceY - 3, {
            surfaceYPxForImage: pipe.surfaceY,
            suppressCircles: pipe.circlesForCrop,
            luminanceThresholdOverride:
              contourSegMode === 'luminance' ? nextContourPerFrameThreshold ?? null : null,
            diffThresholdOverride:
              contourSegMode === 'absDiff' ? nextContourPerFrameDiffThreshold ?? null : null,
            mooreStartSearch: pt.mooreStrictOuterRaySeed ? 'horizontalRayLeft' : 'raster',
          }) ?? null

        const contourFull =
          contour != null && analysisRegion != null ? offsetContourToFullImage(contour, analysisRegion) : contour

        if (contourFull != null && contourFull.length >= MOORE_OUTER_CONTOUR_MIN_POINTS) {
          patched[i] = { ...pt, outerContourPx: contourFull, mooreContourExtractOk: true }
        }
      }

      dispatch({ type: 'setAnalysisData', analysisData: patched })

      if (Math.abs(videoEl.currentTime - restoreTime) > 1e-4) {
        await seekVideoToTime(videoEl, restoreTime)
      }
      queueMicrotask(() => drawFrameRef.current())
    } finally {
      setIsBatchRecalcContours(false)
    }
  }, [
    analysisRegion,
    contourDiffThr,
    contourSegMode,
    dispatch,
    globalBackgroundSuppressCircles,
    runContourExtract,
    state.isAnalyzing,
    surfaceY,
    threshold,
  ])

  const seekToCavityFrameStart = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
    const t = cavityDiscreteFrameSeekTimeSec(
      cavityDynamicsSession.frameStart,
      decodeFps,
      v.duration || 0,
    )
    void seekVideoToTime(v, t).then(() => drawFrameRef.current())
  }, [cavityDynamicsSession.frameStart, exportedFps])

  const toggleCavityRoiSelectMode = useCallback(() => {
    setCavityRoiSelectMode((m) => {
      const next = !m
      if (next) {
        setCavityRoiUserMessage(null)
        setJetRoiSelectMode(false)
        setJetRoiDrag(null)
        jetRoiDragRef.current = null
        setAnalysisRegionSelectMode(false)
        setAnalysisRegionDrag(null)
        analysisRegionDragRef.current = null
        queueMicrotask(() => {
          const vid = videoRef.current
          if (!vid) return
          const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
          const t = cavityDiscreteFrameSeekTimeSec(
            cavityDynamicsSession.frameStart,
            decodeFps,
            vid.duration || 0,
          )
          void seekVideoToTime(vid, t).then(() => drawFrameRef.current())
        })
      } else {
        setCavityRoiDrag(null)
        cavityRoiDragRef.current = null
      }
      return next
    })
  }, [cavityDynamicsSession.frameStart, exportedFps])

  const runCavityDynamicsAnalysis = useCallback(async () => {
    const videoEl = videoRef.current
    const roi = cavityDynamicsSession.roi
    if (!videoEl || !roi) return
    const {
      frameStart,
      frameEnd,
      mmPerPx,
      minPixels,
      invertOtsu,
      bubbleDark,
      sigmaNm,
      otsuRelaxEpsilon,
      morphCloseDiskRadiusPx,
    } = cavityDynamicsSession
    const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
    const physicsHz = Math.max(1, Math.floor(samplingFps) || 1)
    if (frameEnd < frameStart || decodeFps <= 0 || physicsHz <= 0 || mmPerPx <= 0) {
      setCavityDynamicsSession((p) => ({
        ...p,
        lastStopReason: 'invalid_range',
        lastResults: [],
        lastCollapseFrameIndex: null,
      }))
      return
    }

    dispatch({ type: 'setPlaying', isPlaying: false })
    dispatch({ type: 'setAnalyzing', isAnalyzing: false })

    cavitySelectTokenRef.current += 1
    setCavityChartPick({ resultIndex: null, loading: false, pipeline: null })

    const restoreTime = videoEl.currentTime
    setIsCavityRunning(true)
    const rows: CavityDynamicsFrameResult[] = []
    let collapseIdx: number | null = null
    let stopReason: CavityStopReason = 'complete'

    try {
      for (let fi = frameStart; fi <= frameEnd; fi++) {
        /** 物理时间轴：与侧栏「采样 fs」一致，秒 */
        const tPhysicsSec = fi / physicsHz
        const seekT = cavityDiscreteFrameSeekTimeSec(fi, decodeFps, videoEl.duration || 0)
        await seekVideoToTime(videoEl, seekT)
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        await new Promise<void>((r) => requestAnimationFrame(() => r()))

        let imageData = captureVideoFrameImageData(videoEl)
        if (!imageData) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
          imageData = captureVideoFrameImageData(videoEl)
        }
        if (!imageData) {
          rows.push(mergeFrameMeta(cavityExtractFailure('视频帧未就绪'), fi, tPhysicsSec))
          continue
        }

        const partial = extractCavityMetricsOneFrame(imageData, roi, {
          mmPerPx,
          minPixels,
          invertOtsu,
          bubbleDark,
          surfaceYPx: surfaceY,
          otsuRelaxEpsilon,
          morphCloseDiskRadiusPx,
        })
        const row = mergeFrameMeta(partial, fi, tPhysicsSec)
        rows.push(row)

        const collapse = collapseStopReasonFromRow(row)
        if (collapse === 'collapse_area') {
          collapseIdx = fi
          stopReason = 'collapse_area'
          break
        }
        if (isCavityDebrisAspectFailure(row)) {
          stopReason = 'debris_ar'
          break
        }
      }

      const processed = postprocessCavityDynamicsSeries(rows, physicsHz, sigmaNm)
      setCavityDynamicsSession((prev) => ({
        ...prev,
        lastResults: processed,
        lastCollapseFrameIndex: collapseIdx,
        lastStopReason: stopReason,
      }))

      if (Math.abs(videoEl.currentTime - restoreTime) > 1e-4) {
        await seekVideoToTime(videoEl, restoreTime)
      }
      queueMicrotask(() => drawFrameRef.current())
    } finally {
      setIsCavityRunning(false)
    }
  }, [cavityDynamicsSession, dispatch, surfaceY, exportedFps, samplingFps])

  const toggleJetRoiSelectMode = useCallback(() => {
    setJetRoiSelectMode((m) => {
      const next = !m
      if (next) {
        setCavityRoiSelectMode(false)
        setCavityRoiDrag(null)
        cavityRoiDragRef.current = null
        setAnalysisRegionSelectMode(false)
        setAnalysisRegionDrag(null)
        analysisRegionDragRef.current = null
        queueMicrotask(() => {
          const vid = videoRef.current
          if (!vid) return
          const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
          const t = cavityDiscreteFrameSeekTimeSec(
            jetDynamicsSession.frameStart,
            decodeFps,
            vid.duration || 0,
          )
          void seekVideoToTime(vid, t).then(() => drawFrameRef.current())
        })
      } else {
        setJetRoiDrag(null)
        jetRoiDragRef.current = null
      }
      return next
    })
  }, [jetDynamicsSession.frameStart, exportedFps])

  const runJetDynamicsAnalysis = useCallback(async () => {
    const videoEl = videoRef.current
    const roi = jetDynamicsSession.roi
    if (!videoEl || !roi) return
    const {
      frameStart,
      frameEnd,
      mmPerPx,
      minJetPixels,
      invertOtsu,
      bubbleDark,
      otsuRelaxEpsilon,
      morphCloseDiskRadiusPx,
    } = jetDynamicsSession
    const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
    const physicsHz = Math.max(1, Math.floor(samplingFps) || 1)
    if (frameEnd < frameStart || decodeFps <= 0 || physicsHz <= 0 || mmPerPx <= 0) {
      setJetDynamicsSession((p) => ({ ...p, dropTracks: [] }))
      return
    }

    dispatch({ type: 'setPlaying', isPlaying: false })
    dispatch({ type: 'setAnalyzing', isAnalyzing: false })

    jetSelectTokenRef.current += 1
    const clearedJetPick = {
      frameIndex: null,
      dropId: null,
      loading: false,
      contourPx: null as CalibrationPoint[] | null,
      fittedEllipsePx: null as FittedEllipsePx | null,
    }
    jetChartPickRef.current = clearedJetPick
    setJetChartPick(clearedJetPick)

    const restoreTime = videoEl.currentTime
    setIsJetRunning(true)
    const frames: JetBlobFrame[] = []

    try {
      for (let fi = frameStart; fi <= frameEnd; fi++) {
        const seekT = cavityDiscreteFrameSeekTimeSec(fi, decodeFps, videoEl.duration || 0)
        await seekVideoToTime(videoEl, seekT)
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        await new Promise<void>((r) => requestAnimationFrame(() => r()))

        let imageData = captureVideoFrameImageData(videoEl)
        if (!imageData) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
          imageData = captureVideoFrameImageData(videoEl)
        }
        if (!imageData) continue

        const bf = extractJetBlobsOneFrame(imageData, roi, {
          minJetPixels,
          invertOtsu,
          bubbleDark,
          otsuRelaxEpsilon,
          morphCloseDiskRadiusPx,
          frameIndex: fi,
        })
        if (bf) frames.push(bf)
      }

      const jetMacroEnergy: JetMacroEnergyParams = {
        rhoKgM3: fluidDensity,
        d0Mm: actualD0,
        u0Mps:
          impactResult != null && Number.isFinite(impactResult.velocityMps) ? impactResult.velocityMps : null,
        sigmaNm: surfaceTension,
      }
      const jetImpactTimeCalib: JetImpactTimeCalib = {
        exportedFps,
        samplingFps,
        zeroTimeSec: zeroTime,
        durationSec: videoDuration || 0,
      }
      const tracks = runJetDynamicsTracking(
        frames,
        mmPerPx,
        surfaceY,
        physicsHz,
        fluidDensity,
        jetMacroEnergy,
        jetImpactTimeCalib,
      )
      setJetDynamicsSession((prev) => ({ ...prev, dropTracks: tracks }))

      if (Math.abs(videoEl.currentTime - restoreTime) > 1e-4) {
        await seekVideoToTime(videoEl, restoreTime)
      }
      queueMicrotask(() => drawFrameRef.current())
    } finally {
      setIsJetRunning(false)
    }
  }, [
    jetDynamicsSession,
    dispatch,
    surfaceY,
    exportedFps,
    samplingFps,
    fluidDensity,
    actualD0,
    surfaceTension,
    impactResult,
    zeroTime,
    videoDuration,
  ])

  const exportJetDynamicsCsvCallback = useCallback(() => {
    exportJetDynamicsCsv(jetDynamicsSession.dropTracks, sampleLabel, {
      zeroTimeSec: zeroTime,
      exportedFps,
      samplingFps,
      durationSec: videoDuration || 0,
    })
  }, [jetDynamicsSession.dropTracks, sampleLabel, zeroTime, exportedFps, samplingFps, videoDuration])

  const applyJetCollapseFrameAsStart = useCallback(() => {
    const tc = cavityDynamicsSession.lastCollapseFrameIndex
    if (tc == null) return
    setJetDynamicsSession((p) => ({ ...p, frameStart: Math.max(0, tc) }))
  }, [cavityDynamicsSession.lastCollapseFrameIndex])

  const exportCavityDynamicsCsv = useCallback(() => {
    const rows = cavityDynamicsSession.lastResults
    if (!rows.length) return
    const mm = cavityDynamicsSession.mmPerPx
    const preamble = [
      '# Cavity dynamics export',
      '# time_ms = frame * (1000/fs), fs = sampling rate (Hz) from sidebar; video seek uses export fe.',
      '# kappa_apex_per_mm = kappa_apex_per_px / mm_per_px (curvature is 1/length; do NOT multiply by mm/px).',
      '# Vr_mm_s = d(Req)/dt (signed). Negative = collapse (radius decreasing), positive = expansion.',
      '# Vr_abs_mm_s = |Vr_mm_s| (magnitude of radial rate).',
      `# mm_per_px_used_for_kappa,${mm}`,
    ]
    const header = [
      'frame',
      'time_ms',
      'Ab_mm2',
      'Req_mm',
      'Xc_px',
      'Yc_px',
      'Zc_mm',
      'aspect_ratio',
      'kappa_apex_per_px',
      'kappa_apex_per_mm',
      'Vr_mm_s',
      'Vr_abs_mm_s',
      'Vz_mm_s',
      'dP_Pa',
      'note',
    ]
    const lines = [...preamble, header.join(',')]
    for (const r of rows) {
      lines.push(
        [
          r.frameIndex,
          r.timeSec * 1000,
          r.areaMm2 ?? '',
          r.reqMm ?? '',
          r.xcPx ?? '',
          r.ycPx ?? '',
          r.zcMm ?? '',
          r.aspectRatio ?? '',
          r.kappaApexPerPx ?? '',
          r.kappaApexPerMm ?? '',
          r.vrMmPerS ?? '',
          r.vrAbsMmPerS ?? '',
          r.vCentroidMmPerS ?? '',
          r.deltaPLaplacePa ?? '',
          (r.failedReason ?? '').replace(/,/g, ';'),
        ].join(','),
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stem = sanitizeFilenameSegment(sampleLabel.trim())
    a.download = `cavity-dynamics-${stem || 'export'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [cavityDynamicsSession.lastResults, cavityDynamicsSession.mmPerPx, sampleLabel])

  const exportAnalysisXlsx = useCallback(() => {
    const rows = dataRef.current
    if (!rows.length) return
    const kinRows = enrichWithContactLineKinematics(rows)
    const se =
      surfaceY !== null && pixelScale !== null && pixelScale > 0
        ? computeSurfaceEnergySeries(
            rows,
            surfaceY,
            pixelScale,
            {
              gammaWa: surfaceTension,
              gammaBw,
              gammaBa,
              rhoW: fluidDensity,
              d0Mm: actualD0,
            },
            {
              smoothPct: contourDisplaySmoothPct,
              preserveBaselineBand: contourDisplayPreserveBaseline,
            },
            dissipationComputeOptions,
          )
        : null
    const weStr =
      impactResult != null && Number.isFinite(impactResult.weber)
        ? impactResult.weber < 0.001
          ? impactResult.weber.toExponential(6)
          : impactResult.weber.toFixed(6)
        : '—'
    const weFooterDetail =
      impactResult != null && Number.isFinite(impactResult.weber)
        ? impactResult.weber < 0.001
          ? impactResult.weber.toExponential(6)
          : impactResult.weber.toFixed(6)
        : '—'

    const maxSpreadBeta =
      actualD0 > 0 && Number.isFinite(maxAbsDiameter) ? maxAbsDiameter / actualD0 : null

    const header = [
      '韦伯数We',
      '时间(ms)',
      '铺展系数β(相对)',
      '铺展直径D(mm,绝对)',
      '最大铺展系数βmax(相对D₀)',
      'θ左(°)',
      'θ右(°)',
      'θavr(°)',
      'θavr(rad)',
      '接触线速度v(mm/s)',
      '接触线加速度a(mm/s²)',
      'A_wa(mm²)',
      'A_base(mm²)',
      'V(mm³)',
      'Z_cm(mm)',
      'ΔE_σ(J)',
      'E_k(J)',
      'E_mech(J)',
      'W_diss(J)',
      'Phi(W)',
      'V_cm(m/s)',
      'V_spread(m/s)',
    ]
    const body = kinRows.map((p, i) => [
      weStr,
      p.time.toFixed(3),
      p.beta.toFixed(4),
      p.absDiameter.toFixed(3),
      maxSpreadBeta != null ? maxSpreadBeta.toFixed(4) : '—',
      p.contactAngleLeftDeg !== undefined ? p.contactAngleLeftDeg.toFixed(2) : '—',
      p.contactAngleRightDeg !== undefined ? p.contactAngleRightDeg.toFixed(2) : '—',
      p.contactAngleAvgDeg !== undefined ? p.contactAngleAvgDeg.toFixed(2) : '—',
      p.contactAngleAvgDeg !== undefined
        ? ((p.contactAngleAvgDeg * Math.PI) / 180).toFixed(6)
        : '—',
      p.contactLineVelocityMmS != null ? p.contactLineVelocityMmS.toFixed(3) : '—',
      p.contactLineAccelMmS2 != null ? p.contactLineAccelMmS2.toFixed(3) : '—',
      se?.[i]?.awaMm2 != null ? se[i].awaMm2!.toFixed(4) : '—',
      se?.[i]?.abaseMm2 != null ? se[i].abaseMm2!.toFixed(4) : '—',
      se?.[i]?.volumeMm3 != null ? se[i].volumeMm3!.toFixed(4) : '—',
      se?.[i]?.zCmMm != null ? se[i].zCmMm!.toFixed(4) : '—',
      se?.[i]?.deltaESigmaJ != null ? se[i].deltaESigmaJ!.toExponential(6) : '—',
      se?.[i]?.ekJ != null ? se[i].ekJ!.toExponential(6) : '—',
      se?.[i]?.emechanicalJ != null ? se[i].emechanicalJ!.toExponential(6) : '—',
      se?.[i]?.dissipationWorkJ != null ? se[i].dissipationWorkJ!.toExponential(6) : '—',
      se?.[i]?.dissipationPowerW != null ? se[i].dissipationPowerW!.toExponential(6) : '—',
      se?.[i]?.vCmMps != null ? se[i].vCmMps!.toExponential(6) : '—',
      se?.[i]?.vSpreadMps != null ? se[i].vSpreadMps!.toExponential(6) : '—',
    ])
    const ct = computeContactTimeMs(rows)
    const footer = [
      [],
      ['接触时间(ms)', ct !== null ? ct.toFixed(3) : '—（未检测到弹起）'],
      [],
      [
        '韦伯数 We',
        `各数据行首列相同；当前撞击分析：${weFooterDetail}。公式：We = ρ U² D₀ / γ（无量纲，ρ、γ、D₀ 为侧栏输入，U 为撞击速度分析回归速度）。未运行撞击分析时列为 —。`,
      ],
      [],
      [
        'θ：侧视基准线上的 Young 接触角；由液–气轮廓在接触线附近的 x(y) 线性回归斜率换算。θavr(rad) = θavr(°)×π/180。',
      ],
      [
        'v、a：由直径 D 差分得到；单侧接触线速度 v = ½·dD/dt（mm/s），加速度 a = dv/dt（mm/s²）；相邻帧后向差分；首点无 v，前两点无 a。',
      ],
      [
        'βmax：全序列最大铺展系数，βmax = Dmax/D₀（与各行 β=D/D₀ 定义一致）；D₀ 为侧栏初始直径(mm)。',
      ],
      [
        '【表格列 V_cm(m/s)】质心高度 Z_cm（由 Moore 外轮廓母线旋转体积分得到）对时间的导数，采用中心差分，单位 m/s。含义：液滴整体在竖直方向的平动快慢，不是接触线沿基底向外铺展的速度。',
      ],
      [
        '【表格列 V_spread(m/s)】铺展直径 D 对时间的导数的一半：½·dD/dt（D 单位 mm，时间与各行一致），中心差分，单位 m/s。与「接触线速度 v(mm/s)」同属铺展引起的半边速率；v 为相邻帧后向差分且单位为 mm/s，一般 v(mm/s)≈1000×V_spread(m/s)。两列用于动能 E_k = ½M[V_cm² + ½V_spread²]。',
      ],
      [
        '表面能与动能：ΔE_σ = γ_wa A_wa + (γ_bw−γ_ba) A_base − π D₀² γ_wa；A_wa、V、Z_cm 由母线积分；E_k = ½ M [V_cm² + ½ V_spread²]，M = πρ_w D₀³/6；E_mech = E_k + ΔE_σ 后对 E_mech 强制单调不增（展示）；W_diss：原始 max(0,E_mech(0)−(E_k+ΔE_σ))，不平滑；Phi：对原始 W_diss 差分后再 MA/SG（侧栏选项），输出 max(0,·)；E_mech(0) 优先首帧否则首个有效帧；V_cm、V_spread 见对应列；无标定或轮廓缺失时为 —。',
      ],
    ]
    const ws = XLSX.utils.aoa_to_sheet([header, ...body, ...footer])
    ws['!cols'] = [
      { wch: 16 },
      { wch: 12 },
      { wch: 18 },
      { wch: 20 },
      { wch: 22 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 14 },
      { wch: 18 },
      { wch: 20 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'AnalysisData')
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const fileStem = sanitizeFilenameSegment(sampleLabel.trim())
    XLSX.writeFile(wb, `droplet-analysis-${fileStem}-${ts}.xlsx`)
  }, [
    maxAbsDiameter,
    sampleLabel,
    impactResult,
    surfaceY,
    pixelScale,
    surfaceTension,
    gammaBw,
    gammaBa,
    fluidDensity,
    actualD0,
    contourDisplaySmoothPct,
    contourDisplayPreserveBaseline,
    dissipationComputeOptions,
  ])

  const updateProcessedPreview = useCallback(
    (fullImageData: ImageData) => {
      const canvas = processedCanvasRef.current
      if (!canvas || intrinsicWidth === 0 || intrinsicHeight === 0) return
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return
      const w = 320
      const h = Math.floor((w * intrinsicHeight) / intrinsicWidth)
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h

      const fullW = fullImageData.width
      const fullH = fullImageData.height
      const surfaceRowCap = surfaceY !== null ? Math.floor(surfaceY) : null

      const useAbsDiff = contourSegMode === 'absDiff' && contourBgMatchesVideo && contourBgGray != null
      const useFullPipelineMask =
        surfaceY !== null &&
        fullW === intrinsicWidth &&
        fullH === intrinsicHeight &&
        (useAbsDiff || contourSegMode === 'luminance')

      let maskFull: Uint8Array | null = null
      if (useFullPipelineMask) {
        maskFull = buildForegroundMaskForContour({
          imageData: fullImageData,
          threshold,
          dropletIsBright,
          surfaceYPx: surfaceY,
          segmentationMode: contourSegMode,
          backgroundGray: useAbsDiff ? contourBgGray : null,
          diffThreshold: contourDiffThr,
          morphCloseIterations: contourMorphClose,
        })
      }

      const imgData = ctx.createImageData(w, h)
      for (let i = 0; i < imgData.data.length; i += 4) {
        const p = i >> 2
        const sx = p % w
        const sy = (p / w) | 0
        const fy = Math.min(fullH - 1, Math.floor((sy * fullH) / Math.max(1, h)))
        const fx = Math.min(fullW - 1, Math.floor((sx * fullW) / Math.max(1, w)))
        const outsideAnalysisRoi =
          analysisRegion != null &&
          (fx < analysisRegion.x ||
            fx >= analysisRegion.x + analysisRegion.w ||
            fy < analysisRegion.y ||
            fy >= analysisRegion.y + analysisRegion.h)

        let v = 255
        if (surfaceRowCap !== null && fy > surfaceRowCap) {
          v = 255
        } else if (outsideAnalysisRoi) {
          v = 255
        } else if (maskFull) {
          v = maskFull[fy * fullW + fx] ? 0 : 255
        } else {
          const o = (fy * fullW + fx) * 4
          const gray =
            (fullImageData.data[o]! + fullImageData.data[o + 1]! + fullImageData.data[o + 2]!) / 3
          if (useAbsDiff && contourBgGray) {
            const bg = contourBgGray[fy * fullW + fx]!
            v = Math.abs(gray - bg) > contourDiffThr ? 0 : 255
          } else {
            v = isDropletGray(gray, threshold, dropletIsBright) ? 0 : 255
          }
        }
        imgData.data[i] = v
        imgData.data[i + 1] = v
        imgData.data[i + 2] = v
        imgData.data[i + 3] = 255
      }
      ctx.putImageData(imgData, 0, 0)
    },
    [
      analysisRegion,
      contourBgGray,
      contourBgMatchesVideo,
      contourDiffThr,
      contourMorphClose,
      contourSegMode,
      dropletIsBright,
      intrinsicHeight,
      intrinsicWidth,
      surfaceY,
      threshold,
    ],
  )

  const drawFrame = useCallback(() => {
    const videoEl = videoRef.current
    const canvas = canvasRef.current
    if (!videoEl || !canvas) return
    if (videoEl.videoWidth > 0 && (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight)) {
      canvas.width = videoEl.videoWidth
      canvas.height = videoEl.videoHeight
      setIntrinsicWidth(videoEl.videoWidth)
      setIntrinsicHeight(videoEl.videoHeight)
      setVideoDuration(videoEl.duration || 0)
    }
    if (videoEl.readyState >= 2) {
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
      updateProcessedPreview(ctx.getImageData(0, 0, canvas.width, canvas.height))

      if (overlayDisplay.baseline && surfaceY !== null) {
        ctx.save()
        ctx.strokeStyle = '#ef4444'
        ctx.setLineDash([10, 6])
        ctx.lineWidth = Math.max(1.5, intrinsicWidth / 1200)
        ctx.beginPath()
        ctx.moveTo(0, surfaceY)
        ctx.lineTo(canvas.width, surfaceY)
        ctx.stroke()
        ctx.restore()
      }

      if (overlayDisplay.autoCalibCircle && state.autoCalibResult) {
        const { dropletX, dropletY, radius } = state.autoCalibResult
        ctx.save()
        ctx.strokeStyle = '#3b82f6'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(dropletX, dropletY, radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      if (overlayDisplay.impactVelocity && impactResult) {
        const { firstCircle: fc, lastCircle: lc } = impactResult
        ctx.save()
        ctx.strokeStyle = '#22c55e'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(fc.centerX, fc.centerY, fc.radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = 'rgba(34, 197, 94, 0.12)'
        ctx.fill()

        ctx.strokeStyle = '#a855f7'
        ctx.beginPath()
        ctx.arc(lc.centerX, lc.centerY, lc.radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = 'rgba(168, 85, 247, 0.12)'
        ctx.fill()

        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 2.5
        ctx.setLineDash([8, 4])
        ctx.beginPath()
        ctx.moveTo(fc.centerX, fc.centerY)
        ctx.lineTo(lc.centerX, lc.centerY)
        ctx.stroke()
        ctx.setLineDash([])
        const angle = Math.atan2(lc.centerY - fc.centerY, lc.centerX - fc.centerX)
        const ah = 14
        ctx.fillStyle = '#fbbf24'
        ctx.beginPath()
        ctx.moveTo(lc.centerX, lc.centerY)
        ctx.lineTo(lc.centerX - ah * Math.cos(angle - 0.35), lc.centerY - ah * Math.sin(angle - 0.35))
        ctx.lineTo(lc.centerX - ah * Math.cos(angle + 0.35), lc.centerY - ah * Math.sin(angle + 0.35))
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }

      if (overlayDisplay.spreadFit && state.selectedIdx !== -1 && surfaceY !== null) {
        const point = dataRef.current[state.selectedIdx]
        if (point && point.subL !== undefined && point.subR !== undefined) {
          const spreadChordPx = Math.abs(point.subR - point.subL)
          /** 刚接触或数值直径≈0 时不画橙色铺展弦（避免 t=0 仍显示伪宽度） */
          const showSpreadChord =
            spreadChordPx >= 2 &&
            Number.isFinite(point.absDiameter) &&
            point.absDiameter > 1e-8

          if (point.ptsL && point.ptsR) {
            const spreadFitPrec =
              point.contactAngleFitPrecision != null && Number.isFinite(point.contactAngleFitPrecision)
                ? Math.max(0, Math.min(100, Math.round(point.contactAngleFitPrecision)))
                : fitPrecision

            const drawSplineCurve = (
              pts: Array<{ x: number; y: number }>,
              handleX: number,
              isLeft: boolean,
              otherFootX: number | undefined,
            ) => {
              const drawPts = buildSpreadSplineDrawPoints(
                pts,
                surfaceY,
                handleX,
                isLeft,
                spreadFitPrec,
                otherFootX,
                'overlay',
              )
              if (!drawPts || drawPts.length < 2) return
              const spline = createPchipSpline(
                drawPts.map((p) => p.y),
                drawPts.map((p) => p.x),
              )
              const yMin = drawPts[0].y
              const yMax = drawPts[drawPts.length - 1].y
              const drawTop = yMin
              const drawBottom = Math.min(yMax, surfaceY)

              if (drawBottom - drawTop < 2) return

              /**
               * 脚附近：PCHIP 易过冲；原始边点在 y≈surfaceY 的行上常沿二值底边横向密采样，折线仍会画出「基线尾巴」。
               * 样条在距基准线 footBandPx 以上结束；原始折线只取 y ≤ surfaceY−baselineRawExclusionPx，再直线接到触点。
               */
              const footBandPx = 40
              const baselineRawExclusionPx = 5
              const yRawMax = surfaceY - baselineRawExclusionPx
              const ySplineEnd = Math.min(Math.floor(drawBottom), Math.floor(surfaceY - footBandPx), Math.floor(yRawMax - 1))

              ctx.save()
              ctx.beginPath()
              ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)'
              ctx.lineWidth = 3
              ctx.setLineDash([6, 4])

              const drawFootRawPolyline = () => {
                let band = pts.filter((p) => p.y > ySplineEnd && p.y <= yRawMax)
                if (
                  otherFootX !== undefined &&
                  Number.isFinite(handleX) &&
                  Number.isFinite(otherFootX) &&
                  Math.abs(otherFootX - handleX) > 2
                ) {
                  band = band.filter((p) => {
                    const dSelf = Math.abs(p.x - handleX)
                    const dOther = Math.abs(p.x - otherFootX)
                    return dSelf <= dOther + 1e-4
                  })
                }
                band.sort((a, b) => a.y - b.y || a.x - b.x)
                for (const p of band) {
                  ctx.lineTo(p.x, p.y)
                }
                ctx.lineTo(handleX, surfaceY)
              }

              if (ySplineEnd <= drawTop + 0.5) {
                let band = pts.filter((p) => p.y >= drawTop - 0.5 && p.y <= yRawMax)
                if (
                  otherFootX !== undefined &&
                  Number.isFinite(handleX) &&
                  Number.isFinite(otherFootX) &&
                  Math.abs(otherFootX - handleX) > 2
                ) {
                  band = band.filter((p) => {
                    const dSelf = Math.abs(p.x - handleX)
                    const dOther = Math.abs(p.x - otherFootX)
                    return dSelf <= dOther + 1e-4
                  })
                }
                band.sort((a, b) => a.y - b.y || a.x - b.x)
                if (band.length < 1) return
                ctx.moveTo(band[0]!.x, band[0]!.y)
                for (let i = 1; i < band.length; i++) ctx.lineTo(band[i]!.x, band[i]!.y)
                ctx.lineTo(handleX, surfaceY)
              } else {
                const x0 = spline(drawTop)
                if (!Number.isFinite(x0)) return
                ctx.moveTo(x0, drawTop)
                for (let y = Math.ceil(drawTop) + 1; y <= ySplineEnd; y++) {
                  const x = spline(y)
                  if (!Number.isFinite(x)) continue
                  ctx.lineTo(x, y)
                }
                drawFootRawPolyline()
              }
              ctx.stroke()
              ctx.restore()
            }

            drawSplineCurve(point.ptsL, point.subL, true, point.subR)
            drawSplineCurve(point.ptsR, point.subR, false, point.subL)
          }

          if (showSpreadChord) {
            ctx.save()
            ctx.beginPath()
            ctx.strokeStyle = 'rgba(249, 115, 22, 0.95)'
            ctx.lineWidth = 4
            ctx.setLineDash([])
            ctx.moveTo(point.subL, surfaceY)
            ctx.lineTo(point.subR, surfaceY)
            ctx.stroke()

            const handleRadius = Math.max(5, intrinsicWidth / 250)
            const handleAlpha = state.draggingHandle ? 0.2 : 0.5
            ctx.fillStyle = `rgba(59, 130, 246, ${handleAlpha})`
            ctx.beginPath()
            ctx.arc(point.subL, surfaceY, handleRadius, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            ctx.arc(point.subR, surfaceY, handleRadius, 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
          }

          ctx.save()
          const fs = Math.max(11, Math.min(17, intrinsicWidth / 82))
          ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`
          const lines = showSpreadChord
            ? [
                '液–气界面（青虚线：样条 + 触点带直线接到铺展柄）',
                '基底/液接触直径（橙线：铺展宽度）',
              ]
            : [
                '液–气界面（青虚线：样条 + 触点带直线衔接）',
                '铺展直径≈0：不显示橙色接触弦（刚接触或无效宽）',
              ]
          let ly = 22
          for (const line of lines) {
            ctx.strokeStyle = 'rgba(15, 23, 42, 0.92)'
            ctx.lineWidth = 4
            ctx.lineJoin = 'round'
            ctx.strokeText(line, 12, ly)
            ctx.fillStyle = 'rgba(248, 250, 252, 0.96)'
            ctx.fillText(line, 12, ly)
            ly += fs + 6
          }
          ctx.restore()
        }
      }

      if (
        overlayDisplay.contactAngleConstruction &&
        state.selectedIdx !== -1 &&
        surfaceY !== null
      ) {
        const point = dataRef.current[state.selectedIdx]
        if (
          point &&
          point.ptsL &&
          point.ptsR &&
          point.subL !== undefined &&
          point.subR !== undefined
        ) {
          const thetaOpts = mergeContactAngleFitOptsForPoint(point, contactAngleFitOpts)
          const gL = getContactAngleFitGeometry(
            point.ptsL,
            surfaceY,
            'left',
            thetaOpts,
            point.subL,
            point.subR,
          )
          const gR = getContactAngleFitGeometry(
            point.ptsR,
            surfaceY,
            'right',
            thetaOpts,
            point.subR,
            point.subL,
          )
          const scale = canvas.width
          if (gL) {
            drawContactAngleFitOverlay(
              ctx,
              surfaceY,
              point.subL,
              gL,
              'left',
              { accent: '#4ade80', accentMuted: 'rgba(74, 222, 128, 0.38)' },
              scale,
              point.contactAngleLeftDeg ?? null,
            )
          }
          if (gR) {
            drawContactAngleFitOverlay(
              ctx,
              surfaceY,
              point.subR,
              gR,
              'right',
              { accent: '#facc15', accentMuted: 'rgba(250, 204, 21, 0.4)' },
              scale,
              point.contactAngleRightDeg ?? null,
            )
          }
        }
      }

      if (analysisRegion) {
        const { x, y, w, h } = analysisRegion
        ctx.save()
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.95)'
        ctx.lineWidth = 2.5
        ctx.setLineDash([6, 4])
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1))
        ctx.setLineDash([])
        ctx.restore()
      }
      if (analysisRegionSelectMode && analysisRegionDrag) {
        const rx = Math.min(analysisRegionDrag.a.x, analysisRegionDrag.b.x)
        const ry = Math.min(analysisRegionDrag.a.y, analysisRegionDrag.b.y)
        const rw = Math.abs(analysisRegionDrag.b.x - analysisRegionDrag.a.x)
        const rh = Math.abs(analysisRegionDrag.b.y - analysisRegionDrag.a.y)
        ctx.save()
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)'
        ctx.lineWidth = 2
        ctx.setLineDash([4, 4])
        ctx.strokeRect(rx, ry, Math.max(1, rw), Math.max(1, rh))
        ctx.setLineDash([])
        ctx.restore()
      }

      if (cavityDynamicsSession.roi) {
        const { x, y, w, h } = cavityDynamicsSession.roi
        ctx.save()
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.92)'
        ctx.lineWidth = 2.5
        ctx.setLineDash([8, 5])
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1))
        ctx.setLineDash([])
        ctx.restore()
      }
      if (cavityRoiSelectMode && cavityRoiDrag) {
        const rx = Math.min(cavityRoiDrag.a.x, cavityRoiDrag.b.x)
        const ry = Math.min(cavityRoiDrag.a.y, cavityRoiDrag.b.y)
        const rw = Math.abs(cavityRoiDrag.b.x - cavityRoiDrag.a.x)
        const rh = Math.abs(cavityRoiDrag.b.y - cavityRoiDrag.a.y)
        ctx.save()
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.95)'
        ctx.lineWidth = 2
        ctx.setLineDash([4, 4])
        ctx.strokeRect(rx, ry, Math.max(1, rw), Math.max(1, rh))
        ctx.setLineDash([])
        ctx.restore()
      }

      if (jetDynamicsSession.roi) {
        const { x, y, w, h } = jetDynamicsSession.roi
        ctx.save()
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.95)'
        ctx.lineWidth = 2.5
        ctx.setLineDash([10, 5])
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1))
        ctx.setLineDash([])
        ctx.restore()
      }
      if (jetRoiSelectMode && jetRoiDrag) {
        const rx = Math.min(jetRoiDrag.a.x, jetRoiDrag.b.x)
        const ry = Math.min(jetRoiDrag.a.y, jetRoiDrag.b.y)
        const rw = Math.abs(jetRoiDrag.b.x - jetRoiDrag.a.x)
        const rh = Math.abs(jetRoiDrag.b.y - jetRoiDrag.a.y)
        ctx.save()
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)'
        ctx.lineWidth = 2
        ctx.setLineDash([4, 4])
        ctx.strokeRect(rx, ry, Math.max(1, rw), Math.max(1, rh))
        ctx.setLineDash([])
        ctx.restore()
      }

      if (cavityManualTraceModeRef.current) {
        const mv = cavityManualVerticesRef.current
        const hv = cavityManualHoverRef.current
        if (mv.length > 0 || hv) {
          ctx.save()
          ctx.strokeStyle = 'rgba(253, 186, 116, 0.98)'
          ctx.fillStyle = 'rgba(253, 186, 116, 0.92)'
          ctx.lineWidth = Math.max(2, intrinsicWidth / 520)
          if (mv.length > 0) {
            ctx.beginPath()
            ctx.moveTo(mv[0]!.x, mv[0]!.y)
            for (let i = 1; i < mv.length; i++) ctx.lineTo(mv[i]!.x, mv[i]!.y)
            if (hv) ctx.lineTo(hv.x, hv.y)
            ctx.stroke()
            for (const p of mv) {
              ctx.beginPath()
              ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
              ctx.fill()
            }
          }
          ctx.restore()
        }
      }

      if (overlayDisplay.bubbleCavityContourOverlay) {
        const pick = cavityChartPickRef.current
        const pickDbg = pick.pipeline
        if (pickDbg) {
          const ri = pick.resultIndex
          const smooth = pickDbg.smoothContourCanvas
          const raw = pickDbg.rawContourCanvas
          const pts = smooth.length > 0 ? smooth : raw
          if (pts.length > 0 && ri != null && ri >= 0 && ri < cavityDynamicsSession.lastResults.length) {
            const row = cavityDynamicsSession.lastResults[ri]!
            ctx.save()
            ctx.strokeStyle =
              smooth.length > 0 ? 'rgba(34, 211, 238, 0.92)' : 'rgba(251, 191, 36, 0.88)'
            ctx.setLineDash(smooth.length > 0 ? [] : [6, 4])
            ctx.lineWidth = Math.max(2, intrinsicWidth / 700)
            ctx.beginPath()
            ctx.moveTo(pts[0]!.x, pts[0]!.y)
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
            ctx.closePath()
            ctx.stroke()
            ctx.setLineDash([])
            if (row.xcPx != null && row.ycPx != null) {
              ctx.fillStyle = 'rgba(250, 250, 250, 0.92)'
              ctx.strokeStyle = 'rgba(8, 47, 73, 0.85)'
              ctx.lineWidth = 1.2
              ctx.beginPath()
              ctx.arc(row.xcPx, row.ycPx, 4.5, 0, Math.PI * 2)
              ctx.fill()
              ctx.stroke()
            }
            ctx.restore()
          }
        }
      }

      if (overlayDisplay.jetDynamicsContourOverlay) {
        const pick = jetChartPickRef.current
        const fe = pick.fittedEllipsePx
        const pts = pick.contourPx
        const drawPoly = pts && pts.length >= 8
        if (fe || drawPoly) {
          ctx.save()
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.92)'
          ctx.lineWidth = Math.max(2, intrinsicWidth / 700)
          if (fe) {
            const { cx, cy, semiMajorPx: a, semiMinorPx: b, phiRad: phi } = fe
            ctx.beginPath()
            const nSeg = 96
            for (let k = 0; k <= nSeg; k++) {
              const t = (k / nSeg) * Math.PI * 2
              const x = cx + a * Math.cos(t) * Math.cos(phi) - b * Math.sin(t) * Math.sin(phi)
              const y = cy + a * Math.cos(t) * Math.sin(phi) + b * Math.sin(t) * Math.cos(phi)
              if (k === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.closePath()
            ctx.stroke()
          } else if (drawPoly) {
            ctx.beginPath()
            ctx.moveTo(pts![0]!.x, pts![0]!.y)
            for (let i = 1; i < pts!.length; i++) ctx.lineTo(pts![i]!.x, pts![i]!.y)
            ctx.closePath()
            ctx.stroke()
          }
          ctx.restore()
        }
      }

      if (overlayDisplay.scaleBar && pixelScale && pixelScale > 0) {
        const barPx = pixelScale
        ctx.save()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(40, canvas.height - 40)
        ctx.lineTo(40 + barPx, canvas.height - 40)
        ctx.stroke()
        ctx.restore()
      }
    }
    const abs = videoEl.currentTime || 0
    setVideoAbsoluteTime(abs)
    setCurrentRealTime((abs - zeroTime) * timeScaleFactor * 1000)
  }, [
    exportedFps,
    intrinsicWidth,
    pixelScale,
    state.autoCalibResult,
    state.draggingHandle,
    state.isAnalyzing,
    state.selectedIdx,
    surfaceY,
    fitPrecision,
    contactAngleFitOpts,
    impactResult,
    overlayDisplay,
    timeScaleFactor,
    updateProcessedPreview,
    zeroTime,
    analysisRegion,
    analysisRegionDrag,
    analysisRegionSelectMode,
    cavityDynamicsSession,
    cavityRoiDrag,
    cavityRoiSelectMode,
    jetDynamicsSession,
    jetRoiDrag,
    jetRoiSelectMode,
  ])

  const drawFrameRef = useRef(drawFrame)
  useLayoutEffect(() => {
    drawFrameRef.current = drawFrame
  }, [drawFrame])

  const selectCavityChartRow = useCallback(
    async (index: number) => {
      const token = ++cavitySelectTokenRef.current
      const vid = videoRef.current
      const roi = cavityDynamicsSession.roi
      const row = cavityDynamicsSession.lastResults[index]
      if (!vid || !roi || !row) return

      dispatch({ type: 'setPlaying', isPlaying: false })
      setOverlayDisplay((p) => ({ ...p, bubbleCavityContourOverlay: true }))
      const loadingPick = { resultIndex: index, loading: true, pipeline: null as CavityPipelineDebug | null }
      cavityChartPickRef.current = loadingPick
      setCavityChartPick(loadingPick)

      const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
      const seekT = cavityDiscreteFrameSeekTimeSec(row.frameIndex, decodeFps, vid.duration || 0)
      await seekVideoToTime(vid, seekT)
      await waitNextVideoFrame(vid)
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      await new Promise<void>((r) => requestAnimationFrame(() => r()))

      const manualVerts = row.manualContourCanvas
      if (manualVerts && manualVerts.length >= 3) {
        if (token !== cavitySelectTokenRef.current) return
        const pxArea =
          row.pixelArea != null && row.pixelArea > 0
            ? row.pixelArea
            : Math.max(1, Math.round(polygonShoelaceAreaPx(manualVerts)))
        const pickDbg = cavityPipelineDebugFromManualVertices(manualVerts, pxArea)
        const donePick = { resultIndex: index, loading: false, pipeline: pickDbg }
        cavityChartPickRef.current = donePick
        setCavityChartPick(donePick)
        queueMicrotask(() => drawFrameRef.current())
        return
      }

      let imageData = captureVideoFrameImageData(vid)
      if (!imageData) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        imageData = captureVideoFrameImageData(vid)
      }

      if (token !== cavitySelectTokenRef.current) return

      if (!imageData) {
        const emptyPick = { resultIndex: index, loading: false, pipeline: null as CavityPipelineDebug | null }
        cavityChartPickRef.current = emptyPick
        setCavityChartPick(emptyPick)
        queueMicrotask(() => drawFrameRef.current())
        return
      }

      let partial: ReturnType<typeof extractCavityMetricsOneFrame>
      try {
        partial = extractCavityMetricsOneFrame(imageData, roi, {
          mmPerPx: cavityDynamicsSession.mmPerPx,
          minPixels: cavityDynamicsSession.minPixels,
          invertOtsu: cavityDynamicsSession.invertOtsu,
          bubbleDark: cavityDynamicsSession.bubbleDark,
          surfaceYPx: surfaceY,
          otsuRelaxEpsilon: cavityDynamicsSession.otsuRelaxEpsilon,
          morphCloseDiskRadiusPx: cavityDynamicsSession.morphCloseDiskRadiusPx,
          includePipelineDebug: true,
        })
      } catch {
        if (token !== cavitySelectTokenRef.current) return
        const errPick = { resultIndex: index, loading: false, pipeline: null as CavityPipelineDebug | null }
        cavityChartPickRef.current = errPick
        setCavityChartPick(errPick)
        queueMicrotask(() => drawFrameRef.current())
        return
      }

      if (token !== cavitySelectTokenRef.current) return

      const donePick = {
        resultIndex: index,
        loading: false,
        pipeline: partial.pipelineDebug ?? null,
      }
      cavityChartPickRef.current = donePick
      setCavityChartPick(donePick)
      queueMicrotask(() => drawFrameRef.current())
    },
    [cavityDynamicsSession, dispatch, surfaceY, exportedFps],
  )

  const clearCavityChartPick = useCallback(() => {
    cavitySelectTokenRef.current += 1
    const cleared = { resultIndex: null, loading: false, pipeline: null as CavityPipelineDebug | null }
    cavityChartPickRef.current = cleared
    setCavityChartPick(cleared)
    queueMicrotask(() => drawFrameRef.current())
  }, [])

  const selectJetChartSample = useCallback(
    async (frameIndex: number, dropId: number) => {
      const token = ++jetSelectTokenRef.current
      const vid = videoRef.current
      const roi = jetDynamicsSession.roi
      const track = jetDynamicsSession.dropTracks.find((t) => t.id === dropId)
      const sample = track?.samples.find((s) => s.frameIndex === frameIndex)
      if (!vid || !roi || !sample) return

      dispatch({ type: 'setPlaying', isPlaying: false })
      setOverlayDisplay((p) => ({ ...p, jetDynamicsContourOverlay: true }))
      const loadingPick = {
        frameIndex,
        dropId,
        loading: true,
        contourPx: null as CalibrationPoint[] | null,
        fittedEllipsePx: null as FittedEllipsePx | null,
      }
      jetChartPickRef.current = loadingPick
      setJetChartPick(loadingPick)

      const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
      const seekT = cavityDiscreteFrameSeekTimeSec(frameIndex, decodeFps, vid.duration || 0)
      await seekVideoToTime(vid, seekT)
      await waitNextVideoFrame(vid)
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      await new Promise<void>((r) => requestAnimationFrame(() => r()))

      let imageData = captureVideoFrameImageData(vid)
      if (!imageData) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        imageData = captureVideoFrameImageData(vid)
      }

      if (token !== jetSelectTokenRef.current) return

      if (!imageData) {
        const emptyPick = {
          frameIndex,
          dropId,
          loading: false,
          contourPx: null as CalibrationPoint[] | null,
          fittedEllipsePx: null as FittedEllipsePx | null,
        }
        jetChartPickRef.current = emptyPick
        setJetChartPick(emptyPick)
        queueMicrotask(() => drawFrameRef.current())
        return
      }

      const segOpts = {
        invertOtsu: jetDynamicsSession.invertOtsu,
        bubbleDark: jetDynamicsSession.bubbleDark,
        otsuRelaxEpsilon: jetDynamicsSession.otsuRelaxEpsilon,
        morphCloseDiskRadiusPx: jetDynamicsSession.morphCloseDiskRadiusPx,
      }

      let ax = sample.cxPx
      let ay = sample.cyPx
      if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
        const bf = extractJetBlobsOneFrame(imageData, roi, {
          minJetPixels: jetDynamicsSession.minJetPixels,
          ...segOpts,
          frameIndex,
        })
        let best: { cx: number; cy: number; a: number } | null = null
        for (const b of bf?.blobs ?? []) {
          if (!best || b.areaPx > best.a) best = { cx: b.cx, cy: b.cy, a: b.areaPx }
        }
        if (best) {
          ax = best.cx
          ay = best.cy
        }
      }

      if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
        const errPick = {
          frameIndex,
          dropId,
          loading: false,
          contourPx: null as CalibrationPoint[] | null,
          fittedEllipsePx: null as FittedEllipsePx | null,
        }
        jetChartPickRef.current = errPick
        setJetChartPick(errPick)
        queueMicrotask(() => drawFrameRef.current())
        return
      }

      let contour: CalibrationPoint[] | null = null
      try {
        contour = extractJetContourAtAnchor(imageData, roi, segOpts, ax as number, ay as number)
      } catch {
        contour = null
      }

      if (token !== jetSelectTokenRef.current) return

      const fittedEllipsePx = contour && contour.length >= 8 ? fitEllipseFromContourPx(contour) : null

      const donePick = {
        frameIndex,
        dropId,
        loading: false,
        contourPx: contour,
        fittedEllipsePx,
      }
      jetChartPickRef.current = donePick
      setJetChartPick(donePick)
      queueMicrotask(() => drawFrameRef.current())
    },
    [dispatch, exportedFps, jetDynamicsSession],
  )

  const clearJetChartPick = useCallback(() => {
    jetSelectTokenRef.current += 1
    const cleared = {
      frameIndex: null,
      dropId: null,
      loading: false,
      contourPx: null as CalibrationPoint[] | null,
      fittedEllipsePx: null as FittedEllipsePx | null,
    }
    jetChartPickRef.current = cleared
    setJetChartPick(cleared)
    queueMicrotask(() => drawFrameRef.current())
  }, [])

  const finalizeCavityManualPolygon = useCallback(() => {
    const verts = cavityManualVerticesRef.current
    const idx = cavityManualTargetResultIndexRef.current
    if (verts.length < 3 || idx == null) return
    const physicsHz = Math.max(1, Math.floor(samplingFps) || 1)
    setCavityDynamicsSession((prev) => {
      if (idx < 0 || idx >= prev.lastResults.length) return prev
      const m = computeCavityMetricsFromManualPolygon(verts, prev.mmPerPx, surfaceY)
      if (!m) return prev
      const row0 = prev.lastResults[idx]!
      const partialForMerge: ReturnType<typeof extractCavityMetricsOneFrame> = {
        areaMm2: m.areaMm2,
        reqMm: m.reqMm,
        xcPx: m.xcPx,
        ycPx: m.ycPx,
        zcMm: m.zcMm,
        aspectRatio: m.aspectRatio,
        kappaApexPerPx: m.kappaApexPerPx,
        kappaApexPerMm: m.kappaApexPerMm,
        pixelArea: m.pixelArea,
        touchesRoiBorder: false,
        failedReason: undefined,
      }
      const mergedBase = mergeFrameMeta(partialForMerge, row0.frameIndex, row0.timeSec)
      const rows = [...prev.lastResults]
      rows[idx] = {
        ...mergedBase,
        manualContourCanvas: verts.map((p) => ({ x: p.x, y: p.y })),
      }
      const processed = postprocessCavityDynamicsSeries(rows, physicsHz, prev.sigmaNm)
      const pickDbg = cavityPipelineDebugFromManualVertices(verts, m.pixelArea)
      queueMicrotask(() => {
        cavityChartPickRef.current = { resultIndex: idx, loading: false, pipeline: pickDbg }
        setCavityChartPick({ resultIndex: idx, loading: false, pipeline: pickDbg })
        setCavityManualTraceMode(false)
        setCavityManualVertices([])
        setCavityManualTargetResultIndex(null)
        setCavityManualHover(null)
        drawFrameRef.current()
      })
      return { ...prev, lastResults: processed }
    })
  }, [surfaceY, samplingFps])

  const cancelCavityManualTrace = useCallback(() => {
    if (cavityManualClickTimerRef.current != null) {
      window.clearTimeout(cavityManualClickTimerRef.current)
      cavityManualClickTimerRef.current = null
    }
    setCavityManualTraceMode(false)
    setCavityManualVertices([])
    setCavityManualTargetResultIndex(null)
    setCavityManualHover(null)
    queueMicrotask(() => drawFrameRef.current())
  }, [])

  const startCavityManualTrace = useCallback(() => {
    const rows = cavityDynamicsSession.lastResults
    if (rows.length === 0) {
      setCavityRoiUserMessage('请先运行空泡序列分析，或加载含结果的项目。')
      return
    }
    let idx = cavityChartPick.resultIndex
    if (idx == null || idx < 0 || idx >= rows.length) {
      const fps = Math.max(1, Math.floor(exportedFps) || 1)
      const t = videoAbsoluteTime || 0
      const d = videoDuration || 0
      let fi = Math.floor(t * fps + 1e-9)
      if (Number.isFinite(d) && d > 0) {
        const last = Math.max(0, Math.floor(d * fps + 1e-9))
        fi = Math.min(last, Math.max(0, fi))
      }
      idx = rows.findIndex((r) => r.frameIndex === fi)
      if (idx < 0) {
        let bestI = 0
        let bestD = Infinity
        for (let i = 0; i < rows.length; i++) {
          const d0 = Math.abs(rows[i]!.frameIndex - fi)
          if (d0 < bestD) {
            bestD = d0
            bestI = i
          }
        }
        idx = bestI
      }
    }
    const vid = videoRef.current
    if (!vid) return
    dispatch({ type: 'setPlaying', isPlaying: false })
    setCavityRoiSelectMode(false)
    setCavityRoiDrag(null)
    cavityRoiDragRef.current = null
    setJetRoiSelectMode(false)
    setJetRoiDrag(null)
    jetRoiDragRef.current = null
    const row = rows[idx]!
    const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
    const seekT = cavityDiscreteFrameSeekTimeSec(row.frameIndex, decodeFps, vid.duration || 0)
    void seekVideoToTime(vid, seekT).then(() => drawFrameRef.current())
    setCavityManualTargetResultIndex(idx)
    setCavityManualVertices([])
    setCavityManualTraceMode(true)
    setCavityManualHover(null)
    setCavityRoiUserMessage(null)
  }, [
    cavityChartPick.resultIndex,
    cavityDynamicsSession.lastResults,
    dispatch,
    exportedFps,
    videoAbsoluteTime,
    videoDuration,
  ])

  const onManualTraceCanvasClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!cavityManualTraceModeRef.current || !canvasRef.current) return
      const coords = getCanvasCoordinates(event, canvasRef.current, intrinsicWidth, intrinsicHeight)
      if (event.detail === 2) {
        if (cavityManualClickTimerRef.current != null) {
          window.clearTimeout(cavityManualClickTimerRef.current)
          cavityManualClickTimerRef.current = null
        }
        finalizeCavityManualPolygon()
        return
      }
      if (event.detail === 1) {
        if (cavityManualClickTimerRef.current != null) {
          window.clearTimeout(cavityManualClickTimerRef.current)
          cavityManualClickTimerRef.current = null
        }
        cavityManualClickTimerRef.current = window.setTimeout(() => {
          cavityManualClickTimerRef.current = null
          setCavityManualVertices((v) => [...v, coords])
          queueMicrotask(() => drawFrameRef.current())
        }, 280)
      }
    },
    [finalizeCavityManualPolygon, intrinsicHeight, intrinsicWidth],
  )

  useEffect(() => {
    if (!cavityManualTraceMode) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelCavityManualTrace()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cavityManualTraceMode, cancelCavityManualTrace])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoSrc) return
    const target = pendingVideoSeekSecRef.current
    const runSeek = () => {
      const d = v.duration
      const t =
        Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(target, d - 1e-4)) : Math.max(0, target)
      void seekVideoToTime(v, t).then(() => drawFrameRef.current())
    }
    if (v.readyState >= 2) {
      runSeek()
      return
    }
    const onLoadedData = () => runSeek()
    v.addEventListener('loadeddata', onLoadedData)
    return () => v.removeEventListener('loadeddata', onLoadedData)
  }, [videoSrc, activeProjectId])

  analysisRegionDragRef.current = analysisRegionDrag
  cavityRoiDragRef.current = cavityRoiDrag
  jetRoiDragRef.current = jetRoiDrag

  useEffect(() => {
    if (!analysisRegionSelectMode) return undefined
    const onWinUp = () => {
      const drag = analysisRegionDragRef.current
      if (!drag || intrinsicWidth <= 0 || intrinsicHeight <= 0) {
        setAnalysisRegionDrag(null)
        setAnalysisRegionSelectMode(false)
        return
      }
      const r = finalizeAnalysisRegionFromDrag(
        intrinsicWidth,
        intrinsicHeight,
        drag.a.x,
        drag.a.y,
        drag.b.x,
        drag.b.y,
        surfaceY,
      )
      if (r) setAnalysisRegion(r)
      setAnalysisRegionSelectMode(false)
      setAnalysisRegionDrag(null)
      queueMicrotask(() => drawFrameRef.current())
    }
    window.addEventListener('mouseup', onWinUp)
    return () => window.removeEventListener('mouseup', onWinUp)
  }, [analysisRegionSelectMode, intrinsicWidth, intrinsicHeight, surfaceY])

  useEffect(() => {
    if (!cavityRoiSelectMode) return undefined
    const onWinUp = () => {
      const drag = cavityRoiDragRef.current
      if (!drag || intrinsicWidth <= 0 || intrinsicHeight <= 0) {
        setCavityRoiDrag(null)
        setCavityRoiSelectMode(false)
        cavityRoiDragRef.current = null
        return
      }
      const r = finalizeCavityRoiFromDrag(
        intrinsicWidth,
        intrinsicHeight,
        drag.a.x,
        drag.a.y,
        drag.b.x,
        drag.b.y,
      )
      if (r) {
        setCavityDynamicsSession((prev) => ({ ...prev, roi: r }))
        setCavityRoiUserMessage(null)
      } else {
        setCavityRoiUserMessage(
          `框选无效：宽、高须各 ≥ ${CAVITY_ROI_MIN_SIDE_PX} px（请在画布上拖出足够大的矩形后再松开鼠标）。`,
        )
      }
      setCavityRoiSelectMode(false)
      setCavityRoiDrag(null)
      cavityRoiDragRef.current = null
      queueMicrotask(() => drawFrameRef.current())
    }
    window.addEventListener('mouseup', onWinUp)
    return () => window.removeEventListener('mouseup', onWinUp)
  }, [cavityRoiSelectMode, intrinsicWidth, intrinsicHeight])

  useEffect(() => {
    if (!jetRoiSelectMode) return undefined
    const onWinUp = () => {
      const drag = jetRoiDragRef.current
      if (!drag || intrinsicWidth <= 0 || intrinsicHeight <= 0) {
        setJetRoiDrag(null)
        setJetRoiSelectMode(false)
        jetRoiDragRef.current = null
        return
      }
      const r = finalizeCavityRoiFromDrag(
        intrinsicWidth,
        intrinsicHeight,
        drag.a.x,
        drag.a.y,
        drag.b.x,
        drag.b.y,
      )
      if (r) {
        setJetDynamicsSession((prev) => ({ ...prev, roi: r }))
      }
      setJetRoiSelectMode(false)
      setJetRoiDrag(null)
      jetRoiDragRef.current = null
      queueMicrotask(() => drawFrameRef.current())
    }
    window.addEventListener('mouseup', onWinUp)
    return () => window.removeEventListener('mouseup', onWinUp)
  }, [jetRoiSelectMode, intrinsicWidth, intrinsicHeight])

  useEffect(() => {
    const id = requestAnimationFrame(() => drawFrameRef.current())
    return () => cancelAnimationFrame(id)
  }, [contourSegMode, contourDiffThr, contourMorphClose, contourBgGray, threshold, dropletIsBright, surfaceY])

  /** 勿依赖 drawFrame（每帧依赖会变）；否则 BetaChart 里定时器会被 effect 立刻清掉，表现为「沿曲线播放」无反应 */
  const onCurvePlaybackStep = useCallback((index: number) => {
    const point = dataRef.current[index]
    const v = videoRef.current
    if (!point || !v) return
    dispatch({ type: 'setPlaying', isPlaying: false })
    dispatch({ type: 'setSelectedIdx', selectedIdx: index })
    v.currentTime = point.absTime
    window.setTimeout(() => requestAnimationFrame(drawFrameRef.current), 40)
  }, [])

  const handleContactLineChartPointClick = useCallback(
    (point: AnalysisPoint, meta?: ChartPointClickMeta) => {
      const currentData = dataRef.current
      const idx = currentData.findIndex((p) => p.time === point.time)
      if (idx < 0 || !videoRef.current) return

      if (
        meta?.source === 'thetaLeft' ||
        meta?.source === 'thetaRight' ||
        meta?.source === 'thetaAvg'
      ) {
        setOverlayDisplay((p) => ({ ...p, contactAngleConstruction: true }))
      }

      const clicked = currentData[idx]
      if (clicked?.isInvalid && (clicked.subL === undefined || clicked.subR === undefined)) {
        const prevValid = [...currentData]
          .slice(0, idx)
          .reverse()
          .find((p) => !p.isInvalid && p.subL !== undefined && p.subR !== undefined)
        if (prevValid) {
          const patched = [...currentData]
          patched[idx] = {
            ...clicked,
            subL: prevValid.subL,
            subR: prevValid.subR,
            ptsL: prevValid.ptsL,
            ptsR: prevValid.ptsR,
            outerContourPx: clicked.outerContourPx ?? prevValid.outerContourPx,
            manualSuppressCircles: clicked.manualSuppressCircles ?? prevValid.manualSuppressCircles,
            contourPerFrameThreshold: clicked.contourPerFrameThreshold ?? prevValid.contourPerFrameThreshold,
            contourPerFrameDiffThreshold:
              clicked.contourPerFrameDiffThreshold ?? prevValid.contourPerFrameDiffThreshold,
            mooreStrictOuterRaySeed: clicked.mooreStrictOuterRaySeed ?? prevValid.mooreStrictOuterRaySeed,
            beta: prevValid.beta,
            absDiameter: prevValid.absDiameter,
            isInvalid: true,
          }
          dispatch({ type: 'setAnalysisData', analysisData: patched })
        } else {
          const patched = [...currentData]
          patched[idx] = buildFallbackLine(clicked)
          dispatch({ type: 'setAnalysisData', analysisData: patched })
        }
      }

      dispatch({ type: 'setPlaying', isPlaying: false })
      dispatch({ type: 'setSelectedIdx', selectedIdx: idx })
      videoRef.current.currentTime = point.absTime
      window.setTimeout(drawFrame, 40)
    },
    [buildFallbackLine, dispatch, drawFrame],
  )

  const handleSurfaceEnergyChartClick = useCallback(
    (index: number) => {
      const currentData = dataRef.current
      if (index < 0 || index >= currentData.length || !videoRef.current) return
      const clicked = currentData[index]

      flushSync(() => {
        setOverlayDisplay((p) => ({ ...p, spreadFit: true, baseline: true }))
      })

      if (clicked?.isInvalid && (clicked.subL === undefined || clicked.subR === undefined)) {
        const prevValid = [...currentData]
          .slice(0, index)
          .reverse()
          .find((p) => !p.isInvalid && p.subL !== undefined && p.subR !== undefined)
        if (prevValid) {
          const patched = [...currentData]
          patched[index] = {
            ...clicked,
            subL: prevValid.subL,
            subR: prevValid.subR,
            ptsL: prevValid.ptsL,
            ptsR: prevValid.ptsR,
            outerContourPx: clicked.outerContourPx ?? prevValid.outerContourPx,
            manualSuppressCircles: clicked.manualSuppressCircles ?? prevValid.manualSuppressCircles,
            contourPerFrameThreshold: clicked.contourPerFrameThreshold ?? prevValid.contourPerFrameThreshold,
            contourPerFrameDiffThreshold:
              clicked.contourPerFrameDiffThreshold ?? prevValid.contourPerFrameDiffThreshold,
            mooreStrictOuterRaySeed: clicked.mooreStrictOuterRaySeed ?? prevValid.mooreStrictOuterRaySeed,
            beta: prevValid.beta,
            absDiameter: prevValid.absDiameter,
            isInvalid: true,
          }
          dispatch({ type: 'setAnalysisData', analysisData: patched })
        } else {
          const patched = [...currentData]
          patched[index] = buildFallbackLine(clicked)
          dispatch({ type: 'setAnalysisData', analysisData: patched })
        }
      }

      dispatch({ type: 'setPlaying', isPlaying: false })
      dispatch({ type: 'setSelectedIdx', selectedIdx: index })
      videoRef.current.currentTime = clicked.absTime
      window.setTimeout(drawFrame, 40)
    },
    [buildFallbackLine, dispatch, drawFrame],
  )

  /**
   * 「沿曲线播放」定时器回调：禁止 flushSync、禁止每步 patch 全序列。
   * 否则在 setInterval 内反复强制同步提交会与 Recharts/React 调度冲突，严重时整页崩溃（用户侧常描述为蓝屏式闪退）。
   */
  const handleSurfaceEnergyCurvePlaybackStep = useCallback((index: number) => {
    const currentData = dataRef.current
    if (index < 0 || index >= currentData.length || !videoRef.current) return
    const clicked = currentData[index]
    setOverlayDisplay((p) => ({ ...p, spreadFit: true, baseline: true }))
    dispatch({ type: 'setPlaying', isPlaying: false })
    dispatch({ type: 'setSelectedIdx', selectedIdx: index })
    videoRef.current.currentTime = clicked.absTime
    window.setTimeout(() => requestAnimationFrame(drawFrameRef.current), 40)
  }, [dispatch])

  /** 标注勾选后必须用最新闭包重绘画布；同步 RAF(drawFrame) 会在 state 提交前跑到旧 overlayDisplay，表现为「勾选反而不显示」 */
  useEffect(() => {
    const id = requestAnimationFrame(() => drawFrameRef.current())
    return () => cancelAnimationFrame(id)
  }, [overlayDisplay])

  const analyzeImpact = useCallback(async () => {
    const videoEl = videoRef.current
    const canvas = canvasRef.current
    if (!videoEl || !canvas || intrinsicWidth === 0 || intrinsicHeight === 0) return
    setIsImpactRunning(true)
    try {
      const restoreTime = videoEl.currentTime
      const temp = document.createElement('canvas')
      temp.width = intrinsicWidth
      temp.height = intrinsicHeight
      const tCtx = temp.getContext('2d', { alpha: false })
      if (!tCtx) return

      // Seek by actual video frame interval to ensure unique decoded frames.
      const frameStep = 1 / Math.max(1, exportedFps)
      const physTimeScale = exportedFps / Math.max(1, samplingFps)
      const n = Math.max(2, Math.floor(preImpactFrames))
      const frames: Array<{ time: number; imageData: ImageData }> = []
      for (let i = n; i >= 1; i--) {
        const t = Math.max(0, zeroTime - i * frameStep)
        if (Math.abs(videoEl.currentTime - t) > 1e-4) {
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              videoEl.removeEventListener('seeked', onSeeked)
              resolve()
            }
            videoEl.addEventListener('seeked', onSeeked)
            videoEl.currentTime = t
          })
        }
        tCtx.drawImage(videoEl, 0, 0, intrinsicWidth, intrinsicHeight)
        const imageData = tCtx.getImageData(0, 0, intrinsicWidth, intrinsicHeight)
        const physicalTime = (t - zeroTime) * physTimeScale
        frames.push({ time: physicalTime, imageData })
      }

      const result = calculateImpactResult({
        frames,
        threshold,
        dropletIsBright,
        surfaceY,
        pixelScale,
        actualD0,
        fluidDensity,
        surfaceTension,
      })
      flushSync(() => {
        setImpactResult(result)
      })

      if (Math.abs(videoEl.currentTime - restoreTime) > 1e-4) {
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            videoEl.removeEventListener('seeked', onSeeked)
            resolve()
          }
          videoEl.addEventListener('seeked', onSeeked)
          videoEl.currentTime = restoreTime
        })
      }
      queueMicrotask(() => {
        drawFrameRef.current()
      })
    } finally {
      setIsImpactRunning(false)
    }
  }, [
    actualD0,
    exportedFps,
    intrinsicHeight,
    intrinsicWidth,
    pixelScale,
    preImpactFrames,
    fluidDensity,
    surfaceTension,
    samplingFps,
    surfaceY,
    threshold,
    dropletIsBright,
    zeroTime,
  ])

  const refitJumpPoints = useCallback(async () => {
    if (state.isAnalyzing) return
    const videoEl = videoRef.current
    const canvas = canvasRef.current
    if (!videoEl || !canvas || surfaceY === null) return
    const source = dataRef.current
    if (source.length < 3) return

    const candidates: number[] = []
    for (let i = 1; i < source.length - 1; i++) {
      const prev = source[i - 1]
      const cur = source[i]
      const next = source[i + 1]
      if (cur.isInvalid) {
        candidates.push(i)
        continue
      }
      const targetBeta = (prev.beta + next.beta) / 2
      const jump = Math.abs(cur.beta - targetBeta)
      if (jump > Math.max(0.08, Math.abs(targetBeta) * 0.18)) candidates.push(i)
    }
    if (!candidates.length) return

    setIsRefitting(true)
    try {
      const restoreTime = videoEl.currentTime
      const temp = document.createElement('canvas')
      temp.width = canvas.width
      temp.height = canvas.height
      const tCtx = temp.getContext('2d', { alpha: false })
      if (!tCtx) return
      const patched = [...source]

      for (const idx of candidates) {
        const current = patched[idx]
        const prevValid = [...patched]
          .slice(0, idx)
          .reverse()
          .find((p) => p.subL !== undefined && p.subR !== undefined)
        const nextValid = patched
          .slice(idx + 1)
          .find((p) => p.subL !== undefined && p.subR !== undefined)
        if (!prevValid || !nextValid) continue

        const expectedLeft = ((prevValid.subL ?? 0) + (nextValid.subL ?? 0)) / 2
        const expectedRight = ((prevValid.subR ?? 0) + (nextValid.subR ?? 0)) / 2
        if (Math.abs(videoEl.currentTime - current.absTime) > 1e-4) {
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              videoEl.removeEventListener('seeked', onSeeked)
              resolve()
            }
            videoEl.addEventListener('seeked', onSeeked)
            videoEl.currentTime = current.absTime
          })
        }
        tCtx.drawImage(videoEl, 0, 0, temp.width, temp.height)
        const imageData = tCtx.getImageData(0, 0, temp.width, temp.height)
        const pipe = buildAnalysisPipelineFrame(imageData, surfaceY, analysisRegion, null)
        const guidedSearch =
          analysisRegion != null
            ? {
                expectedLeft: expectedLeft - pipe.ox,
                expectedRight: expectedRight - pipe.ox,
                windowPx: 24,
              }
            : { expectedLeft, expectedRight, windowPx: 24 }
        const { point: pCrop } = extractPhysicsAtSurface({
          imageData: pipe.imageData,
          surfaceY: pipe.surfaceY,
          threshold,
          dropletIsBright,
          absTime: current.absTime,
          zeroTime,
          timeScaleFactor,
          actualD0,
          pixelScale,
          isAnalyzing: false,
          lastWidth: lastWidthRef.current,
          algorithmMode,
          guidedSearch,
        })
        const point =
          analysisRegion != null ? offsetAnalysisPointToFullImage(pCrop, analysisRegion) : pCrop
        if (point.isInvalid || point.subL === undefined || point.subR === undefined) continue
        const targetBeta = (prevValid.beta + nextValid.beta) / 2
        const oldErr = Math.abs(current.beta - targetBeta)
        const newErr = Math.abs(point.beta - targetBeta)
        if (current.isInvalid || newErr <= oldErr * 0.9) {
          patched[idx] = {
            ...current,
            beta: point.beta,
            absDiameter: point.absDiameter,
            subL: point.subL,
            subR: point.subR,
            ptsL: point.ptsL,
            ptsR: point.ptsR,
            isInvalid: false,
            recoveredByNeck: point.recoveredByNeck,
          }
        }
      }

      dispatch({
        type: 'setAnalysisData',
        analysisData: patched.map((p) => enrichAnalysisPointContactAngles(p, surfaceY, contactAngleFitOpts)),
      })
      if (Math.abs(videoEl.currentTime - restoreTime) > 1e-4) {
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            videoEl.removeEventListener('seeked', onSeeked)
            resolve()
          }
          videoEl.addEventListener('seeked', onSeeked)
          videoEl.currentTime = restoreTime
        })
      }
      requestAnimationFrame(drawFrame)
    } finally {
      setIsRefitting(false)
    }
  }, [
    actualD0,
    algorithmMode,
    drawFrame,
    pixelScale,
    state.isAnalyzing,
    surfaceY,
    threshold,
    dropletIsBright,
    timeScaleFactor,
    zeroTime,
    contactAngleFitOpts,
    runContourExtract,
    analysisRegion,
  ])

  const refineContactAngles = useCallback(() => {
    if (state.isAnalyzing) return
    const source = dataRef.current
    if (source.length < 3) return
    const hasTheta = source.some(
      (p) => p.contactAngleLeftDeg != null || p.contactAngleRightDeg != null,
    )
    if (!hasTheta) return
    const refined = refineContactAnglesSeries(source)
    dispatch({ type: 'setAnalysisData', analysisData: refined })
    queueMicrotask(() => drawFrameRef.current())
  }, [state.isAnalyzing, dispatch])

  const stepAnalysis = useCallback(() => {
    const videoEl = videoRef.current
    const canvas = canvasRef.current
    if (!videoEl || !canvas || surfaceY === null || !state.isAnalyzing) return
    if (videoEl.currentTime >= videoEl.duration) {
      dispatch({ type: 'setAnalyzing', isAnalyzing: false })
      return
    }
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pipeGeom = buildAnalysisPipelineFrame(
      fullImageData,
      surfaceY,
      analysisRegion,
      mergeSuppressCircles(globalBackgroundSuppressCircles, null),
    )
    const { point: pointCrop, widthPx } = extractPhysicsAtSurface({
      imageData: pipeGeom.imageData,
      surfaceY: pipeGeom.surfaceY,
      threshold,
      dropletIsBright,
      absTime: videoEl.currentTime,
      zeroTime,
      timeScaleFactor,
      actualD0,
      pixelScale,
      isAnalyzing: state.isAnalyzing,
      lastWidth: lastWidthRef.current,
      algorithmMode,
    })
    const point =
      analysisRegion != null ? offsetAnalysisPointToFullImage(pointCrop, analysisRegion) : pointCrop

    const prevRow = dataRef.current[dataRef.current.length - 1]
    const perFrameSuppress =
      point.isInvalid && prevRow?.manualSuppressCircles?.length
        ? prevRow.manualSuppressCircles
        : undefined
    const pipeContour = buildAnalysisPipelineFrame(
      fullImageData,
      surfaceY,
      analysisRegion,
      mergeSuppressCircles(globalBackgroundSuppressCircles, perFrameSuppress),
    )

    const seedContourX = Math.round(
      ((pointCrop.subL ?? pipeContour.imageData.width / 2) +
        (pointCrop.subR ?? pipeContour.imageData.width / 2)) /
        2,
    )
    const contourRaw = runContourExtract(pipeContour.imageData, seedContourX, pipeContour.surfaceY - 3, {
      surfaceYPxForImage: pipeContour.surfaceY,
      suppressCircles: pipeContour.circlesForCrop,
      luminanceThresholdOverride: pointCrop.contourPerFrameThreshold ?? null,
      diffThresholdOverride: pointCrop.contourPerFrameDiffThreshold ?? null,
      mooreStartSearch: pointCrop.mooreStrictOuterRaySeed ? 'horizontalRayLeft' : 'raster',
    })
    const mooreContourExtractOk =
      contourRaw != null && contourRaw.length >= MOORE_OUTER_CONTOUR_MIN_POINTS
    const outerContourPx =
      contourRaw != null && analysisRegion != null
        ? offsetContourToFullImage(contourRaw, analysisRegion)
        : contourRaw ?? undefined

    let sampledPoint: AnalysisPoint = { ...point, outerContourPx, mooreContourExtractOk }
    if (point.isInvalid) {
      const prev = dataRef.current[dataRef.current.length - 1]
      if (prev && Number.isFinite(prev.beta) && Number.isFinite(prev.absDiameter)) {
        // Keep temporal continuity when edge extraction fails on a frame.
        sampledPoint = {
          ...sampledPoint,
          beta: prev.beta,
          absDiameter: prev.absDiameter,
          subL: prev.subL,
          subR: prev.subR,
          ptsL: prev.ptsL,
          ptsR: prev.ptsR,
          outerContourPx: prev.outerContourPx ?? sampledPoint.outerContourPx,
          manualSuppressCircles: prev.manualSuppressCircles ?? sampledPoint.manualSuppressCircles,
          contourPerFrameThreshold: prev.contourPerFrameThreshold ?? sampledPoint.contourPerFrameThreshold,
          contourPerFrameDiffThreshold:
            prev.contourPerFrameDiffThreshold ?? sampledPoint.contourPerFrameDiffThreshold,
          mooreStrictOuterRaySeed: prev.mooreStrictOuterRaySeed ?? sampledPoint.mooreStrictOuterRaySeed,
          isInvalid: true,
        }
      } else {
        sampledPoint = buildFallbackLine(point, canvas.width)
      }
    }

    const isZeroMoment = Math.abs(sampledPoint.absTime - zeroTime) <= 0.5 / Math.max(1, exportedFps)
    if (isZeroMoment) {
      const centerX = canvas.width / 2
      sampledPoint = {
        ...sampledPoint,
        beta: 0,
        absDiameter: 0,
        subL: centerX,
        subR: centerX,
      }
    }

    sampledPoint = enrichAnalysisPointContactAngles(sampledPoint, surfaceY, contactAngleFitOpts)

    dispatch({ type: 'appendAnalysisPoint', point: sampledPoint })
    if (widthPx > 0) lastWidthRef.current = widthPx
    videoEl.currentTime += 1 / Math.max(1, exportedFps)
  }, [
    actualD0,
    algorithmMode,
    analysisRegion,
    buildFallbackLine,
    exportedFps,
    pixelScale,
    state.isAnalyzing,
    surfaceY,
    threshold,
    dropletIsBright,
    timeScaleFactor,
    zeroTime,
    contactAngleFitOpts,
    runContourExtract,
    globalBackgroundSuppressCircles,
  ])

  useVideoFrame({
    videoRef,
    isAnalyzing: state.isAnalyzing,
    isPlaying: state.isPlaying,
    onAnalyzeStep: stepAnalysis,
    onFrameDraw: drawFrame,
  })

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    if (state.isPlaying) {
      void videoEl.play().catch(() => dispatch({ type: 'setPlaying', isPlaying: false }))
    } else {
      videoEl.pause()
    }
  }, [state.isPlaying])

  useEffect(() => {
    if (!state.isAnalyzing || !videoRef.current) return
    dispatch({ type: 'resetAnalysis' })
    lastWidthRef.current = 0
    if (Math.abs(videoRef.current.currentTime - zeroTime) > 0.01) {
      videoRef.current.currentTime = zeroTime
    } else {
      // If already at t0, no seeked event fires, so kick analysis manually.
      drawFrame()
      window.setTimeout(stepAnalysis, 0)
    }
  }, [state.isAnalyzing, zeroTime, drawFrame, stepAnalysis])

  const onAutoCalibrate = useCallback(() => {
    const videoEl = videoRef.current
    const canvas = canvasRef.current
    if (!videoEl || !canvas) {
      setAutoCalibError('无法访问视频或画布，请刷新页面重试。')
      return
    }
    if (videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) {
      setAutoCalibError('视频尚未就绪（无有效分辨率），请等待加载完成或拖动一次进度条。')
      return
    }
    if (videoEl.readyState < 2) {
      setAutoCalibError('当前帧尚未解码（READY 不足），请稍候或拖动进度条后再点自动标定。')
      return
    }
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      setAutoCalibError('无法创建画布上下文。')
      return
    }

    if (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight) {
      canvas.width = videoEl.videoWidth
      canvas.height = videoEl.videoHeight
      setIntrinsicWidth(videoEl.videoWidth)
      setIntrinsicHeight(videoEl.videoHeight)
      setVideoDuration(videoEl.duration || 0)
    }

    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const calibrated = runAutoCalibration({
      imageData,
      threshold,
      actualD0,
      dropletIsBright,
      analysisRegion,
    })
    if (!calibrated) {
      setAutoCalibError(
        analysisRegion != null
          ? '未能识别液滴轮廓（当前仅在 ROI 内搜索）。请放大 ROI、对准液滴与倒影间隙，或调整阈值 / 「液滴偏亮」后重试。'
          : '未能识别液滴轮廓。可先勾选「框选计算区域」只在含液滴的矩形内标定；其余可尝试：切换「液滴偏亮」、调整二值化阈值、换液滴清晰的一帧或提高对比度。',
      )
      return
    }

    setAutoCalibError(null)
    flushSync(() => {
      setImpactResult(null)
      setPixelScale(calibrated.pixelScale)
      setSurfaceY(calibrated.surfaceY)
      dispatch({ type: 'setAutoCalibResult', autoCalibResult: calibrated.result })
      dispatch({ type: 'setAnalysisData', analysisData: [] })
    })
    queueMicrotask(() => {
      drawFrameRef.current()
    })
  }, [actualD0, analysisRegion, dropletIsBright, threshold])

  const onCanvasDown = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (cavityManualTraceModeRef.current) return
      if (
        jetRoiSelectMode &&
        state.mode === 'idle' &&
        intrinsicWidth > 0 &&
        intrinsicHeight > 0 &&
        canvasRef.current
      ) {
        const coords = getCanvasCoordinates(event, canvasRef.current, intrinsicWidth, intrinsicHeight)
        const drag = { a: coords, b: coords }
        jetRoiDragRef.current = drag
        setJetRoiDrag(drag)
        return
      }
      if (
        cavityRoiSelectMode &&
        state.mode === 'idle' &&
        intrinsicWidth > 0 &&
        intrinsicHeight > 0 &&
        canvasRef.current
      ) {
        const coords = getCanvasCoordinates(event, canvasRef.current, intrinsicWidth, intrinsicHeight)
        const drag = { a: coords, b: coords }
        cavityRoiDragRef.current = drag
        setCavityRoiDrag(drag)
        return
      }
      if (
        analysisRegionSelectMode &&
        state.mode === 'idle' &&
        intrinsicWidth > 0 &&
        intrinsicHeight > 0 &&
        canvasRef.current
      ) {
        const coords = getCanvasCoordinates(event, canvasRef.current, intrinsicWidth, intrinsicHeight)
        const drag = { a: coords, b: coords }
        analysisRegionDragRef.current = drag
        setAnalysisRegionDrag(drag)
        return
      }
      if (state.selectedIdx === -1 || state.mode !== 'idle' || surfaceY === null || !canvasRef.current) return
      const point = dataRef.current[state.selectedIdx]
      if (!point || point.subL === undefined || point.subR === undefined) return
      const coords = getCanvasCoordinates(event, canvasRef.current, intrinsicWidth, intrinsicHeight)
      const radius = Math.max(30, intrinsicWidth / 40)
      if (Math.hypot(coords.x - point.subL, coords.y - surfaceY) < radius) {
        dispatch({ type: 'setDraggingHandle', draggingHandle: 'left' })
      } else if (Math.hypot(coords.x - point.subR, coords.y - surfaceY) < radius) {
        dispatch({ type: 'setDraggingHandle', draggingHandle: 'right' })
      }
    },
    [
      analysisRegionSelectMode,
      cavityRoiSelectMode,
      jetRoiSelectMode,
      intrinsicHeight,
      intrinsicWidth,
      state.mode,
      state.selectedIdx,
      surfaceY,
    ],
  )

  const onCanvasMove = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return
      const coords = getCanvasCoordinates(event, canvasRef.current, intrinsicWidth, intrinsicHeight)
      if (cavityManualTraceModeRef.current) {
        setCavityManualHover(coords)
        requestAnimationFrame(() => drawFrameRef.current())
        return
      }
      if (jetRoiSelectMode && jetRoiDrag) {
        setJetRoiDrag((d) => {
          const n = d ? { ...d, b: coords } : null
          jetRoiDragRef.current = n
          return n
        })
        requestAnimationFrame(() => drawFrameRef.current())
        return
      }
      if (cavityRoiSelectMode && cavityRoiDrag) {
        setCavityRoiDrag((d) => {
          const n = d ? { ...d, b: coords } : null
          cavityRoiDragRef.current = n
          return n
        })
        requestAnimationFrame(() => drawFrameRef.current())
        return
      }
      if (analysisRegionSelectMode && analysisRegionDrag) {
        setAnalysisRegionDrag((d) => {
          const n = d ? { ...d, b: coords } : null
          analysisRegionDragRef.current = n
          return n
        })
        requestAnimationFrame(drawFrameRef.current)
        return
      }
      if (state.mode === 'calibrating_scale') {
        dispatch({ type: 'setHoverPos', hoverPos: coords })
        requestAnimationFrame(drawFrame)
        return
      }
      if (!state.draggingHandle || state.selectedIdx === -1) return
      const next = [...dataRef.current]
      const point = { ...next[state.selectedIdx] }
      if (!point) return
      if (state.draggingHandle === 'left') point.subL = coords.x
      else point.subR = coords.x
      const currentScale = pixelScale && pixelScale > 0 ? pixelScale : 50
      const safeD0 = actualD0 > 0 ? actualD0 : 1.87
      const diameterMm = ((point.subR ?? 0) - (point.subL ?? 0)) / currentScale
      point.absDiameter = +diameterMm.toFixed(3)
      point.beta = +(diameterMm / safeD0).toFixed(4)
      next[state.selectedIdx] = point
      dispatch({ type: 'setAnalysisData', analysisData: next })
      requestAnimationFrame(drawFrame)
    },
    [
      actualD0,
      analysisRegionDrag,
      analysisRegionSelectMode,
      cavityRoiDrag,
      cavityRoiSelectMode,
      jetRoiDrag,
      jetRoiSelectMode,
      drawFrame,
      intrinsicHeight,
      intrinsicWidth,
      pixelScale,
      state.draggingHandle,
      state.mode,
      state.selectedIdx,
    ],
  )

  const onCanvasClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (state.mode !== 'calibrating_scale' || !canvasRef.current) return
      const coords = getCanvasCoordinates(event, canvasRef.current, intrinsicWidth, intrinsicHeight)
      const points = [...state.calibrationPoints, coords]
      dispatch({ type: 'setCalibrationPoints', calibrationPoints: points })
      if (points.length === 2) {
        const px = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
        setPixelScale(px / Math.max(0.1, actualD0))
        dispatch({ type: 'setMode', mode: 'idle' })
        dispatch({ type: 'setAutoCalibResult', autoCalibResult: null })
        window.setTimeout(() => dispatch({ type: 'setCalibrationPoints', calibrationPoints: [] }), 1000)
      }
      requestAnimationFrame(drawFrame)
    },
    [actualD0, drawFrame, intrinsicHeight, intrinsicWidth, state.calibrationPoints, state.mode],
  )

  return (
    <div className="app">
      <header className="header">
        <div className="header-main-row">
          <div className="brand">
            <div className="brand-logo">∿</div>
            <div className="brand-text-block">
              <h1>DropletDynamics Pro</h1>
              <p className="brand-subtitle">高精度物理分析系统 (Cubic-Spline 12.0)</p>
            </div>
            <button
              type="button"
              className="brand-help-btn"
              aria-expanded={algorithmHelpOpen}
              aria-controls="algorithm-help-drawer"
              title="方法论与算法流程说明"
              onClick={() => setAlgorithmHelpOpen((o) => !o)}
            >
              <CircleHelp size={18} strokeWidth={2.25} aria-hidden />
              <span>方法论</span>
            </button>
          </div>
          <div className="header-actions">
            <label className="header-sample-field">
              <span className="header-sample-label">样品命名（导出文件名）</span>
              <input
                type="text"
                value={sampleLabel}
                onChange={(e) => {
                  const v = e.target.value
                  setSampleLabel(v)
                  if (activeProjectId) {
                    setVideoProjects((prev) =>
                      prev.map((p) => (p.id === activeProjectId ? { ...p, label: v } : p)),
                    )
                  }
                }}
                placeholder="导入视频后自动填入文件名"
                maxLength={120}
                autoComplete="off"
              />
            </label>
            <label className="upload-btn" title="可多选视频，或多次导入；切换标签页保留各视频的分析数据">
              <Upload size={14} />
              导入视频
              <input
                type="file"
                hidden
                multiple
                accept="video/*"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  addVideoFiles(files)
                }}
              />
            </label>
            <button onClick={exportAnalysisXlsx} disabled={state.analysisData.length === 0}>
              <Download size={14} />
              导出Excel
            </button>
          </div>
        </div>
        {videoProjects.length > 0 ? (
          <div className="video-project-tabs" role="tablist" aria-label="实验视频">
            {videoProjects.map((p) => (
              <div
                key={p.id}
                className={`video-project-tab${p.id === activeProjectId ? ' video-project-tab-active' : ''}`}
              >
                <button
                  type="button"
                  className="video-project-tab-select"
                  role="tab"
                  aria-selected={p.id === activeProjectId}
                  onClick={() => switchToVideoProject(p.id)}
                >
                  {p.label || '未命名视频'}
                </button>
                <button
                  type="button"
                  className="video-project-tab-remove"
                  aria-label={`移除 ${p.label || '视频'}`}
                  onClick={(ev) => removeVideoProject(p.id, ev)}
                >
                  <X size={14} strokeWidth={2.25} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </header>
      <main className="main-layout">
        <aside className="sidebar">
          <CollapsibleSidebarSection title="时间标定">
            <TimeCalibrationPanel
              zeroTime={zeroTime}
              samplingFps={samplingFps}
              exportedFps={exportedFps}
              onSetZero={() => {
                const videoEl = videoRef.current
                if (!videoEl) return
                setZeroTime(videoEl.currentTime)
                dispatch({ type: 'setAnalysisData', analysisData: [] })
                requestAnimationFrame(drawFrame)
              }}
              onSamplingFpsChange={(v) => setSamplingFps(Math.max(1, Math.floor(v || 1)))}
              onExportedFpsChange={(v) => setExportedFps(Math.max(1, Math.floor(v || 1)))}
            />
          </CollapsibleSidebarSection>
          <CollapsibleSidebarSection title="空间与比例尺">
            <SpatialPanel
              actualD0={actualD0}
              pixelScale={pixelScale}
              surfaceY={surfaceY}
              intrinsicHeight={intrinsicHeight}
              hasVideo={Boolean(videoSrc)}
              autoCalibError={autoCalibError}
              analysisRegion={analysisRegion}
              analysisRegionSelectMode={analysisRegionSelectMode}
              onAnalysisRegionSelectModeChange={(enabled) => {
                setAnalysisRegionSelectMode(enabled)
                if (enabled) {
                  setCavityRoiSelectMode(false)
                  setCavityRoiDrag(null)
                  cavityRoiDragRef.current = null
                }
                if (!enabled) {
                  setAnalysisRegionDrag(null)
                  analysisRegionDragRef.current = null
                }
                requestAnimationFrame(() => drawFrameRef.current())
              }}
              onClearAnalysisRegion={() => {
                setAnalysisRegion(null)
                setAnalysisRegionSelectMode(false)
                setAnalysisRegionDrag(null)
                analysisRegionDragRef.current = null
                requestAnimationFrame(() => drawFrameRef.current())
              }}
              onActualD0Change={(v) => setActualD0(v > 0 ? v : 1.87)}
              onAutoCalibrate={onAutoCalibrate}
              onManualCalibrate={() => {
                dispatch({ type: 'setMode', mode: 'calibrating_scale' })
                dispatch({ type: 'setCalibrationPoints', calibrationPoints: [] })
              }}
              onSurfaceYChange={(v) => {
                setSurfaceY(v)
                requestAnimationFrame(drawFrame)
              }}
            />
          </CollapsibleSidebarSection>
          <CollapsibleSidebarSection title="撞击速度分析">
            <ImpactPanel
              preImpactFrames={preImpactFrames}
              fluidDensity={fluidDensity}
              surfaceTension={surfaceTension}
              isRunning={isImpactRunning}
              result={impactResult}
              onFramesChange={(v) => setPreImpactFrames(Math.max(2, Math.min(100, Math.floor(v || 2))))}
              onFluidDensityChange={(v) => setFluidDensity(Math.max(1, Number.isFinite(v) ? v : 997))}
              onSurfaceTensionChange={(v) =>
                setSurfaceTension(Math.max(0.000001, Number.isFinite(v) ? v : 0.0728))
              }
              onAnalyze={() => void analyzeImpact()}
            />
          </CollapsibleSidebarSection>
          <CollapsibleSidebarSection title="图像设置">
            <ImageSettingsPanel
              threshold={threshold}
              dropletIsBright={dropletIsBright}
              algorithmMode={algorithmMode}
              contactAngleMethod={contactAngleMethod}
              fitPrecision={fitPrecision}
              onThresholdChange={(v) => {
                setAutoCalibError(null)
                setThreshold(Math.max(0, Math.min(255, Math.floor(v))))
                requestAnimationFrame(drawFrame)
              }}
              onDropletIsBrightChange={(v) => {
                setAutoCalibError(null)
                setDropletIsBright(v)
                requestAnimationFrame(drawFrame)
              }}
              onAlgorithmModeChange={setAlgorithmMode}
              onContactAngleMethodChange={(m) => {
                setContactAngleMethod(m)
                requestAnimationFrame(drawFrame)
              }}
              onFitPrecisionChange={(v) => {
                setFitPrecision(Math.max(0, Math.min(100, Math.floor(v))))
                requestAnimationFrame(drawFrame)
              }}
            />
          </CollapsibleSidebarSection>
          <CollapsibleSidebarSection title="轮廓分割（背景差分 / 形态学）">
            <ContourSegmentationPanel
              mode={contourSegMode}
              onModeChange={setContourSegMode}
              hasBackground={contourBgMatchesVideo}
              backgroundResolutionMismatch={Boolean(
                contourBgGray != null &&
                  intrinsicWidth > 0 &&
                  intrinsicHeight > 0 &&
                  contourBgGray.length !== intrinsicWidth * intrinsicHeight,
              )}
              hasVideo={Boolean(videoSrc)}
              surfaceYSet={surfaceY !== null}
              diffThreshold={contourDiffThr}
              onDiffThresholdChange={(v) => setContourDiffThr(v)}
              morphCloseIterations={contourMorphClose}
              onMorphCloseChange={(v) => setContourMorphClose(Math.max(0, Math.min(8, Math.round(v))))}
              onCaptureBackgroundFromCanvas={captureContourBackgroundFromCanvas}
              onSyntheticBackgroundFromCanvas={syntheticContourBackgroundFromCanvas}
              onClearBackground={() => setContourBgGray(null)}
              globalSuppressStrokeCount={globalBackgroundSuppressCircles.length}
              canUseGlobalSuppress={Boolean(videoSrc && surfaceY !== null)}
              onOpenGlobalSuppress={() => void openGlobalBackgroundSuppressPaint()}
              onClearGlobalSuppress={() => setGlobalBackgroundSuppressCircles([])}
            />
          </CollapsibleSidebarSection>
          <CollapsibleSidebarSection title="标注显示" className="overlay-display-panel">
            <OverlayDisplayPanel
              value={overlayDisplay}
              onChange={(patch) => setOverlayDisplay((p) => ({ ...p, ...patch }))}
            />
          </CollapsibleSidebarSection>
          <CollapsibleSidebarSection title="表面能与动能">
            <SurfaceEnergyPanel
              gammaBw={gammaBw}
              gammaBa={gammaBa}
              onGammaBwChange={(v) => setGammaBw(Math.max(0, Number.isFinite(v) ? v : 0.041))}
              onGammaBaChange={(v) => setGammaBa(Math.max(0, Number.isFinite(v) ? v : 0.0205))}
              dissipationSmoothMode={dissipationSmoothMode}
              onDissipationSmoothModeChange={setDissipationSmoothMode}
            />
          </CollapsibleSidebarSection>
          <CollapsibleSidebarSection title="空泡动力学">
            <BubbleDynamicsPanel
              session={cavityDynamicsSession}
              onSessionChange={setCavityDynamicsSession}
              exportedFps={exportedFps}
              samplingFps={samplingFps}
              spatialCalibrationOk={Boolean(pixelScale != null && pixelScale > 0)}
              surfaceY={surfaceY}
              hasVideo={Boolean(videoSrc)}
              intrinsicWidth={intrinsicWidth}
              isSelectingRoi={cavityRoiSelectMode}
              onToggleSelectRoi={() => toggleCavityRoiSelectMode()}
              onSeekToFrameStart={() => seekToCavityFrameStart()}
              isRunning={isCavityRunning}
              onRunAnalysis={() => void runCavityDynamicsAnalysis()}
              onExportCsv={exportCavityDynamicsCsv}
              roiFeedback={cavityRoiUserMessage}
              manualTraceMode={cavityManualTraceMode}
              onStartManualTrace={startCavityManualTrace}
              onCancelManualTrace={cancelCavityManualTrace}
            />
          </CollapsibleSidebarSection>
          <CollapsibleSidebarSection title="射流动力学（Singular Jet）">
            <JetDynamicsPanel
              session={jetDynamicsSession}
              onSessionChange={setJetDynamicsSession}
              exportedFps={exportedFps}
              samplingFps={samplingFps}
              spatialCalibrationOk={Boolean(pixelScale != null && pixelScale > 0)}
              hasVideo={Boolean(videoSrc)}
              intrinsicWidth={intrinsicWidth}
              isSelectingRoi={jetRoiSelectMode}
              onToggleSelectRoi={() => toggleJetRoiSelectMode()}
              defaultStartFrameFromCavity={cavityDynamicsSession.lastCollapseFrameIndex}
              onApplyCollapseAsStart={applyJetCollapseFrameAsStart}
              isRunning={isJetRunning}
              onRunAnalysis={() => void runJetDynamicsAnalysis()}
              onExportCsv={exportJetDynamicsCsvCallback}
            />
          </CollapsibleSidebarSection>
        </aside>
        <section className="content">
          <VideoCanvas
            canvasRef={canvasRef}
            processedCanvasRef={processedCanvasRef}
            previewHandleTitle={binaryPreviewHandleLabel}
            analysisRegionSelectMode={analysisRegionSelectMode}
            cavityRoiSelectMode={cavityRoiSelectMode && !cavityManualTraceMode && !jetRoiSelectMode}
            jetRoiSelectMode={jetRoiSelectMode && !cavityManualTraceMode}
            manualTraceMode={cavityManualTraceMode}
            onManualTraceClick={onManualTraceCanvasClick}
            mode={state.mode}
            surfaceY={surfaceY}
            pixelScale={pixelScale}
            calibrationPoints={state.calibrationPoints}
            hoverPos={state.hoverPos}
            autoCalibResult={state.autoCalibResult}
            selectedPoint={state.selectedIdx >= 0 ? state.analysisData[state.selectedIdx] : null}
            currentRealTime={currentRealTime}
            onMouseDown={onCanvasDown}
            onMouseMove={onCanvasMove}
            onMouseUp={() => dispatch({ type: 'setDraggingHandle', draggingHandle: null })}
            onClick={onCanvasClick}
          />
          <div className="panel video-analysis-bar">
            <button
              type="button"
              className="start-btn"
              onClick={() => dispatch({ type: 'setAnalyzing', isAnalyzing: !state.isAnalyzing })}
              disabled={!videoSrc || surfaceY === null}
            >
              {state.isAnalyzing ? <Pause size={14} /> : <Play size={14} />}
              {state.isAnalyzing ? '停止自动分析' : '开始自动分析'}
            </button>
            <span className="video-analysis-bar-hint">
              需已导入视频并设定基准线；与下方播放条独立，分析时仍会按采样率抓取帧。
            </span>
          </div>
          <div className="video-controls panel">
            <div
              className="timeline-text"
              title={`帧号按侧栏「导出帧率」${exportedFps} fps 计算，与 ±1 帧步进一致；空泡动力学 t=frame/fe 已与此 fe 自动同步`}
            >
              {(videoAbsoluteTime || 0).toFixed(3)} / {(videoDuration || 0).toFixed(2)} s（帧{' '}
              {playbackFrameLabel.current}
              {playbackFrameLabel.last != null ? ` / ${playbackFrameLabel.last}` : ''}）
            </div>
            <div className="control-buttons">
              <button
                type="button"
                title="回到首帧"
                className="icon-frame-btn"
                disabled={!videoSrc}
                onClick={() => {
                  if (!videoRef.current) return
                  videoRef.current.currentTime = 0
                  dispatch({ type: 'setPlaying', isPlaying: false })
                  dispatch({ type: 'setSelectedIdx', selectedIdx: -1 })
                  requestAnimationFrame(drawFrame)
                }}
              >
                <ChevronsLeft size={20} />
              </button>
              <button
                onClick={() => {
                  if (!videoRef.current) return
                  videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1 / exportedFps)
                  dispatch({ type: 'setPlaying', isPlaying: false })
                  dispatch({ type: 'setSelectedIdx', selectedIdx: -1 })
                  requestAnimationFrame(drawFrame)
                }}
              >
                -1帧
              </button>
              <button onClick={() => dispatch({ type: 'setPlaying', isPlaying: !state.isPlaying })}>
                {state.isPlaying ? '暂停' : '播放'}
              </button>
              <button
                type="button"
                title="跳到标定的 t=0（撞击零时刻）"
                disabled={!videoSrc}
                onClick={() => {
                  const v = videoRef.current
                  if (!v) return
                  const d = v.duration || 0
                  const t = Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(zeroTime, d)) : Math.max(0, zeroTime)
                  v.currentTime = t
                  dispatch({ type: 'setPlaying', isPlaying: false })
                  dispatch({ type: 'setSelectedIdx', selectedIdx: -1 })
                  requestAnimationFrame(drawFrame)
                }}
              >
                t=0
              </button>
              <button
                onClick={() => {
                  if (!videoRef.current) return
                  videoRef.current.currentTime = Math.min(
                    videoRef.current.duration || 0,
                    videoRef.current.currentTime + 1 / exportedFps,
                  )
                  dispatch({ type: 'setPlaying', isPlaying: false })
                  dispatch({ type: 'setSelectedIdx', selectedIdx: -1 })
                  requestAnimationFrame(drawFrame)
                }}
              >
                +1帧
              </button>
              <button
                type="button"
                title="跳到尾帧"
                className="icon-frame-btn"
                disabled={!videoSrc}
                onClick={() => {
                  if (!videoRef.current) return
                  const d = videoRef.current.duration
                  if (!Number.isFinite(d) || d <= 0) return
                  videoRef.current.currentTime = d
                  dispatch({ type: 'setPlaying', isPlaying: false })
                  dispatch({ type: 'setSelectedIdx', selectedIdx: -1 })
                  requestAnimationFrame(drawFrame)
                }}
              >
                <ChevronsRight size={20} />
              </button>
            </div>
          </div>
          <BetaChart
            data={state.analysisData}
            contactTimeMs={contactTimeMs}
            onRefitJumps={() => void refitJumpPoints()}
            isRefitting={isRefitting}
            onRefineContactAngles={refineContactAngles}
            onCurvePlaybackStep={onCurvePlaybackStep}
            onPointClick={handleContactLineChartPointClick}
          />
          <ApexHeightChart
            data={state.analysisData}
            surfaceY={surfaceY}
            pixelScale={pixelScale}
            onPointClick={(p) => handleContactLineChartPointClick(p)}
          />
          <ContactAngleManualPanel
            selectedIdx={state.selectedIdx}
            point={state.selectedIdx >= 0 ? (state.analysisData[state.selectedIdx] ?? null) : null}
            surfaceY={surfaceY}
            globalFitPrecision={fitPrecision}
            contactAngleFitOpts={contactAngleFitOpts}
            analysisData={state.analysisData}
            onReplaceAnalysisData={(next) => dispatch({ type: 'setAnalysisData', analysisData: next })}
            onRedraw={() => requestAnimationFrame(drawFrame)}
          />
          <ContourSequencePanel
            pixelScalePxPerMm={pixelScale}
            previewFrameWidthPx={intrinsicWidth}
            previewFrameHeightPx={intrinsicHeight}
            surfaceYPx={surfaceY}
            point={
              state.selectedIdx >= 0 && state.selectedIdx < state.analysisData.length
                ? state.analysisData[state.selectedIdx]!
                : null
            }
            canOpenRepair={Boolean(videoSrc && surfaceY !== null && state.selectedIdx >= 0)}
            canRetryAltThreshold={Boolean(
              videoSrc && surfaceY !== null && state.selectedIdx >= 0 && contourSegMode === 'luminance',
            )}
            canRetryStrictOuterRay={Boolean(videoSrc && surfaceY !== null && state.selectedIdx >= 0)}
            onOpenMaskRepair={() => void openContourMaskRepair()}
            onRetryAltThreshold={() => void retryContourAltThresholdForSelectedFrame()}
            onRetryStrictOuterRay={() => void retryContourStrictOuterRayForSelectedFrame()}
            canResetContourDefaults={Boolean(videoSrc && surfaceY !== null && state.selectedIdx >= 0)}
            onResetContourDefaults={() => void resetContourDefaultsForSelectedFrame()}
            canRecalculateAllOuterContours={Boolean(
              videoSrc &&
                surfaceY !== null &&
                state.analysisData.length > 0 &&
                !state.isAnalyzing &&
                !state.isPlaying &&
                !isRefitting &&
                !isImpactRunning &&
                !isBatchRecalcContours,
            )}
            isRecalculatingAllOuterContours={isBatchRecalcContours}
            onRecalculateAllOuterContours={() => void recalculateAllOuterContours()}
            contourSmoothPct={contourDisplaySmoothPct}
            onContourSmoothPctChange={setContourDisplaySmoothPct}
            contourPreserveBaselineBand={contourDisplayPreserveBaseline}
            onContourPreserveBaselineBandChange={setContourDisplayPreserveBaseline}
          />
          <SurfaceEnergyChart
            data={surfaceEnergySeries}
            onAnalysisIndexClick={handleSurfaceEnergyChartClick}
            onCurvePlaybackStep={handleSurfaceEnergyCurvePlaybackStep}
          />
          <VolumeConservationChart
            data={surfaceEnergySeries}
            d0Mm={actualD0}
            onAnalysisIndexClick={handleSurfaceEnergyChartClick}
          />
          <BubbleDynamicsResultChart
            session={cavityDynamicsSession}
            selectedResultIndex={cavityChartPick.resultIndex}
            selectionLoading={cavityChartPick.loading}
            selectionPipeline={cavityChartPick.pipeline}
            onSelectResultIndex={(i) => void selectCavityChartRow(i)}
            onClearChartSelection={clearCavityChartPick}
          />
          <JetDynamicsResultChart
            session={jetDynamicsSession}
            zeroTimeSec={zeroTime}
            exportedFps={exportedFps}
            samplingFps={samplingFps}
            videoDurationSec={videoDuration || 0}
            fluidDensityKgM3={fluidDensity}
            selectedFrameIndex={jetChartPick.frameIndex}
            selectedDropId={jetChartPick.dropId}
            selectionLoading={jetChartPick.loading}
            onSelectSample={(fi, id) => void selectJetChartSample(fi, id)}
            onClearSelection={clearJetChartPick}
          />
        </section>
      </main>
      <ContourMaskRepairModal
        open={contourRepairOpen}
        imageData={contourRepairFrame}
        segmentationMode={contourSegMode}
        globalLuminanceThreshold={threshold}
        dropletIsBright={dropletIsBright}
        surfaceYPx={surfaceY}
        morphCloseIterations={contourMorphClose}
        diffThreshold={contourDiffThr}
        backgroundGray={contourBgGray}
        initialContourPerFrameThreshold={
          state.selectedIdx >= 0 ? state.analysisData[state.selectedIdx]?.contourPerFrameThreshold : undefined
        }
        initialContourPerFrameDiffThreshold={
          state.selectedIdx >= 0 ? state.analysisData[state.selectedIdx]?.contourPerFrameDiffThreshold : undefined
        }
        initialMooreStrictOuterRaySeed={
          state.selectedIdx >= 0 ? state.analysisData[state.selectedIdx]?.mooreStrictOuterRaySeed : undefined
        }
        initialCircles={
          state.selectedIdx >= 0 ? (state.analysisData[state.selectedIdx]?.manualSuppressCircles ?? []) : []
        }
        globalSuppressCircles={globalBackgroundSuppressCircles}
        defaultRadiusPx={18}
        onClose={() => {
          setContourRepairOpen(false)
          setContourRepairFrame(null)
        }}
        onSave={saveContourMaskRepair}
      />
      <GlobalBackgroundSuppressModal
        open={globalSuppressModalOpen}
        imageData={globalSuppressFrame}
        segmentationMode={contourSegMode}
        globalLuminanceThreshold={threshold}
        dropletIsBright={dropletIsBright}
        surfaceYPx={surfaceY}
        morphCloseIterations={contourMorphClose}
        diffThreshold={contourDiffThr}
        backgroundGray={contourBgGray}
        initialCircles={globalBackgroundSuppressCircles}
        defaultRadiusPx={18}
        onClose={() => {
          setGlobalSuppressModalOpen(false)
          setGlobalSuppressFrame(null)
        }}
        onSave={saveGlobalBackgroundSuppress}
      />
      <AlgorithmHelpDrawer open={algorithmHelpOpen} onClose={() => setAlgorithmHelpOpen(false)} />
      <video
        ref={videoRef}
        src={videoSrc ?? undefined}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
        muted
        playsInline
        preload="auto"
      />
    </div>
  )
}
