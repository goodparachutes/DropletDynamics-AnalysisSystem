import type { AnalysisPoint, AutoCalibrationResult, CalibrationPoint, InteractionMode } from '../../types/analysis'
import type { MouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface VideoCanvasProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  processedCanvasRef: RefObject<HTMLCanvasElement | null>
  /** 右上角二值小窗标题栏文案（亮度 / 差分状态） */
  previewHandleTitle?: string
  /** 框选 ROI 时在 idle 下显示十字光标 */
  analysisRegionSelectMode?: boolean
  /** 空泡 ROI 框选 */
  cavityRoiSelectMode?: boolean
  /** 射流 ROI 框选 */
  jetRoiSelectMode?: boolean
  /** 空泡手绘轮廓：十字光标 + 点击/双击由宿主处理 */
  manualTraceMode?: boolean
  onManualTraceClick?: (e: MouseEvent<HTMLCanvasElement>) => void
  mode: InteractionMode
  surfaceY: number | null
  pixelScale: number | null
  calibrationPoints: CalibrationPoint[]
  hoverPos: CalibrationPoint | null
  autoCalibResult: AutoCalibrationResult | null
  selectedPoint: AnalysisPoint | null
  currentRealTime: number
  onMouseDown: (e: MouseEvent<HTMLCanvasElement>) => void
  onMouseMove: (e: MouseEvent<HTMLCanvasElement>) => void
  onMouseUp: () => void
  onClick: (e: MouseEvent<HTMLCanvasElement>) => void
}

/** 基准尺寸（scale=1）；缩放会同比改变整条卡片占位，便于边界夹取 */
const PREVIEW_CARD_W = 220
const PREVIEW_HANDLE_H = 22
const PREVIEW_VIEWPORT_H = 140
const PREVIEW_CARD_H = PREVIEW_HANDLE_H + PREVIEW_VIEWPORT_H

const FRAME_SCALE_MIN = 0.35
const FRAME_SCALE_MAX = 5

export function VideoCanvas({
  canvasRef,
  processedCanvasRef,
  previewHandleTitle = '二值化 — 拖此移动 · 滚轮缩放窗口',
  analysisRegionSelectMode = false,
  cavityRoiSelectMode = false,
  jetRoiSelectMode = false,
  manualTraceMode = false,
  onManualTraceClick,
  mode,
  surfaceY,
  pixelScale,
  calibrationPoints,
  hoverPos,
  autoCalibResult,
  selectedPoint,
  currentRealTime,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onClick,
}: VideoCanvasProps) {
  const videoPanelRef = useRef<HTMLDivElement>(null)
  const floatRef = useRef<HTMLDivElement>(null)
  const frameScaleRef = useRef(1)
  const frameDragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)
  const [frameOffset, setFrameOffset] = useState({ x: 0, y: 0 })
  const [frameScale, setFrameScale] = useState(1)
  frameScaleRef.current = frameScale

  const clampFrameOffset = useCallback((nx: number, ny: number) => {
    const panel = videoPanelRef.current
    if (!panel) return { x: nx, y: ny }
    const scale = frameScaleRef.current
    const pw = panel.clientWidth
    const ph = panel.clientHeight
    const margin = 8
    const W = PREVIEW_CARD_W * scale
    const H = PREVIEW_CARD_H * scale
    const L0 = pw - 14 - W
    const T0 = 14
    const minFx = margin - L0
    const maxFx = pw - W - margin - L0
    const minFy = margin - T0
    const maxFy = ph - H - margin - T0
    return {
      x: Math.max(minFx, Math.min(maxFx, nx)),
      y: Math.max(minFy, Math.min(maxFy, ny)),
    }
  }, [])

  useEffect(() => {
    setFrameOffset((o) => clampFrameOffset(o.x, o.y))
  }, [frameScale, clampFrameOffset])

  useEffect(() => {
    const el = floatRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.92 : 1.08
      setFrameScale((prev) =>
        Math.min(FRAME_SCALE_MAX, Math.max(FRAME_SCALE_MIN, prev * factor)),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleFramePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    frameDragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
  }, [])

  const handleFramePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = frameDragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const dx = e.clientX - d.lastX
      const dy = e.clientY - d.lastY
      d.lastX = e.clientX
      d.lastY = e.clientY
      setFrameOffset(({ x, y }) => clampFrameOffset(x + dx, y + dy))
    },
    [clampFrameOffset],
  )

  const handleFramePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (frameDragRef.current?.pointerId === e.pointerId) {
      frameDragRef.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
  }, [])

  const resetFrameLayout = useCallback(() => {
    setFrameOffset({ x: 0, y: 0 })
    setFrameScale(1)
  }, [])

  const s = frameScale
  const cardW = PREVIEW_CARD_W * s
  const handleH = PREVIEW_HANDLE_H * s
  const viewH = PREVIEW_VIEWPORT_H * s
  const labelSize = Math.min(12, Math.max(8, Math.round(10 * s)))

  return (
    <div ref={videoPanelRef} className="panel video-panel">
      <div className="overlay-time-card">
        <div className="overlay-time-label">物理时间</div>
        <div className="overlay-time-value">
          {currentRealTime >= 0 ? '+' : ''}
          {currentRealTime.toFixed(3)} ms
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className={
          mode === 'calibrating_scale' ||
          ((analysisRegionSelectMode || cavityRoiSelectMode || jetRoiSelectMode || manualTraceMode) &&
            mode === 'idle')
            ? 'crosshair'
            : ''
        }
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onClick={(e) => {
          if (manualTraceMode && onManualTraceClick && mode === 'idle') {
            onManualTraceClick(e)
            return
          }
          onClick(e)
        }}
      />
      <div
        ref={floatRef}
        className="processed-preview-float"
        style={{
          width: cardW,
          transform: `translate(${frameOffset.x}px, ${frameOffset.y}px)`,
        }}
        title="在卡片上滚轮缩放窗口 · 拖标题栏移动"
      >
        <div
          className="processed-preview-handle"
          style={{ height: handleH, fontSize: labelSize }}
          onPointerDown={handleFramePointerDown}
          onPointerMove={handleFramePointerMove}
          onPointerUp={handleFramePointerUp}
          onPointerCancel={handleFramePointerUp}
          onDoubleClick={(e) => {
            e.stopPropagation()
            resetFrameLayout()
          }}
        >
          {previewHandleTitle}
        </div>
        <div className="processed-preview" style={{ height: viewH }}>
          <canvas ref={processedCanvasRef} className="processed-preview-canvas" />
        </div>
      </div>
      <div className="overlay-meta overlay-meta-fixed">
        Surface: {surfaceY ?? '--'} px | Scale: {pixelScale?.toFixed(2) ?? '--'} px/mm
      </div>
      <div className="overlay-meta overlay-meta-fixed-2">
        标定点: {calibrationPoints.length}
        {hoverPos && ` | hover (${hoverPos.x.toFixed(1)}, ${hoverPos.y.toFixed(1)})`}
      </div>
      {autoCalibResult && <div className="overlay-meta overlay-meta-fixed-3">Auto D0 px: {autoCalibResult.dPx.toFixed(1)}</div>}
      {selectedPoint && <div className="overlay-meta overlay-meta-fixed-4">选中 β: {selectedPoint.beta.toFixed(4)}</div>}
    </div>
  )
}
