import { ChevronDown, ChevronUp } from 'lucide-react'
import type { AnalysisRegionRect } from '../../features/analysis/analysisRegion'

interface SpatialPanelProps {
  actualD0: number
  pixelScale: number | null
  surfaceY: number | null
  intrinsicHeight: number
  hasVideo: boolean
  autoCalibError: string | null
  analysisRegion: AnalysisRegionRect | null
  analysisRegionSelectMode: boolean
  onAnalysisRegionSelectModeChange: (enabled: boolean) => void
  onClearAnalysisRegion: () => void
  onActualD0Change: (value: number) => void
  onAutoCalibrate: () => void
  onManualCalibrate: () => void
  onSurfaceYChange: (value: number) => void
}

export function SpatialPanel({
  actualD0,
  pixelScale,
  surfaceY,
  intrinsicHeight,
  hasVideo,
  autoCalibError,
  analysisRegion,
  analysisRegionSelectMode,
  onAnalysisRegionSelectModeChange,
  onClearAnalysisRegion,
  onActualD0Change,
  onAutoCalibrate,
  onManualCalibrate,
  onSurfaceYChange,
}: SpatialPanelProps) {
  return (
    <>
      <p className="panel-hint">
        典型画面：亮背景、暗液滴（中间可有高光白斑）、下方有镜面倒影。撞击面基准线取液滴与倒影之间亮缝在竖直方向的中线；自动标定会优先按此几何定位
        Surface Y，可用滑条或右侧箭头逐像素微调。
      </p>
      <label>
        初始直径 D0(mm)
        <input type="number" step="0.01" value={actualD0} onChange={(e) => onActualD0Change(+e.target.value)} />
      </label>
      <button className="success-btn wide" onClick={onAutoCalibrate} disabled={!hasVideo}>
        自动标定
      </button>
      {autoCalibError && <p className="calib-error">{autoCalibError}</p>}
      <button className="ghost-btn wide" onClick={onManualCalibrate}>
        手动点选标定
      </button>
      <label className="surface-y-label">
        Surface Y: {surfaceY ?? '--'} px
        <div className="surface-y-row">
          <input
            type="range"
            className="surface-y-range"
            min={0}
            max={intrinsicHeight}
            step={1}
            value={surfaceY ?? 0}
            disabled={!hasVideo}
            onChange={(e) => onSurfaceYChange(+e.target.value)}
          />
          <div className="surface-y-nudge" role="group" aria-label="Surface Y 逐像素微调">
            <button
              type="button"
              className="surface-y-nudge-btn"
              disabled={!hasVideo || surfaceY === null || surfaceY <= 0}
              title="基准线向上 1 px（Y 减小）"
              onClick={() => {
                if (surfaceY === null) return
                onSurfaceYChange(Math.max(0, surfaceY - 1))
              }}
            >
              <ChevronUp size={18} strokeWidth={2.25} aria-hidden />
            </button>
            <button
              type="button"
              className="surface-y-nudge-btn"
              disabled={!hasVideo || surfaceY === null || intrinsicHeight <= 0 || surfaceY >= intrinsicHeight}
              title="基准线向下 1 px（Y 增大）"
              onClick={() => {
                if (surfaceY === null) return
                onSurfaceYChange(Math.min(intrinsicHeight, surfaceY + 1))
              }}
            >
              <ChevronDown size={18} strokeWidth={2.25} aria-hidden />
            </button>
          </div>
        </div>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={analysisRegionSelectMode}
          disabled={!hasVideo}
          onChange={(e) => onAnalysisRegionSelectModeChange(e.target.checked)}
        />
        <span>框选计算区域（仅矩形内二值与铺展）</span>
      </label>
      <p className="panel-hint">
        勾选后在主画面上拖拽矩形；若已设 Surface Y，矩形会自动扩成包含该基准线。自动标定失败时也可先框住液滴与倒影的小区域，再点「自动标定」——仅在 ROI
        内拟合。过小区域会忽略。分析、轮廓与二值预览均限定在该区域内。
      </p>
      {analysisRegion && (
        <div className="meta meta-grid">
          <span>
            ROI: {analysisRegion.x},{analysisRegion.y} · {analysisRegion.w}×{analysisRegion.h} px
          </span>
          <button type="button" className="ghost-btn" onClick={onClearAnalysisRegion}>
            清除 ROI
          </button>
        </div>
      )}
      {pixelScale && (
        <div className="meta meta-grid">
          <span>比例: {pixelScale.toFixed(3)} px/mm</span>
          <span>分辨率: {(1 / pixelScale).toFixed(5)} mm/px</span>
        </div>
      )}
    </>
  )
}
