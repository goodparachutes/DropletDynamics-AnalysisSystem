import type { DissipationSmoothMode } from '../../features/analysis/surfaceEnergy'

interface SurfaceEnergyPanelProps {
  gammaBw: number
  gammaBa: number
  onGammaBwChange: (value: number) => void
  onGammaBaChange: (value: number) => void
  dissipationSmoothMode: DissipationSmoothMode
  onDissipationSmoothModeChange: (mode: DissipationSmoothMode) => void
}

/** 基底界面张力：LESS 填 γ_ow / γ_oa；裸固体填 γ_sw / γ_sa（与撞击速度面板共用 γ_wa、ρ） */
export function SurfaceEnergyPanel({
  gammaBw,
  gammaBa,
  onGammaBwChange,
  onGammaBaChange,
  dissipationSmoothMode,
  onDissipationSmoothModeChange,
}: SurfaceEnergyPanelProps) {
  return (
    <>
      <label>
        γ_bw — 基底–水 (N/m)
        <span className="panel-field-sub">硅油–水 γ_ow；固体–水 γ_sw</span>
        <input
          type="number"
          step="0.0001"
          min={0}
          value={gammaBw}
          onChange={(e) => onGammaBwChange(Number.isFinite(+e.target.value) ? +e.target.value : 0.041)}
        />
      </label>
      <label>
        γ_ba — 基底–气 (N/m)
        <span className="panel-field-sub">硅油–气 γ_oa；固体–气 γ_sa</span>
        <input
          type="number"
          step="0.0001"
          min={0}
          value={gammaBa}
          onChange={(e) => onGammaBaChange(Number.isFinite(+e.target.value) ? +e.target.value : 0.0205)}
        />
      </label>
      <div className="dissipation-smooth-block">
        <span className="panel-field-sub">耗散 Φ 平滑（原始 W 差分之后）</span>
        <div className="algo-switch dissipation-smooth-switch">
          <button
            type="button"
            className={`ghost-btn algo-btn ${dissipationSmoothMode === 'ma' ? 'active' : ''}`}
            title="对称滑动平均：默认，快速稳健"
            onClick={() => onDissipationSmoothModeChange('ma')}
          >
            MA
          </button>
          <button
            type="button"
            className={`ghost-btn algo-btn ${dissipationSmoothMode === 'sg' ? 'active' : ''}`}
            title="Savitzky–Golay：论文级曲线（窗宽与多项式见代码默认）"
            onClick={() => onDissipationSmoothModeChange('sg')}
          >
            SG
          </button>
        </div>
        <p className="panel-hint dissipation-smooth-hint">
          W_diss 保持原始（能量闭合）；仅对由 W 差分得到的 raw Φ 做 MA/SG，最后 max(0,·)。SG 在连续有限片段上分滤波，短段退化为 MA。
        </p>
      </div>
      <p className="panel-hint">
        ΔE_σ 相对触前理想球（E_0 = π D₀² γ_wa）；A_wa、V、Z_cm 由 Moore 外轮廓母线积分；Moore 路径下对半径序列默认做
        Savitzky–Golay 平滑以抑制像素锯齿带来的表面积偏大，再算 ∮ 2πr ds 与体积。V_cm、V_spread
        对时间采用同一套中心差分（首尾单侧），E_k = ½M[V_cm² + ½ V_spread²]，M = πρ_w D₀³/6；总机械能 E_mech = E_k +
        ΔE_σ（图表与导出）。γ_wa、ρ 取自侧栏「撞击速度分析」。
      </p>
    </>
  )
}
