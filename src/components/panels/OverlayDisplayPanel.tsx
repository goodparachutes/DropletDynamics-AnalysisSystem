import type { OverlayDisplayState } from '../../types/overlayDisplay'

interface OverlayDisplayPanelProps {
  value: OverlayDisplayState
  onChange: (patch: Partial<OverlayDisplayState>) => void
}

function CheckboxRow(props: {
  id: string
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  const { id, checked, label, onChange } = props
  return (
    <div className="checkbox-row">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  )
}

export function OverlayDisplayPanel({ value, onChange }: OverlayDisplayPanelProps) {
  return (
    <>
      <p className="panel-hint">
        分组对应主画面叠加层：仅勾选的项目会显示；可多选。不影响分析与导出。
      </p>

      <div className="overlay-display-section">
        <div className="overlay-display-section-title">基准与读数</div>
        <CheckboxRow
          id="overlay-baseline"
          checked={value.baseline}
          label="撞击基准线（红线）"
          onChange={(v) => onChange({ baseline: v })}
        />
        <CheckboxRow
          id="overlay-scaleBar"
          checked={value.scaleBar}
          label="比例尺线段（左下角白线）"
          onChange={(v) => onChange({ scaleBar: v })}
        />
      </div>

      <div className="overlay-display-section">
        <div className="overlay-display-section-title">液滴与铺展</div>
        <CheckboxRow
          id="overlay-autoCalibCircle"
          checked={value.autoCalibCircle}
          label="自动标定液滴圆（蓝圈）"
          onChange={(v) => onChange({ autoCalibCircle: v })}
        />
        <CheckboxRow
          id="overlay-spreadFit"
          checked={value.spreadFit}
          label="铺展测量（橙线、柄点、青样条）"
          onChange={(v) => onChange({ spreadFit: v })}
        />
        <CheckboxRow
          id="overlay-contactAngleConstruction"
          checked={value.contactAngleConstruction}
          label="接触角拟合示意（回归点、拟合线、射线、扇形与 θ）"
          onChange={(v) => onChange({ contactAngleConstruction: v })}
        />
      </div>

      <div className="overlay-display-section">
        <div className="overlay-display-section-title">空泡动力学</div>
        <CheckboxRow
          id="overlay-bubbleCavityContour"
          checked={value.bubbleCavityContourOverlay}
          label="空泡轮廓（曲线选帧后的平滑闭合线；点击曲线数据点会自动勾选）"
          onChange={(v) => onChange({ bubbleCavityContourOverlay: v })}
        />
      </div>

      <div className="overlay-display-section">
        <div className="overlay-display-section-title">射流动力学</div>
        <CheckboxRow
          id="overlay-jetDynamicsContour"
          checked={value.jetDynamicsContourOverlay}
          label="射流轮廓（曲线选点后的 Moore 外轮廓；点击射流图数据点会自动勾选）"
          onChange={(v) => onChange({ jetDynamicsContourOverlay: v })}
        />
      </div>

      <div className="overlay-display-section">
        <div className="overlay-display-section-title">撞击分析</div>
        <CheckboxRow
          id="overlay-impactVelocity"
          checked={value.impactVelocity}
          label="撞击速度拟合（绿/紫圆与位移箭头）"
          onChange={(v) => onChange({ impactVelocity: v })}
        />
      </div>
    </>
  )
}
