import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { JetDynamicsSessionPersisted } from '../../types/jetDynamics'
import { jetCalibratedTimeMs, jetCalibratedTimeMsDecimalPlaces, jetNominalFrameDeltaMs } from '../../features/jet/jetDynamics'
import { linearLeastSquaresXY } from '../../features/jet/linearLeastSquares'
import { JET_CURVE_METRIC_TOOLTIPS } from '../../features/jet/jetChartMetricTooltips'

type JetCurveKey =
  | 'zTip'
  | 'vJet'
  | 'area'
  | 'vol'
  | 'ar'
  | 'ellipseA'
  | 'ellipseB'
  | 'phiDeg'
  | 'ek'
  | 'eta'
  | 'beta'

const initialCurves: Record<JetCurveKey, boolean> = {
  zTip: true,
  vJet: true,
  area: false,
  vol: false,
  ar: false,
  ellipseA: false,
  ellipseB: false,
  phiDeg: false,
  ek: true,
  eta: false,
  beta: false,
}

type ChartRow = {
  sampleKey: string
  frameIndex: number
  dropId: number
  tCalMs: number
  hitAnchor: number
  zTip: number | null
  vJet: number | null
  area: number
  vol: number
  ar: number
  ellipseAMm: number | null
  ellipseBMm: number | null
  phiDeg: number | null
  ekJ: number | null
  eta: number | null
  beta: number | null
}

function parseTooltipDataIndex(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v !== '') {
    const n = Number.parseInt(v, 10)
    if (!Number.isNaN(n)) return n
  }
  return null
}

function resolveClickedJetRow(eventData: unknown, data: ChartRow[]): ChartRow | null {
  if (!eventData || typeof eventData !== 'object') return null
  const raw = eventData as {
    activePayload?: Array<{ payload?: ChartRow }>
    activeTooltipIndex?: unknown
    activeIndex?: unknown
  }
  const fromPayload = raw.activePayload?.[0]?.payload
  if (fromPayload && typeof fromPayload.frameIndex === 'number') return fromPayload

  const idx =
    parseTooltipDataIndex(raw.activeTooltipIndex) ?? parseTooltipDataIndex(raw.activeIndex)
  if (idx != null && idx >= 0 && idx < data.length) return data[idx]!
  return null
}

function formatTooltipScalar(v: unknown, digits: number): string {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '—'
  if (typeof v !== 'number') return String(v)
  if (Math.abs(v) >= 1e6 || (Math.abs(v) > 0 && Math.abs(v) < 1e-4)) return v.toExponential(Math.max(2, digits - 2))
  return v.toFixed(digits)
}

function hintKeyFromSeriesName(name: string): keyof typeof JET_CURVE_METRIC_TOOLTIPS | null {
  if (name.includes('Z_c') || name.includes('Z_tip')) return 'zTip'
  if (name.includes('V_jet')) return 'vJet'
  if (name.includes('A_drop')) return 'area'
  if (name.includes('Vol')) return 'vol'
  if (name === 'AR' || name.startsWith('AR ')) return 'ar'
  if (name.startsWith('a ')) return 'ellipseA'
  if (name.startsWith('b ')) return 'ellipseB'
  if (name.includes('φ')) return 'phiDeg'
  if (name.includes('E_k')) return 'ek'
  if (name.includes('η')) return 'efficiencyEta'
  if (name.includes('β')) return 'amplificationBeta'
  return null
}

type RechartsTooltipPayload = {
  name?: string
  value?: unknown
  color?: string
  dataKey?: string | number
  payload?: ChartRow
}

function JetChartTooltipContent({
  active,
  label,
  payload,
  timeDecimals,
}: {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<RechartsTooltipPayload>
  timeDecimals: number
}) {
  if (!active || !payload?.length) return null
  const row = (payload[0] as { payload?: ChartRow }).payload
  const fi = row?.frameIndex
  const lines = payload
    .filter((p: RechartsTooltipPayload) => p && p.dataKey !== 'hitAnchor' && String(p.name ?? '').trim() !== '')
    .map((p: RechartsTooltipPayload) => {
      const name = String(p.name ?? p.dataKey ?? '')
      const v = p.value
      const hintKey = hintKeyFromSeriesName(name)
      const hint = hintKey ? JET_CURVE_METRIC_TOOLTIPS[hintKey] : ''
      let text = '—'
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (name.includes('E_k')) text = v.toExponential(4) + ' J'
        else if (name.includes('Vol')) text = v.toFixed(6) + ' mm³'
        else if (name.includes('A_drop')) text = v.toFixed(6) + ' mm²'
        else if (name.includes('V_jet')) text = v.toFixed(4) + ' mm/s'
        else if (name.includes('φ')) text = v.toFixed(3) + ' °'
        else if (name.includes('AR')) text = v.toFixed(4)
        else if (name.includes('Z_c') || name.includes('Z_tip')) text = v.toFixed(6) + ' mm'
        else if (name.includes('a') || name.includes('b')) text = v.toFixed(6) + ' mm'
        else if (name.includes('η')) text = v.toExponential(4)
        else if (name.includes('β')) text = v.toExponential(4)
        else text = String(v)
      }
      return (
        <div key={name} style={{ color: p.color ?? '#e2e8f0', marginTop: 6 }}>
          <div>
            <span style={{ fontWeight: 600 }}>{name}:</span> {text}
          </div>
          {hint ? (
            <div style={{ marginTop: 3, fontSize: 10, lineHeight: 1.35, color: '#94a3b8', fontWeight: 400 }}>
              {hint}
            </div>
          ) : null}
        </div>
      )
    })

  return (
    <div
      className="recharts-default-tooltip"
      style={{
        background: 'rgba(15, 23, 42, 0.96)',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 12,
        maxWidth: 400,
      }}
    >
      {fi != null && <div style={{ marginBottom: 4, color: '#94a3b8' }}>帧 #{fi}</div>}
      <div style={{ marginBottom: 6, color: '#cbd5e1' }}>
        t ={' '}
        {row?.tCalMs != null && Number.isFinite(row.tCalMs)
          ? row.tCalMs.toFixed(timeDecimals)
          : formatTooltipScalar(label, timeDecimals)}{' '}
        ms
      </div>
      {lines}
    </div>
  )
}

function JetChartPickDot(props: {
  cx?: number
  cy?: number
  payload?: ChartRow
  selectedKey: string | null
  onPick: (frameIndex: number, dropId: number) => void
}) {
  const { cx, cy, payload, selectedKey, onPick } = props
  if (!payload || typeof cx !== 'number' || typeof cy !== 'number') return null
  const sel = payload.sampleKey === selectedKey
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation()
        onPick(payload.frameIndex, payload.dropId)
      }}
    >
      <circle cx={cx} cy={cy} r={14} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={sel ? 4.2 : 2.8}
        fill={sel ? 'rgba(56, 189, 248, 0.95)' : 'rgba(148, 163, 184, 0.55)'}
        stroke={sel ? '#e0f2fe' : 'rgba(226, 232, 240, 0.7)'}
        strokeWidth={sel ? 1.6 : 1.1}
      />
    </g>
  )
}

export interface JetDynamicsResultChartProps {
  session: JetDynamicsSessionPersisted
  zeroTimeSec: number
  exportedFps: number
  samplingFps: number
  videoDurationSec: number
  /** 撞击速度分析中的流体密度 kg/m³，用于 E_k 说明与 tooltip */
  fluidDensityKgM3: number
  selectedFrameIndex: number | null
  selectedDropId: number | null
  selectionLoading: boolean
  onSelectSample: (frameIndex: number, dropId: number) => void
  onClearSelection: () => void
}

const AXIS_W = 46

/** 左侧共用轴：除 E_k 外勾选曲线（与 V_jet 同一 y 标度） */
const Y_LEFT = 'jetLeft'
/** 右侧：仅 E_k */
const Y_RIGHT = 'jetRight'

export function JetDynamicsResultChart({
  session,
  zeroTimeSec,
  exportedFps,
  samplingFps,
  videoDurationSec,
  fluidDensityKgM3,
  selectedFrameIndex,
  selectedDropId,
  selectionLoading,
  onSelectSample,
  onClearSelection,
}: JetDynamicsResultChartProps) {
  const tracks = session.dropTracks
  const [selectedId, setSelectedId] = useState<number>(() => tracks[0]?.id ?? 1)
  const [chartCollapsed, setChartCollapsed] = useState(false)
  const [curves, setCurves] = useState(initialCurves)

  const patchCurve = useCallback((key: JetCurveKey, v: boolean) => {
    setCurves((prev) => {
      const next = { ...prev, [key]: v }
      const anyOn = (Object.keys(next) as JetCurveKey[]).some((k) => next[k])
      if (!anyOn) return prev
      return next
    })
  }, [])

  const ids = useMemo(() => tracks.map((t) => t.id).sort((a, b) => a - b), [tracks])

  useEffect(() => {
    if (ids.length === 0) return
    if (!ids.includes(selectedId)) setSelectedId(ids[0]!)
  }, [ids, selectedId])

  const activeTrack = useMemo(() => {
    const id = ids.includes(selectedId) ? selectedId : ids[0]
    return tracks.find((t) => t.id === id) ?? tracks[0] ?? null
  }, [tracks, ids, selectedId])

  const selectedKey =
    selectedFrameIndex != null && selectedDropId != null
      ? `${selectedDropId}-${selectedFrameIndex}`
      : null

  const jetStepMs = useMemo(
    () => jetNominalFrameDeltaMs(exportedFps, samplingFps),
    [exportedFps, samplingFps],
  )
  const jetTimeDecimals = useMemo(() => jetCalibratedTimeMsDecimalPlaces(jetStepMs), [jetStepMs])

  const formatJetXAxisTick = useCallback(
    (v: number | string) => {
      const x = typeof v === 'number' ? v : Number.parseFloat(String(v))
      if (!Number.isFinite(x)) return ''
      const snapped =
        jetStepMs > 0 && Number.isFinite(jetStepMs) ? Math.round(x / jetStepMs) * jetStepMs : x
      return snapped.toFixed(jetTimeDecimals)
    },
    [jetStepMs, jetTimeDecimals],
  )

  const chartData = useMemo<ChartRow[]>(() => {
    if (!activeTrack) return []
    const dur = Number.isFinite(videoDurationSec) && videoDurationSec > 0 ? videoDurationSec : 0
    return activeTrack.samples.map((s) => {
      const phiRad = s.ellipsePhiRad
      const phiDeg =
        phiRad != null && Number.isFinite(phiRad) ? (phiRad * 180) / Math.PI : null
      return {
        sampleKey: `${activeTrack.id}-${s.frameIndex}`,
        frameIndex: s.frameIndex,
        dropId: activeTrack.id,
        tCalMs: jetCalibratedTimeMs(s.frameIndex, exportedFps, samplingFps, zeroTimeSec, dur),
        hitAnchor: 0,
        zTip: s.zTipMm,
        vJet: s.vJetMmPerS,
        area: s.areaDropMm2,
        vol: s.volMm3,
        ar: s.aspectRatio,
        ellipseAMm: s.ellipseSemiMajorMm ?? null,
        ellipseBMm: s.ellipseSemiMinorMm ?? null,
        phiDeg,
        ekJ: s.ekJoule ?? null,
        eta: s.efficiencyEta ?? null,
        beta: s.amplificationBeta ?? null,
      }
    })
  }, [activeTrack, exportedFps, samplingFps, zeroTimeSec, videoDurationSec])

  const zcLinearFit = useMemo(() => {
    if (!chartData.length) return null
    const xs: number[] = []
    const ys: number[] = []
    for (const r of chartData) {
      if (r.zTip != null && Number.isFinite(r.zTip)) {
        xs.push(r.tCalMs)
        ys.push(r.zTip)
      }
    }
    const fit = linearLeastSquaresXY(xs, ys)
    if (!fit) return null
    const slopeMmPerS = fit.slope * 1000
    return { ...fit, slopeMmPerS }
  }, [chartData])

  const showLeftPack =
    curves.zTip ||
    curves.vJet ||
    curves.area ||
    curves.vol ||
    curves.ar ||
    curves.ellipseA ||
    curves.ellipseB ||
    curves.phiDeg ||
    curves.eta ||
    curves.beta
  const showRightEk = curves.ek

  const marginRight = 10 + (showRightEk ? AXIS_W : 0)
  const marginLeft = showLeftPack ? 52 : 12

  const handleChartClick = useCallback(
    (nextState: unknown) => {
      const hit = resolveClickedJetRow(nextState, chartData)
      if (hit) onSelectSample(hit.frameIndex, hit.dropId)
      else onClearSelection()
    },
    [chartData, onClearSelection, onSelectSample],
  )

  const dotRenderer = useCallback(
    (props: Record<string, unknown>) => (
      <JetChartPickDot
        {...props}
        selectedKey={selectedKey}
        onPick={onSelectSample}
      />
    ),
    [selectedKey, onSelectSample],
  )

  if (tracks.length === 0) {
    return (
      <div
        className={`panel chart-panel jet-dynamics-main-chart ${chartCollapsed ? 'chart-panel-collapsed' : ''}`}
      >
        <div className="chart-header chart-header-with-collapse">
          <button
            type="button"
            className="chart-collapse-toggle"
            aria-expanded={!chartCollapsed}
            aria-label={chartCollapsed ? '展开射流动力学图' : '收起射流动力学图'}
            title={chartCollapsed ? '展开' : '收起'}
            onClick={(e) => {
              e.stopPropagation()
              setChartCollapsed((c) => !c)
            }}
          >
            <ChevronDown
              size={18}
              className={`chart-collapse-chevron ${chartCollapsed ? 'chart-collapse-chevron-folded' : ''}`}
            />
          </button>
          <div className="panel-title">射流动力学 — 多参曲线</div>
        </div>
        {!chartCollapsed && (
          <div className="chart-empty-hint">暂无追踪结果；请在侧栏配置帧范围与 ROI 后运行分析。</div>
        )}
      </div>
    )
  }

  return (
    <div className={`panel chart-panel jet-dynamics-main-chart ${chartCollapsed ? 'chart-panel-collapsed' : ''}`}>
      <div className="chart-header chart-header-with-collapse">
        <button
          type="button"
          className="chart-collapse-toggle"
          aria-expanded={!chartCollapsed}
          aria-label={chartCollapsed ? '展开射流动力学图' : '收起射流动力学图'}
          title={chartCollapsed ? '展开' : '收起'}
          onClick={(e) => {
            e.stopPropagation()
            setChartCollapsed((c) => !c)
          }}
        >
          <ChevronDown
            size={18}
            className={`chart-collapse-chevron ${chartCollapsed ? 'chart-collapse-chevron-folded' : ''}`}
          />
        </button>
        <div className="panel-title">射流动力学 — 多参曲线（按液滴 ID）</div>
      </div>
      {!chartCollapsed && (
        <>
          <p className="chart-footnote">
            横轴为<strong>撞击标定</strong> t（ms），按名义帧间隔 Δt 对齐显示（避免比例尺与双精度产生非步进小数）。下方勾选需显示的物理量；将鼠标悬停在<strong>勾选项文字</strong>上可查看各量定义（浏览器原生
            title）。<strong>点击数据点</strong>跳转该帧并叠加轮廓/椭圆（「标注显示」→ 射流轮廓）。纵轴仅左右各一条：左侧为 V_jet 与除 E_k
            外的勾选曲线<strong>共用刻度</strong>（量纲不同，读数以悬停 Tooltip 为准）；右侧仅 E_k。<strong>η、β</strong>在追踪结果中计算，需侧栏 D₀、ρ、σ 及<strong>撞击速度分析</strong>得到的 U₀。E_k 使用当前侧栏流体密度 ρ ={' '}
            {Number.isFinite(fluidDensityKgM3) ? fluidDensityKgM3.toFixed(1) : '—'} kg/m³。
          </p>
          {selectionLoading && (
            <div className="cavity-chart-selection-loading" style={{ margin: '4px 0 8px' }}>
              正在解码并提取射流轮廓…
            </div>
          )}
          <div className="chart-series-toggles jet-dynamics-id-row" onClick={(e) => e.stopPropagation()}>
            <label className="chart-series-toggles-label" htmlFor="jet-drop-select">
              绘制对象
            </label>
            <select
              id="jet-drop-select"
              className="jet-dynamics-id-select"
              value={activeTrack?.id ?? selectedId}
              onChange={(e) => setSelectedId(Number(e.target.value))}
            >
              {ids.map((id) => (
                <option key={id} value={id}>
                  Drop_{id}
                </option>
              ))}
            </select>
          </div>
          {zcLinearFit ? (
            <p className="chart-footnote jet-zc-linear-fit" style={{ marginTop: 6, marginBottom: 0 }}>
              当前液滴：<strong>Z_c</strong> 对 <strong>t</strong>（撞击标定，ms）最小二乘直线 —— 斜率{' '}
              <strong>{zcLinearFit.slopeMmPerS.toFixed(4)} mm/s</strong>（与 <strong>V_jet</strong> 弹道拟合所用斜率一致），截距{' '}
              {zcLinearFit.intercept.toFixed(4)} mm（t = 0 处拟合值），R² = {zcLinearFit.r2.toFixed(4)}，有效点 n ={' '}
              {zcLinearFit.n}。
            </p>
          ) : chartData.length > 1 ? (
            <p className="chart-footnote" style={{ marginTop: 6, marginBottom: 0, color: '#94a3b8' }}>
              Z_c 数据点不足或 t 无方差，无法做直线拟合。
            </p>
          ) : null}
          {chartData.length > 0 && (
            <div
              className="chart-series-toggles bubble-dynamics-curve-toggles jet-dynamics-curve-toggles"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="chart-series-toggles-label">曲线显示（悬停 label 见说明）</span>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.zTip}>
                <input type="checkbox" checked={curves.zTip} onChange={(e) => patchCurve('zTip', e.target.checked)} />
                <span className="swatch jet-z" style={{ background: '#38bdf8' }} /> Z_c
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.vJet}>
                <input type="checkbox" checked={curves.vJet} onChange={(e) => patchCurve('vJet', e.target.checked)} />
                <span className="swatch jet-v" style={{ background: '#a78bfa' }} /> V_jet
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.area}>
                <input type="checkbox" checked={curves.area} onChange={(e) => patchCurve('area', e.target.checked)} />
                <span className="swatch jet-a" style={{ background: '#f472b6' }} /> A_drop
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.vol}>
                <input type="checkbox" checked={curves.vol} onChange={(e) => patchCurve('vol', e.target.checked)} />
                <span className="swatch jet-vo" style={{ background: '#34d399' }} /> Vol
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.ar}>
                <input type="checkbox" checked={curves.ar} onChange={(e) => patchCurve('ar', e.target.checked)} />
                <span className="swatch jet-ar" style={{ background: '#fbbf24' }} /> AR
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.ellipseA}>
                <input
                  type="checkbox"
                  checked={curves.ellipseA}
                  onChange={(e) => patchCurve('ellipseA', e.target.checked)}
                />
                <span className="swatch jet-ea" style={{ background: '#fb923c' }} /> a
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.ellipseB}>
                <input
                  type="checkbox"
                  checked={curves.ellipseB}
                  onChange={(e) => patchCurve('ellipseB', e.target.checked)}
                />
                <span className="swatch jet-eb" style={{ background: '#fdba74' }} /> b
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.phiDeg}>
                <input
                  type="checkbox"
                  checked={curves.phiDeg}
                  onChange={(e) => patchCurve('phiDeg', e.target.checked)}
                />
                <span className="swatch jet-ph" style={{ background: '#94a3b8' }} /> φ
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.ek}>
                <input type="checkbox" checked={curves.ek} onChange={(e) => patchCurve('ek', e.target.checked)} />
                <span className="swatch jet-ek" style={{ background: '#22d3ee' }} /> E_k
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.efficiencyEta}>
                <input type="checkbox" checked={curves.eta} onChange={(e) => patchCurve('eta', e.target.checked)} />
                <span className="swatch jet-eta" style={{ background: '#c084fc' }} /> η
              </label>
              <label className="chart-series-toggle" title={JET_CURVE_METRIC_TOOLTIPS.amplificationBeta}>
                <input type="checkbox" checked={curves.beta} onChange={(e) => patchCurve('beta', e.target.checked)} />
                <span className="swatch jet-beta" style={{ background: '#4ade80' }} /> β
              </label>
            </div>
          )}
          {chartData.length > 0 ? (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: marginRight, left: marginLeft, bottom: 6 }}
                  onClick={handleChartClick}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="tCalMs"
                    type="number"
                    domain={['auto', 'auto']}
                    tickFormatter={formatJetXAxisTick}
                    label={{
                      value: 't (ms, 撞击标定)',
                      position: 'insideBottom',
                      offset: -2,
                      fill: '#94a3b8',
                      fontSize: 11,
                    }}
                  />
                  {showLeftPack ? (
                    <YAxis
                      yAxisId={Y_LEFT}
                      orientation="left"
                      stroke="#a78bfa"
                      width={AXIS_W}
                      tickCount={2}
                      tickFormatter={(v) => {
                        if (!Number.isFinite(v)) return ''
                        const av = Math.abs(v)
                        if (av >= 1e5 || (av > 0 && av < 1e-3)) return v.toExponential(1)
                        if (av >= 100) return v.toFixed(0)
                        if (av >= 1) return v.toFixed(2)
                        return v.toFixed(3)
                      }}
                      label={{
                        value: 'V_jet 等',
                        angle: -90,
                        position: 'insideLeft',
                        fill: '#94a3b8',
                        fontSize: 10,
                        offset: 8,
                      }}
                    />
                  ) : null}
                  {showRightEk ? (
                    <YAxis
                      yAxisId={Y_RIGHT}
                      orientation="right"
                      stroke="#22d3ee"
                      width={AXIS_W}
                      tickCount={2}
                      tickFormatter={(v) => {
                        if (Math.abs(v) < 1e-9) return '0'
                        return v.toExponential(1)
                      }}
                      label={{
                        value: 'E_k',
                        angle: 90,
                        position: 'insideRight',
                        fill: '#94a3b8',
                        fontSize: 10,
                        offset: 8,
                      }}
                    />
                  ) : null}
                  <YAxis yAxisId="hit" domain={[-1, 1]} hide width={0} />
                  <Tooltip
                    content={(tp) => (
                      <JetChartTooltipContent
                        active={tp.active}
                        label={tp.label as string | number | undefined}
                        payload={tp.payload as ReadonlyArray<RechartsTooltipPayload> | undefined}
                        timeDecimals={jetTimeDecimals}
                      />
                    )}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 2 }} />
                  {curves.zTip ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="zTip"
                      name="Z_c mm"
                      stroke="#38bdf8"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.vJet ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="vJet"
                      name="V_jet mm/s"
                      stroke="#a78bfa"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.area ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="area"
                      name="A_drop mm²"
                      stroke="#f472b6"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.vol ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="vol"
                      name="Vol mm³"
                      stroke="#34d399"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.ar ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="ar"
                      name="AR"
                      stroke="#fbbf24"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.ellipseA ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="ellipseAMm"
                      name="a mm"
                      stroke="#fb923c"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.ellipseB ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="ellipseBMm"
                      name="b mm"
                      stroke="#fdba74"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.phiDeg ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="phiDeg"
                      name="φ °"
                      stroke="#94a3b8"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.eta ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="eta"
                      name="η"
                      stroke="#c084fc"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.beta ? (
                    <Line
                      yAxisId={Y_LEFT}
                      type="monotone"
                      dataKey="beta"
                      name="β"
                      stroke="#4ade80"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {curves.ek ? (
                    <Line
                      yAxisId={Y_RIGHT}
                      type="monotone"
                      dataKey="ekJ"
                      name="E_k J"
                      stroke="#22d3ee"
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  <Line
                    yAxisId="hit"
                    type="monotone"
                    dataKey="hitAnchor"
                    name=""
                    stroke="transparent"
                    strokeWidth={0}
                    isAnimationActive={false}
                    dot={dotRenderer}
                    activeDot={false}
                    legendType="none"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="chart-empty-hint">该 ID 无采样点。</div>
          )}
        </>
      )}
    </div>
  )
}
