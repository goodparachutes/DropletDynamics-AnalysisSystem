import type { ImpactResult } from '../../features/analysis/impact'

interface ImpactPanelProps {
  preImpactFrames: number
  fluidDensity: number
  surfaceTension: number
  isRunning: boolean
  result: ImpactResult | null
  onFramesChange: (value: number) => void
  onFluidDensityChange: (value: number) => void
  onSurfaceTensionChange: (value: number) => void
  onAnalyze: () => void
}

export function ImpactPanel({
  preImpactFrames,
  fluidDensity,
  surfaceTension,
  isRunning,
  result,
  onFramesChange,
  onFluidDensityChange,
  onSurfaceTensionChange,
  onAnalyze,
}: ImpactPanelProps) {
  return (
    <>
      <label>
        t0 前取帧数
        <input
          type="number"
          min={2}
          max={100}
          value={preImpactFrames}
          onChange={(e) => onFramesChange(+e.target.value)}
        />
      </label>
      <label>
        密度 ρ (kg/m³)
        <input
          type="number"
          min={1}
          value={fluidDensity}
          onChange={(e) => onFluidDensityChange(+e.target.value)}
        />
      </label>
      <label>
        表面张力 γ (N/m)
        <input
          type="number"
          step="0.0001"
          min={0.000001}
          value={surfaceTension}
          onChange={(e) => onSurfaceTensionChange(+e.target.value)}
        />
      </label>
      <button className="primary-btn wide" onClick={onAnalyze} disabled={isRunning}>
        {isRunning ? '计算中...' : '计算速度与Weber数'}
      </button>
      <p className="panel-hint">
        圆拟合与自动标定共用同一实现；请先设定 Surface Y（推荐自动标定），撞击前帧常无倒影时会用该红线截取液滴。速度：在 t0 前按导出帧间隔取样，每帧得 (cx,
        cy)；物理时间 t 由 <code>(帧时刻 − t0) × (导出帧率 / 采样帧率)</code> 缩放，对 t–cx、t–cy 线性回归得合速度 |v|，再换
        m/s 与 We = ρU²D₀/γ。
      </p>
      {result && (
        <div className="meta meta-grid">
          <span>速度: {result.velocityMps.toFixed(4)} m/s</span>
          <span>像素速度: {result.velocityPxPerS.toFixed(2)} px/s</span>
          <span>We: {result.weber < 0.001 ? result.weber.toExponential(3) : result.weber.toFixed(4)}</span>
          <span>有效拟合帧: {result.usedFrames}</span>
          <span>
            首–末圆心位移: {result.displacementPx.toFixed(1)} px（画布上绿圆最早帧、紫圆最接近 t0）
          </span>
        </div>
      )}
    </>
  )
}
