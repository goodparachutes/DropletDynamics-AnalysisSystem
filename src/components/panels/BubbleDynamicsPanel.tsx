import type { CavityDynamicsFrameResult, CavityDynamicsSessionPersisted } from '../../types/cavityDynamics'
import {
  cavityAbTooltip,
  cavityArTooltip,
  cavityDeltaPTooltip,
  cavityFeSyncTooltip,
  cavityFrameTooltip,
  cavityKappaMmTooltip,
  cavityKappaPxTooltip,
  cavityMinPixelsTooltip,
  cavityMmPerPxTooltip,
  cavityMorphCloseDiskRadiusTooltip,
  cavityOtsuRelaxEpsilonTooltip,
  cavityReqTooltip,
  cavitySigmaTooltip,
  cavityTimeMsTooltip,
  cavityVrAbsTooltip,
  cavityVrTooltip,
  cavityVzTooltip,
  cavityZcTooltip,
} from '../../features/cavity/cavityParamTooltips'

export interface BubbleDynamicsPanelProps {
  session: CavityDynamicsSessionPersisted
  onSessionChange: (next: CavityDynamicsSessionPersisted) => void
  /** 与空泡视频寻址同步：侧栏「导出 fe」 */
  exportedFps: number
  /** 物理时间轴：侧栏「采样 fs」，t_ms = frame×(1000/fs) */
  samplingFps: number
  /** 已设定空间标定（px/mm）时 mm/px 由全局自动写入 */
  spatialCalibrationOk: boolean
  surfaceY: number | null
  hasVideo: boolean
  intrinsicWidth: number
  isSelectingRoi: boolean
  onToggleSelectRoi: () => void
  onSeekToFrameStart: () => void
  isRunning: boolean
  onRunAnalysis: () => void
  onExportCsv: () => void
  /** 框选 ROI 失败等原因的提示 */
  roiFeedback?: string | null
  /** 主画布手绘空泡轮廓 */
  manualTraceMode?: boolean
  onStartManualTrace?: () => void
  onCancelManualTrace?: () => void
}

export function BubbleDynamicsPanel({
  session,
  onSessionChange,
  exportedFps,
  samplingFps,
  spatialCalibrationOk,
  surfaceY,
  hasVideo,
  intrinsicWidth,
  isSelectingRoi,
  onToggleSelectRoi,
  onSeekToFrameStart,
  isRunning,
  onRunAnalysis,
  onExportCsv,
  roiFeedback = null,
  manualTraceMode = false,
  onStartManualTrace,
  onCancelManualTrace,
}: BubbleDynamicsPanelProps) {
  const patch = (p: Partial<CavityDynamicsSessionPersisted>) => {
    onSessionChange({ ...session, ...p })
  }

  const canRun =
    hasVideo &&
    session.roi != null &&
    session.frameEnd >= session.frameStart &&
    session.fps > 0 &&
    session.mmPerPx > 0 &&
    !isRunning &&
    !isSelectingRoi

  return (
    <div className="bubble-dynamics-panel">
      <p className="panel-hint bubble-dynamics-hint">
        <strong>空泡动力学</strong>独立于「开始自动分析」。帧号与主区一致，按<strong>导出 fe = {Math.max(1, Math.floor(exportedFps) || 1)} Hz</strong>对视频寻址；曲线与表中<strong>时间 t 一律用毫秒</strong>，且 <strong>t_ms = frame × (1000 / fs)</strong>，其中 <strong>fs = {Math.max(1, Math.floor(samplingFps) || 1)} Hz</strong>（侧栏「采样 fs」）。故相邻整数帧在<strong>物理时间轴</strong>上的间隔为 <strong>{(1000 / Math.max(1, samplingFps)).toPrecision(4)} ms</strong>（fs=5000 时为 0.2 ms/步；若你期望 2 ms/步，需 fs=500 Hz 或相应调整采样率）。<strong>mm/px</strong> 与全局标定自动同步。在<strong>起始帧</strong>上框选包含气泡的 ROI（宽、高各至少约 12 px），再运行提取。算法：ROI 内 CLAHE → Otsu 二值 →
        最大连通域 → Moore 外轮廓 → SG 平滑 → 几何量；<strong>长宽比护栏</strong>：连通域包围盒 AR = (y_max−y_min)/(x_max−x_min) 若 ∉ [0.2, 5.0] 则判为<strong>非气泡杂质</strong>，该帧几何量置空并<strong>终止序列</strong>。溃灭判据仍为连通域像素低于阈值。<strong>R_eq</strong> 与 <strong>A_b</strong> 同源：A_b 为掩膜像素面积 × (mm/px)²，R_eq = √(A_b/π)。<strong>R_eq / A_b 曲线</strong>显示在主区「体积守恒 — V 与 V/V₀」图表下方。顶点曲率：<strong>κ_mm = κ_px ÷ (mm/px)</strong>。<strong>V_r</strong> 为 dR_eq/dt：<strong>负</strong>为向内坍塌，<strong>正</strong>为膨胀。
        {surfaceY == null ? (
          <span className="bubble-dynamics-warn"> 未设定 Surface Y 时 Zc / V_centroid 将为空。</span>
        ) : null}
        {!spatialCalibrationOk ? (
          <span className="bubble-dynamics-warn"> 未做空间标定时 mm/px 沿用会话内数值，标定后自动刷新。</span>
        ) : null}
      </p>

      <div className="bubble-dynamics-grid">
        <label className="bubble-dynamics-field">
          <span title={cavityFrameTooltip}>起始帧 frame_start</span>
          <input
            type="number"
            min={0}
            step={1}
            value={session.frameStart}
            onChange={(e) => patch({ frameStart: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          />
        </label>
        <label className="bubble-dynamics-field">
          <span title={cavityFrameTooltip}>结束帧 frame_end</span>
          <input
            type="number"
            min={0}
            step={1}
            value={session.frameEnd}
            onChange={(e) => patch({ frameEnd: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          />
        </label>
        <div className="bubble-dynamics-field bubble-dynamics-readonly-sync">
          <span title={cavityFeSyncTooltip}>导出 fe（视频寻址）</span>
          <span className="bubble-dynamics-sync-value" title={cavityFeSyncTooltip}>
            {Math.max(1, Math.floor(exportedFps) || 1)} Hz
          </span>
        </div>
        <div className="bubble-dynamics-field bubble-dynamics-readonly-sync">
          <span title={cavityTimeMsTooltip}>采样 fs（物理 t）</span>
          <span className="bubble-dynamics-sync-value" title={cavityTimeMsTooltip}>
            {Math.max(1, Math.floor(samplingFps) || 1)} Hz
          </span>
        </div>
        <div className="bubble-dynamics-field bubble-dynamics-readonly-sync">
          <span title={cavityMmPerPxTooltip}>mm/px（物理标定）</span>
          <span className="bubble-dynamics-sync-value" title={cavityMmPerPxTooltip}>
            {session.mmPerPx > 0 ? session.mmPerPx.toExponential(6) : '—'}
          </span>
        </div>
        <label className="bubble-dynamics-field">
          <span title={cavitySigmaTooltip}>表面张力 σ (N/m)</span>
          <input
            type="number"
            min={1e-9}
            step="any"
            value={session.sigmaNm}
            onChange={(e) => patch({ sigmaNm: Math.max(1e-9, Number(e.target.value) || session.sigmaNm) })}
          />
        </label>
        <label className="bubble-dynamics-field">
          <span title={cavityMinPixelsTooltip}>最小像素阈值 min_pixels</span>
          <input
            type="number"
            min={1}
            step={1}
            value={session.minPixels}
            onChange={(e) => patch({ minPixels: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          />
        </label>
      </div>

      <div className="bubble-dynamics-toggles">
        <label className="chart-series-toggle">
          <input
            type="checkbox"
            checked={session.bubbleDark}
            onChange={(e) => patch({ bubbleDark: e.target.checked })}
          />
          气泡较背景更暗（低于阈值为孔洞）
        </label>
        <label className="chart-series-toggle">
          <input
            type="checkbox"
            checked={session.invertOtsu}
            onChange={(e) => patch({ invertOtsu: e.target.checked })}
          />
          二值结果取反（成像对比相反时）
        </label>
      </div>

      <details className="bubble-dynamics-advanced">
        <summary className="bubble-dynamics-advanced-summary">
          高级设置（Advanced / Debug）
        </summary>
        <div className="bubble-dynamics-advanced-body">
          <p className="bubble-dynamics-advanced-hint">
            Otsu 松弛 ε 与圆盘闭运算半径：攻坚阶段用于快速适配不同黏度（如 100 cSt vs 1000 cSt）的反光与膜厚；随工程快照保存。
          </p>
          <label className="bubble-dynamics-slider-row" title={cavityOtsuRelaxEpsilonTooltip}>
            <span className="bubble-dynamics-slider-label">ε（Otsu 松弛）</span>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={session.otsuRelaxEpsilon}
              onChange={(e) =>
                patch({ otsuRelaxEpsilon: Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))) })
              }
            />
            <span className="bubble-dynamics-slider-value">{session.otsuRelaxEpsilon}</span>
          </label>
          <label className="bubble-dynamics-slider-row" title={cavityMorphCloseDiskRadiusTooltip}>
            <span className="bubble-dynamics-slider-label">圆盘半径（px）</span>
            <input
              type="range"
              min={0}
              max={24}
              step={1}
              value={session.morphCloseDiskRadiusPx}
              onChange={(e) =>
                patch({
                  morphCloseDiskRadiusPx: Math.max(0, Math.min(24, Math.round(Number(e.target.value) || 0))),
                })
              }
            />
            <span className="bubble-dynamics-slider-value">{session.morphCloseDiskRadiusPx}</span>
          </label>
        </div>
      </details>

      <div className="bubble-dynamics-actions">
        <button type="button" className="ghost-btn" disabled={!hasVideo} onClick={onSeekToFrameStart}>
          跳到起始帧
        </button>
        <button
          type="button"
          className={isSelectingRoi ? 'primary-btn' : 'algo-btn'}
          disabled={!hasVideo || intrinsicWidth <= 0 || manualTraceMode}
          onClick={onToggleSelectRoi}
        >
          {isSelectingRoi ? '结束框选…' : '框选气泡 ROI（起始帧）'}
        </button>
        <button type="button" className="primary-btn" disabled={!canRun} onClick={onRunAnalysis}>
          {isRunning ? '正在提取…' : '运行空泡序列分析'}
        </button>
        <button type="button" className="algo-btn" disabled={session.lastResults.length === 0} onClick={onExportCsv}>
          导出 CSV
        </button>
      </div>
      <div className="bubble-dynamics-manual-row">
        {!manualTraceMode ? (
          <button
            type="button"
            className="algo-btn"
            disabled={!hasVideo || session.lastResults.length === 0 || isRunning || !onStartManualTrace}
            onClick={() => onStartManualTrace?.()}
          >
            开启手动描点
          </button>
        ) : (
          <button type="button" className="ghost-btn" disabled={!onCancelManualTrace} onClick={() => onCancelManualTrace?.()}>
            退出手动描点
          </button>
        )}
      </div>
      {manualTraceMode ? (
        <p className="bubble-dynamics-manual-hint">
          已暂停播放并对齐目标帧。在主画面上<strong>单击</strong>依次加点，<strong>双击</strong>闭合多边形；几何量改用鞋带面积与多边形形心，凹底曲率由局部抛物线拟合。<kbd>Esc</kbd> 取消。
        </p>
      ) : null}
      {roiFeedback ? <div className="bubble-dynamics-roi-feedback">{roiFeedback}</div> : null}

      {session.roi && (
        <div className="bubble-dynamics-roi-meta">
          ROI: {session.roi.x},{session.roi.y} · {session.roi.w}×{session.roi.h} px
        </div>
      )}

      {session.lastResults.length > 0 && (
        <div className="bubble-dynamics-table-wrap">
          <table className="bubble-dynamics-table">
            <thead>
              <tr>
                <th title={cavityFrameTooltip}>帧</th>
                <th title={cavityTimeMsTooltip}>t (ms)</th>
                <th title={cavityAbTooltip}>A_b</th>
                <th title={cavityReqTooltip}>R_eq</th>
                <th title={cavityZcTooltip}>Z_c mm</th>
                <th title={cavityArTooltip}>AR</th>
                <th title={cavityKappaMmTooltip}>κ (1/mm)</th>
                <th title={cavityKappaPxTooltip}>κ (1/px)</th>
                <th title={cavityVrTooltip}>V_r</th>
                <th title={cavityVrAbsTooltip}>|V_r|</th>
                <th title={cavityVzTooltip}>V_z</th>
                <th title={cavityDeltaPTooltip}>ΔP</th>
              </tr>
            </thead>
            <tbody>
              {session.lastResults.map((row: CavityDynamicsFrameResult) => (
                <tr key={row.frameIndex}>
                  <td>{row.frameIndex}</td>
                  <td>{(row.timeSec * 1000).toFixed(4)}</td>
                  <td>{row.areaMm2?.toFixed(5) ?? '—'}</td>
                  <td>{row.reqMm?.toFixed(5) ?? '—'}</td>
                  <td>{row.zcMm?.toFixed(5) ?? '—'}</td>
                  <td>{row.aspectRatio?.toFixed(4) ?? '—'}</td>
                  <td>{row.kappaApexPerMm?.toFixed(6) ?? '—'}</td>
                  <td>{row.kappaApexPerPx?.toFixed(6) ?? '—'}</td>
                  <td>{row.vrMmPerS?.toFixed(5) ?? '—'}</td>
                  <td>{row.vrAbsMmPerS?.toFixed(5) ?? '—'}</td>
                  <td>{row.vCentroidMmPerS?.toFixed(5) ?? '—'}</td>
                  <td>{row.deltaPLaplacePa?.toExponential(4) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
