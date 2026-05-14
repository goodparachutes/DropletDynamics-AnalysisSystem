import { ChevronDown, Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SurfaceEnergyInstant } from '../../features/analysis/surfaceEnergy'
import { CHART_METRIC_TOOLTIPS } from './chartSeriesMetricTooltips'
import { CURVE_PLAYBACK_STEP_MS } from './curvePlaybackMs'

type ChartRow = {
  /** 与 `analysisData` 同序下标，用于点击同步视频与叠加层 */
  analysisIndex: number
  time: number
  contourExtractFailed: boolean
  awaMm2: number | null
  abaseMm2: number | null
  deltaMicroJ: number | null
  ekMicroJ: number | null
  emechMicroJ: number | null
  wdissMicroJ: number | null
  /** Φ（µW），由 dissipationPowerW×10⁶ */
  phiMicroW: number | null
  /** E_k + ΔE_σ + W_diss（µJ），三项均有限时才有值 */
  etotalMicroJ: number | null
  /** E_mech(0)（µJ），全局参考；用于与 E_total 对照 */
  emechanical0MicroJ: number | null
  volumeMm3: number | null
  zCmMm: number | null
}

function toChartRows(data: SurfaceEnergyInstant[]): ChartRow[] {
  return data.map((d, analysisIndex) => ({
    analysisIndex,
    time: d.timeMs,
    contourExtractFailed: d.contourExtractFailed,
    awaMm2: d.awaMm2,
    abaseMm2: d.abaseMm2,
    deltaMicroJ: d.deltaESigmaJ != null ? d.deltaESigmaJ * 1e6 : null,
    ekMicroJ: d.ekJ != null ? d.ekJ * 1e6 : null,
    emechMicroJ: d.emechanicalJ != null ? d.emechanicalJ * 1e6 : null,
    wdissMicroJ: d.dissipationWorkJ != null ? d.dissipationWorkJ * 1e6 : null,
    phiMicroW:
      d.dissipationPowerW != null && Number.isFinite(d.dissipationPowerW)
        ? d.dissipationPowerW * 1e6
        : null,
    etotalMicroJ:
      d.ekJ != null &&
      d.deltaESigmaJ != null &&
      d.dissipationWorkJ != null &&
      Number.isFinite(d.ekJ) &&
      Number.isFinite(d.deltaESigmaJ) &&
      Number.isFinite(d.dissipationWorkJ)
        ? (d.ekJ + d.deltaESigmaJ + d.dissipationWorkJ) * 1e6
        : null,
    emechanical0MicroJ:
      d.emechanical0J != null && Number.isFinite(d.emechanical0J)
        ? d.emechanical0J * 1e6
        : null,
    volumeMm3: d.volumeMm3,
    zCmMm: d.zCmMm,
  }))
}

function parseTooltipDataIndex(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v !== '') {
    const n = Number.parseInt(v, 10)
    if (!Number.isNaN(n)) return n
  }
  return null
}

/** Recharts 3：`onClick(nextState)`；旧版偶见 `activePayload` */
function resolveSurfaceEnergyClickIndex(eventData: unknown, rows: ChartRow[]): number | null {
  if (!eventData || typeof eventData !== 'object') return null
  const raw = eventData as {
    activePayload?: Array<{ payload?: ChartRow }>
    activeTooltipIndex?: unknown
    activeIndex?: unknown
  }
  const payload = raw.activePayload?.[0]?.payload
  if (payload && typeof payload.analysisIndex === 'number') return payload.analysisIndex

  const ti =
    parseTooltipDataIndex(raw.activeTooltipIndex) ?? parseTooltipDataIndex(raw.activeIndex)
  if (ti != null && ti >= 0 && ti < rows.length) return rows[ti].analysisIndex
  return null
}

type LineKey = 'awa' | 'abase' | 'dE' | 'ek' | 'emech' | 'wdiss' | 'etotal' | 'phi'

function SurfaceEnergyScatterDot(props: {
  cx?: number
  cy?: number
  payload?: ChartRow
  lineStroke: string
  lineKey: LineKey
  hitLineKey: LineKey | null
  onPick?: (analysisIndex: number) => void
}) {
  const { cx, cy, payload, lineStroke, lineKey, hitLineKey, onPick } = props
  if (!payload || typeof cx !== 'number' || typeof cy !== 'number') return null
  const failed = payload.contourExtractFailed
  const fill = failed ? '#ef4444' : lineStroke
  const strokeCol = failed ? '#7f1d1d' : 'rgba(15,23,42,0.45)'
  const isHitLayer = Boolean(onPick && hitLineKey === lineKey)

  if (isHitLayer) {
    return (
      <g
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation()
          onPick!(payload.analysisIndex)
        }}
      >
        <circle cx={cx} cy={cy} r={14} fill="transparent" />
        <circle
          cx={cx}
          cy={cy}
          r={failed ? 4.4 : 3.2}
          fill={fill}
          stroke={strokeCol}
          strokeWidth={failed ? 1.25 : 1}
        />
      </g>
    )
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={failed ? 3.8 : 2.6}
      fill={fill}
      stroke={strokeCol}
      strokeWidth={1}
    />
  )
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartRow }>
  label?: number
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="tooltip">
      <div>相对时间: {label} ms</div>
      {row.contourExtractFailed && (
        <div style={{ color: '#fca5a5', fontWeight: 600 }}>外轮廓提取失败（红点）</div>
      )}
      {row.awaMm2 != null && <div>A_wa: {row.awaMm2.toFixed(3)} mm²</div>}
      {row.abaseMm2 != null && <div>A_base: {row.abaseMm2.toFixed(3)} mm²</div>}
      {row.volumeMm3 != null && <div>V: {row.volumeMm3.toFixed(4)} mm³</div>}
      {row.zCmMm != null && <div>Z_cm: {row.zCmMm.toFixed(4)} mm</div>}
      {row.deltaMicroJ != null && <div>ΔE_σ: {row.deltaMicroJ.toFixed(3)} µJ</div>}
      {row.ekMicroJ != null && <div>E_k: {row.ekMicroJ.toFixed(3)} µJ</div>}
      {row.emechMicroJ != null && <div>E_mech: {row.emechMicroJ.toFixed(3)} µJ</div>}
      {row.wdissMicroJ != null && <div>W_diss: {row.wdissMicroJ.toFixed(3)} µJ</div>}
      {row.etotalMicroJ != null && (
        <div>
          E_total: {row.etotalMicroJ.toFixed(3)} µJ
          {row.emechanical0MicroJ != null && (
            <span style={{ opacity: 0.85 }}>
              {' '}
              （E_mech(0) 参考 {row.emechanical0MicroJ.toFixed(3)} µJ）
            </span>
          )}
        </div>
      )}
      {row.phiMicroW != null && <div>Φ: {row.phiMicroW.toFixed(3)} µW</div>}
    </div>
  )
}

type CurveVisibility = {
  awa: boolean
  abase: boolean
  dE: boolean
  ek: boolean
  emech: boolean
  wdiss: boolean
  etotal: boolean
  phi: boolean
}

interface SurfaceEnergyChartProps {
  data: SurfaceEnergyInstant[]
  /** 点击图表上某一时刻，同步主视频与铺展/轮廓叠加 */
  onAnalysisIndexClick?: (analysisIndex: number) => void
  /** 与接触线动力学图相同：按分析索引顺序逐帧跳转 */
  onCurvePlaybackStep?: (analysisIndex: number) => void
}

export function SurfaceEnergyChart({
  data,
  onAnalysisIndexClick,
  onCurvePlaybackStep,
}: SurfaceEnergyChartProps) {
  const [curvePlayback, setCurvePlayback] = useState(false)
  const [chartCollapsed, setChartCollapsed] = useState(false)
  const [playbackTimeX, setPlaybackTimeX] = useState<number | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data

  const [curves, setCurves] = useState<CurveVisibility>({
    awa: true,
    abase: true,
    dE: true,
    ek: true,
    emech: true,
    wdiss: false,
    etotal: false,
    phi: false,
  })

  const patch = useCallback((key: keyof CurveVisibility, v: boolean) => {
    setCurves((prev) => {
      const next = { ...prev, [key]: v }
      if (
        !next.awa &&
        !next.abase &&
        !next.dE &&
        !next.ek &&
        !next.emech &&
        !next.wdiss &&
        !next.etotal &&
        !next.phi
      )
        return prev
      return next
    })
  }, [])

  const chartData = useMemo(() => toChartRows(data), [data])
  const anyCurve =
    curves.awa ||
    curves.abase ||
    curves.dE ||
    curves.ek ||
    curves.emech ||
    curves.wdiss ||
    curves.etotal ||
    curves.phi

  const stopPlayback = useCallback(() => {
    setCurvePlayback(false)
    setPlaybackTimeX(null)
  }, [])

  useEffect(() => {
    const series = dataRef.current
    if (!curvePlayback || chartCollapsed || series.length === 0 || !onCurvePlaybackStep) {
      setPlaybackTimeX(null)
      if (series.length === 0 && curvePlayback) setCurvePlayback(false)
      return undefined
    }
    let idx = 0
    const len = series.length
    onCurvePlaybackStep(idx)
    setPlaybackTimeX(series[idx]?.timeMs ?? null)
    const id = window.setInterval(() => {
      idx += 1
      if (idx >= len) {
        setCurvePlayback(false)
        setPlaybackTimeX(null)
        return
      }
      const row = dataRef.current[idx]
      onCurvePlaybackStep(idx)
      setPlaybackTimeX(row?.timeMs ?? null)
    }, CURVE_PLAYBACK_STEP_MS)
    return () => clearInterval(id)
  }, [curvePlayback, chartCollapsed, data.length, onCurvePlaybackStep])

  const showEjEnergyAxis =
    curves.dE || curves.ek || curves.emech || curves.wdiss || curves.etotal
  const showPhiAxis = curves.phi

  /** 只在第一条显示的曲线上挂放大命中层，避免重叠重复触发 */
  const playbackRefAxisId =
    curves.awa || curves.abase ? 'area' : showPhiAxis ? 'phi' : 'ej'

  const hitLineKey = useMemo<LineKey | null>(() => {
    if (!onAnalysisIndexClick) return null
    if (curves.awa) return 'awa'
    if (curves.abase) return 'abase'
    if (curves.dE) return 'dE'
    if (curves.ek) return 'ek'
    if (curves.emech) return 'emech'
    if (curves.wdiss) return 'wdiss'
    if (curves.etotal) return 'etotal'
    if (curves.phi) return 'phi'
    return null
  }, [
    curves.awa,
    curves.abase,
    curves.dE,
    curves.ek,
    curves.emech,
    curves.wdiss,
    curves.etotal,
    curves.phi,
    onAnalysisIndexClick,
  ])

  const emech0RefMicroJ = useMemo(() => {
    for (const row of chartData) {
      if (row.emechanical0MicroJ != null) return row.emechanical0MicroJ
    }
    return null
  }, [chartData])

  const handleChartClick = useCallback(
    (nextState: unknown, _event?: unknown) => {
      if (!onAnalysisIndexClick) return
      stopPlayback()
      const idx = resolveSurfaceEnergyClickIndex(nextState, chartData)
      if (idx != null) onAnalysisIndexClick(idx)
    },
    [chartData, onAnalysisIndexClick, stopPlayback],
  )

  const pickFromChart = useCallback(
    (analysisIndex: number) => {
      stopPlayback()
      onAnalysisIndexClick?.(analysisIndex)
    },
    [onAnalysisIndexClick, stopPlayback],
  )

  const makeDot = useCallback(
    (lineStroke: string, lineKey: LineKey) =>
      (dotProps: { cx?: number; cy?: number; payload?: ChartRow }) => (
        <SurfaceEnergyScatterDot
          cx={dotProps.cx}
          cy={dotProps.cy}
          payload={dotProps.payload}
          lineStroke={lineStroke}
          lineKey={lineKey}
          hitLineKey={hitLineKey}
          onPick={pickFromChart}
        />
      ),
    [hitLineKey, pickFromChart],
  )

  return (
    <div className={`panel chart-panel ${chartCollapsed ? 'chart-panel-collapsed' : ''}`}>
      <div className="chart-header chart-header-with-collapse" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="chart-collapse-toggle"
          aria-expanded={!chartCollapsed}
          aria-label={chartCollapsed ? '展开表面能与机械能图' : '收起表面能与机械能图'}
          title={chartCollapsed ? '展开' : '收起'}
          onClick={(e) => {
            e.stopPropagation()
            setChartCollapsed((c) => {
              const next = !c
              if (next) stopPlayback()
              return next
            })
          }}
        >
          <ChevronDown
            size={18}
            className={`chart-collapse-chevron ${chartCollapsed ? 'chart-collapse-chevron-folded' : ''}`}
          />
        </button>
        <div className="panel-title">表面能、动能与机械能</div>
        {onCurvePlaybackStep && (
          <div className="chart-action-btns" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className={`algo-btn ${curvePlayback ? 'active' : ''}`}
              disabled={chartData.length === 0 || chartCollapsed}
              title={`按分析序列逐点跳转（约 ${CURVE_PLAYBACK_STEP_MS} ms/点），与接触线动力学图一致`}
              onClick={() => setCurvePlayback((p) => !p)}
            >
              {curvePlayback ? <Pause size={14} /> : <Play size={14} />}
              {curvePlayback ? '停止' : '沿曲线播放'}
            </button>
          </div>
        )}
      </div>

      {!chartCollapsed && (
        <>
          <div className="chart-series-toggles" onClick={(e) => e.stopPropagation()}>
            <span className="chart-series-toggles-label">
              曲线（能量 µJ；Φ 为 µW）
            </span>
            <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.awa}>
              <input type="checkbox" checked={curves.awa} onChange={(e) => patch('awa', e.target.checked)} />
              <span className="swatch se-awa" /> A_wa
            </label>
            <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.abase}>
              <input type="checkbox" checked={curves.abase} onChange={(e) => patch('abase', e.target.checked)} />
              <span className="swatch se-base" /> A_base
            </label>
            <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.deltaESigma}>
              <input type="checkbox" checked={curves.dE} onChange={(e) => patch('dE', e.target.checked)} />
              <span className="swatch se-de" /> ΔE_σ
            </label>
            <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.ek}>
              <input type="checkbox" checked={curves.ek} onChange={(e) => patch('ek', e.target.checked)} />
              <span className="swatch se-ek" /> E_k
            </label>
            <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.emech}>
              <input type="checkbox" checked={curves.emech} onChange={(e) => patch('emech', e.target.checked)} />
              <span className="swatch se-emech" /> E_mech
            </label>
            <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.wdiss}>
              <input type="checkbox" checked={curves.wdiss} onChange={(e) => patch('wdiss', e.target.checked)} />
              <span className="swatch se-wdiss" /> W_diss
            </label>
            <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.etotal}>
              <input type="checkbox" checked={curves.etotal} onChange={(e) => patch('etotal', e.target.checked)} />
              <span className="swatch se-etotal" /> E_total
            </label>
            <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.phi}>
              <input type="checkbox" checked={curves.phi} onChange={(e) => patch('phi', e.target.checked)} />
              <span className="swatch se-phi" /> Φ
            </label>
          </div>
          <p className="chart-footnote">
            参考态 E_0 = π D₀² γ_wa；ΔE_σ = γ_wa A_wa + (γ_bw − γ_ba) A_base − E_0；E_mech = E_k +
            ΔE_σ，本应用对 <strong>E_mech 曲线</strong>强制单调不增（相对前一有效点不可回升，可平台）；<strong>W_diss</strong> 为<strong>原始</strong> max(0,
            E_mech(0)−(E_k+ΔE_σ))，与 <strong>E_total</strong>=E_k+ΔE_σ+W_diss 能量闭合。若原始序列反弹，多为轮廓帧间突变导致速度差分放大出虚假 E_k。
            <strong>Φ</strong>：先对<strong>原始</strong> W_diss 差分得 raw Φ，再仅对 Φ 做 MA/SG（侧栏可选模式与窗宽），最后 <strong>max(0,·)</strong>。勾选 <strong>E_total</strong> 可画
            E_k+ΔE_σ+W_diss（校验）；图中灰色虚线为 E_mech(0) 参考。E_mech(0) 优先首帧、无效时顺延至首个有效帧。开发模式下控制台会打印耗散闭合探针（前 10 帧）。V、Z_cm 在 Tooltip 与导出中给出；体积由 Moore 母线绕<strong>铺展脚中轴</strong>{' '}
            (subL+subR)/2 旋转积分，与侧栏像素比例（px/mm）一致，避免仅用轮廓 xmin/xmax 中点导致轴偏、V
            偏大。<span style={{ color: '#f87171' }}>红点</span>
            表示该帧 Moore 外轮廓未在本帧成功提取（点数不足或失败）；无效帧若沿用上一帧轮廓，仍按本帧提取结果标红。点击曲线或「沿曲线播放」将跳到对应帧并自动开启「铺展测量」。
          </p>
          <div className="chart-wrap">
            {!anyCurve || chartData.length === 0 ? (
              <div className="chart-empty-hint">
                {chartData.length === 0
                  ? '需要完成空间标定（Surface Y、像素比例）且有分析数据；轮廓不足时部分量为空。'
                  : '请至少勾选一条曲线'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{
                    top: 5,
                    right: showEjEnergyAxis && showPhiAxis ? 62 : 14,
                    left: 0,
                    bottom: 5,
                  }}
                  style={{ cursor: onAnalysisIndexClick ? 'pointer' : 'default' }}
                  onClick={onAnalysisIndexClick ? handleChartClick : undefined}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" type="number" domain={[0, 'auto']} tickFormatter={(v) => `${v}ms`} />
                  {(curves.awa || curves.abase) && (
                    <YAxis
                      yAxisId="area"
                      domain={['auto', 'auto']}
                      tickFormatter={(v) => v.toFixed(1)}
                      width={44}
                    />
                  )}
                  {showEjEnergyAxis && (
                    <YAxis
                      yAxisId="ej"
                      orientation="right"
                      domain={['auto', 'auto']}
                      tickFormatter={(v) => v.toFixed(2)}
                      width={48}
                    />
                  )}
                  {showPhiAxis && (
                    <YAxis
                      yAxisId="phi"
                      orientation="right"
                      domain={['auto', 'auto']}
                      tickFormatter={(v) => v.toFixed(2)}
                      width={44}
                      offset={showEjEnergyAxis ? 48 : 0}
                      label={{ value: 'µW', angle: -90, position: 'insideRight', offset: 10 }}
                    />
                  )}
                  <Tooltip content={<CustomTooltip />} />
                  {curves.etotal &&
                    emech0RefMicroJ != null &&
                    Number.isFinite(emech0RefMicroJ) &&
                    showEjEnergyAxis && (
                      <ReferenceLine
                        yAxisId="ej"
                        y={emech0RefMicroJ}
                        stroke="#64748b"
                        strokeDasharray="6 5"
                        strokeOpacity={0.75}
                        strokeWidth={1.5}
                        label={{
                          value: 'E_mech(0)',
                          position: 'insideTopRight',
                          fill: '#94a3b8',
                          fontSize: 11,
                        }}
                      />
                    )}
                  {playbackTimeX != null && Number.isFinite(playbackTimeX) && (
                    <ReferenceLine
                      x={playbackTimeX}
                      yAxisId={playbackRefAxisId}
                      stroke="#f472b6"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                    />
                  )}
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
                  {curves.awa && (
                    <Line
                      yAxisId="area"
                      type="monotone"
                      dataKey="awaMm2"
                      name="A_wa (mm²)"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={makeDot('#38bdf8', 'awa')}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {curves.abase && (
                    <Line
                      yAxisId="area"
                      type="monotone"
                      dataKey="abaseMm2"
                      name="A_base (mm²)"
                      stroke="#a3e635"
                      strokeWidth={2}
                      dot={makeDot('#a3e635', 'abase')}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {curves.dE && (
                    <Line
                      yAxisId="ej"
                      type="monotone"
                      dataKey="deltaMicroJ"
                      name="ΔE_σ (µJ)"
                      stroke="#f472b6"
                      strokeWidth={2}
                      dot={makeDot('#f472b6', 'dE')}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {curves.ek && (
                    <Line
                      yAxisId="ej"
                      type="monotone"
                      dataKey="ekMicroJ"
                      name="E_k (µJ)"
                      stroke="#fb923c"
                      strokeWidth={2}
                      dot={makeDot('#fb923c', 'ek')}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {curves.emech && (
                    <Line
                      yAxisId="ej"
                      type="monotone"
                      dataKey="emechMicroJ"
                      name="E_mech (µJ)"
                      stroke="#c084fc"
                      strokeWidth={2.5}
                      dot={makeDot('#c084fc', 'emech')}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {curves.wdiss && (
                    <Line
                      yAxisId="ej"
                      type="monotone"
                      dataKey="wdissMicroJ"
                      name="W_diss (µJ)"
                      stroke="#d946ef"
                      strokeWidth={2}
                      dot={makeDot('#d946ef', 'wdiss')}
                      activeDot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                  {curves.etotal && (
                    <Line
                      yAxisId="ej"
                      type="monotone"
                      dataKey="etotalMicroJ"
                      name="E_total = E_k+ΔE_σ+W_diss (µJ)"
                      stroke="#64748b"
                      strokeWidth={2.25}
                      strokeDasharray="4 3"
                      dot={makeDot('#64748b', 'etotal')}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {curves.phi && (
                    <Line
                      yAxisId="phi"
                      type="monotone"
                      dataKey="phiMicroW"
                      name="Φ (µW)"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      dot={makeDot('#fbbf24', 'phi')}
                      activeDot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  )
}
