import type { JetDynamicsSessionPersisted } from '../../types/jetDynamics'

export interface JetDynamicsPanelProps {
  session: JetDynamicsSessionPersisted
  onSessionChange: (next: JetDynamicsSessionPersisted) => void
  exportedFps: number
  samplingFps: number
  spatialCalibrationOk: boolean
  hasVideo: boolean
  intrinsicWidth: number
  isSelectingRoi: boolean
  onToggleSelectRoi: () => void
  /** 溃灭帧索引（来自空泡动力学），用于一键填入起始帧 */
  defaultStartFrameFromCavity: number | null
  onApplyCollapseAsStart: () => void
  isRunning: boolean
  onRunAnalysis: () => void
  onExportCsv: () => void
}

export function JetDynamicsPanel({
  session,
  onSessionChange,
  exportedFps,
  samplingFps,
  spatialCalibrationOk,
  hasVideo,
  intrinsicWidth,
  isSelectingRoi,
  onToggleSelectRoi,
  defaultStartFrameFromCavity,
  onApplyCollapseAsStart,
  isRunning,
  onRunAnalysis,
  onExportCsv,
}: JetDynamicsPanelProps) {
  const patch = (p: Partial<JetDynamicsSessionPersisted>) => {
    onSessionChange({ ...session, ...p })
  }

  const canRun =
    hasVideo &&
    session.roi != null &&
    session.frameEnd >= session.frameStart &&
    session.mmPerPx > 0 &&
    !isRunning &&
    !isSelectingRoi

  return (
    <div className="bubble-dynamics-panel jet-dynamics-panel">
      <p className="panel-hint bubble-dynamics-hint">
        <strong>射流动力学（Singular Jet）</strong>独立于铺展与空泡自动分析。在溃灭后时段（<strong>t &gt; t_c</strong>）框选<strong>高而窄</strong>的竖直 ROI，底部贴近「火山口」、顶部尽量覆盖射流可达高度；每帧在 ROI 内做 CLAHE + Otsu + 闭运算，提取多个连通域后用<strong>形心最近邻</strong>做帧间 ID 追踪。各滴外轮廓经<strong>最小二乘代数椭圆拟合</strong>（Halír–Flusser，与 OpenCV <code>fitEllipse</code> 同类）得平滑半轴 <strong>a、b</strong>：面积 <strong>πab</strong>、长宽比 <strong>a/b</strong>、体积 <strong>4/3·π·a·b²</strong> mm³；竖直标高 <strong>Z_c</strong> 取<strong>椭圆中心</strong>相对自由面高度（无拟合时用<strong>连通域形心</strong>）。<strong>V_jet</strong> 与 <strong>E_k</strong> 由 <strong>Z_c–t 整条轨迹线性回归</strong>（弹道）得到<strong>单一</strong>速度与<strong>锁定</strong>动能（体积取各帧 vol 的<strong>算术平均</strong>，ρ 取侧栏流体密度）；<strong>η、β</strong> 与此一致。物理时间 <strong>t（ms）= frame × (1000/fs)</strong>，与空泡曲线一致（fs 为侧栏采样 Hz）；视频寻址仍按<strong>导出 fe</strong>。
        {!spatialCalibrationOk ? (
          <span className="bubble-dynamics-warn"> 未做空间标定时 mm/px 沿用会话数值。</span>
        ) : null}
      </p>

      <div className="bubble-dynamics-grid">
        <label className="bubble-dynamics-field">
          <span title="与主区帧号一致，按导出 fe 对视频寻址">起始帧</span>
          <input
            type="number"
            min={0}
            step={1}
            value={session.frameStart}
            onChange={(e) => patch({ frameStart: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          />
        </label>
        <label className="bubble-dynamics-field">
          <span title="与主区帧号一致">结束帧</span>
          <input
            type="number"
            min={0}
            step={1}
            value={session.frameEnd}
            onChange={(e) => patch({ frameEnd: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          />
        </label>
        <div className="bubble-dynamics-field bubble-dynamics-readonly-sync">
          <span>导出 fe</span>
          <span className="bubble-dynamics-sync-value">{Math.max(1, Math.floor(exportedFps) || 1)} Hz</span>
        </div>
        <div className="bubble-dynamics-field bubble-dynamics-readonly-sync">
          <span>采样 fs（物理 t）</span>
          <span className="bubble-dynamics-sync-value">{Math.max(1, Math.floor(samplingFps) || 1)} Hz</span>
        </div>
        <div className="bubble-dynamics-field bubble-dynamics-readonly-sync">
          <span>mm/px</span>
          <span className="bubble-dynamics-sync-value">
            {session.mmPerPx > 0 ? session.mmPerPx.toExponential(6) : '—'}
          </span>
        </div>
        <label className="bubble-dynamics-field">
          <span title="面积小于此值的连通域视为噪点，不参与追踪">min_jet_pixels</span>
          <input
            type="number"
            min={1}
            step={1}
            value={session.minJetPixels}
            onChange={(e) => patch({ minJetPixels: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
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
          射流/液滴较背景更暗（Otsu 前景为低灰度）
        </label>
        <label className="chart-series-toggle">
          <input
            type="checkbox"
            checked={session.invertOtsu}
            onChange={(e) => patch({ invertOtsu: e.target.checked })}
          />
          二值取反
        </label>
      </div>

      <details className="bubble-dynamics-advanced">
        <summary className="bubble-dynamics-advanced-summary">高级（与空泡相同的 Otsu ε / 圆盘闭运算）</summary>
        <div className="bubble-dynamics-advanced-body">
          <label className="bubble-dynamics-slider-row">
            <span className="bubble-dynamics-slider-label">ε</span>
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
          <label className="bubble-dynamics-slider-row">
            <span className="bubble-dynamics-slider-label">圆盘半径 px</span>
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
        <button
          type="button"
          className="ghost-btn"
          disabled={defaultStartFrameFromCavity == null}
          title={
            defaultStartFrameFromCavity != null
              ? `将起始帧设为溃灭帧 ${defaultStartFrameFromCavity}`
              : '需先在空泡动力学中得到溃灭帧'
          }
          onClick={onApplyCollapseAsStart}
        >
          用溃灭帧作起点
        </button>
        <button
          type="button"
          className={isSelectingRoi ? 'primary-btn' : 'algo-btn'}
          disabled={!hasVideo || intrinsicWidth <= 0 || isRunning}
          onClick={onToggleSelectRoi}
        >
          {isSelectingRoi ? '结束射流 ROI…' : '框选射流 ROI'}
        </button>
        <button type="button" className="primary-btn" disabled={!canRun} onClick={onRunAnalysis}>
          {isRunning ? '正在追踪…' : '运行射流追踪'}
        </button>
        <button type="button" className="algo-btn" disabled={session.dropTracks.length === 0} onClick={onExportCsv}>
          导出 CSV
        </button>
      </div>

      {session.roi && (
        <div className="bubble-dynamics-roi-meta" style={{ color: '#7dd3fc' }}>
          射流 ROI: {session.roi.x},{session.roi.y} · {session.roi.w}×{session.roi.h} px
        </div>
      )}
    </div>
  )
}
