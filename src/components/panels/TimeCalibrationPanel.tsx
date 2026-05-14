interface TimeCalibrationPanelProps {
  zeroTime: number
  samplingFps: number
  exportedFps: number
  onSetZero: () => void
  onSamplingFpsChange: (value: number) => void
  onExportedFpsChange: (value: number) => void
}

export function TimeCalibrationPanel({
  zeroTime,
  samplingFps,
  exportedFps,
  onSetZero,
  onSamplingFpsChange,
  onExportedFpsChange,
}: TimeCalibrationPanelProps) {
  return (
    <>
      <button className="primary-btn wide" onClick={onSetZero}>
        设当前帧为 t=0 (撞击瞬间)
      </button>
      <div className="field-grid">
        <label>
          采样 fs
          <input type="number" min={1} value={samplingFps} onChange={(e) => onSamplingFpsChange(+e.target.value)} />
        </label>
        <label>
          导出 fe
          <input type="number" min={1} value={exportedFps} onChange={(e) => onExportedFpsChange(+e.target.value)} />
        </label>
      </div>
      <p className="panel-hint time-calib-fe-hint">
        <strong>导出帧率 fe</strong> 会参与计算：分析点时间{' '}
        <code>t = (视频时刻 − t₀) × (fe / fs)</code>
        ，主区播放条 ±1 帧步长，撞击速度回归的取样间隔，以及表面能/动能相关量的时间差分。请与导出序列实际帧率一致。
      </p>
      <div className="meta">当前 t0: {zeroTime.toFixed(4)}s</div>
    </>
  )
}
