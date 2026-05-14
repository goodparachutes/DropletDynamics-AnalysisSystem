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
import type { AnalysisPoint } from '../../types/analysis'
import { enrichWithContactLineKinematics } from '../../features/analysis/contactLineKinematics'
import { CHART_METRIC_TOOLTIPS } from './chartSeriesMetricTooltips'
import { CURVE_PLAYBACK_STEP_MS } from './curvePlaybackMs'

/** Recharts 折线对 null 断点更可靠 */
type ChartRow = Omit<
  AnalysisPoint,
  'contactAngleLeftDeg' | 'contactAngleRightDeg' | 'contactAngleAvgDeg'
> & {
  contactAngleLeftDeg: number | null
  contactAngleRightDeg: number | null
  contactAngleAvgDeg: number | null
  contactLineVelocityMmS: number | null
  contactLineAccelMmS2: number | null
}

export type ChartPointClickMeta = { source: 'beta' | 'thetaLeft' | 'thetaRight' | 'thetaAvg' }

interface BetaChartProps {
  data: AnalysisPoint[]
  /** 接触时间 ms：β 首次≈0 到铺展后再次≈0；未弹起为 null */
  contactTimeMs: number | null
  onPointClick: (point: AnalysisPoint, meta?: ChartPointClickMeta) => void
  onRefitJumps?: () => void
  isRefitting?: boolean
  /** 接触角序列：邻帧平滑 + 左右对称修正 */
  onRefineContactAngles?: () => void
  /** 曲线播放：按分析点索引顺序逐步调用，用于同步视频时间与选中帧标注 */
  onCurvePlaybackStep?: (index: number) => void
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
function resolveClickedPoint(eventData: unknown, data: AnalysisPoint[]): AnalysisPoint | null {
  if (!eventData || typeof eventData !== 'object') return null
  const raw = eventData as {
    activePayload?: Array<{ payload?: AnalysisPoint }>
    activeTooltipIndex?: unknown
    activeIndex?: unknown
  }

  const fromPayload = raw.activePayload?.[0]?.payload
  if (fromPayload) return fromPayload

  const idx =
    parseTooltipDataIndex(raw.activeTooltipIndex) ?? parseTooltipDataIndex(raw.activeIndex)
  if (idx != null && idx >= 0 && idx < data.length) return data[idx]

  return null
}

interface ClickableDotProps {
  cx?: number
  cy?: number
  payload?: AnalysisPoint
  onPointClick: (point: AnalysisPoint, meta?: ChartPointClickMeta) => void
  /** 全序列 β 最大时的相对时间与 β 值（首个峰值）；在该点横坐标绘五角星 */
  maxBetaMark?: { time: number; beta: number } | null
}

/** 正五角星路径（尖角朝上），outerR / innerR 为外顶点半径与内凹点半径 */
function pentagonStarPathD(cx: number, cy: number, outerR: number, innerR: number): string {
  const seg: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    seg.push(i === 0 ? `M${x},${y}` : `L${x},${y}`)
  }
  seg.push('Z')
  return seg.join(' ')
}

function ClickableBetaDot(props: ClickableDotProps) {
  const { cx, cy, payload, onPointClick, maxBetaMark } = props
  if (!payload || typeof cx !== 'number' || typeof cy !== 'number') return null
  const isInvalid = Boolean(payload.isInvalid)
  const dotFill = isInvalid ? '#ef4444' : '#60a5fa'
  const dotStroke = isInvalid ? '#fecaca' : '#bfdbfe'
  const isMaxBeta =
    maxBetaMark != null &&
    payload.time === maxBetaMark.time &&
    Math.abs(payload.beta - maxBetaMark.beta) < 1e-8

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(event) => {
        event.stopPropagation()
        onPointClick(payload, { source: 'beta' })
      }}
    >
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      {isMaxBeta ? (
        <path
          d={pentagonStarPathD(cx, cy, 6.8, 2.7)}
          fill="#fbbf24"
          stroke="#92400e"
          strokeWidth={1.15}
          pointerEvents="none"
        />
      ) : (
        <circle cx={cx} cy={cy} r={2.8} fill={dotFill} stroke={dotStroke} strokeWidth={1.2} />
      )}
    </g>
  )
}

function ClickableThetaDot(props: {
  cx?: number
  cy?: number
  payload?: AnalysisPoint
  side: 'thetaLeft' | 'thetaRight' | 'thetaAvg'
  onPointClick: (point: AnalysisPoint, meta?: ChartPointClickMeta) => void
}) {
  const { cx, cy, payload, side, onPointClick } = props
  if (!payload || typeof cx !== 'number' || typeof cy !== 'number') return null
  const val =
    side === 'thetaLeft'
      ? payload.contactAngleLeftDeg
      : side === 'thetaRight'
        ? payload.contactAngleRightDeg
        : payload.contactAngleAvgDeg
  if (val == null || Number.isNaN(Number(val))) return null
  const fill =
    side === 'thetaLeft' ? '#22c55e' : side === 'thetaRight' ? '#eab308' : '#a855f7'
  const stroke =
    side === 'thetaLeft' ? '#14532d' : side === 'thetaRight' ? '#713f12' : '#581c87'
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(event) => {
        event.stopPropagation()
        onPointClick(payload, { source: side })
      }}
    >
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
      <circle cx={cx} cy={cy} r={3.2} fill={fill} stroke={stroke} strokeWidth={1.2} />
    </g>
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
  if (!row || Number.isNaN(row.beta)) return null
  return (
    <div className="tooltip">
      <div>相对时间: {label} ms</div>
      <div>铺展系数 β: {row.beta.toFixed(4)}</div>
      <div>绝对直径 D: {row.absDiameter.toFixed(3)} mm</div>
      {row.contactAngleLeftDeg != null && (
        <div>θ 左: {row.contactAngleLeftDeg.toFixed(2)}°</div>
      )}
      {row.contactAngleRightDeg != null && (
        <div>θ 右: {row.contactAngleRightDeg.toFixed(2)}°</div>
      )}
      {row.contactAngleAvgDeg != null && (
        <div>θavr: {row.contactAngleAvgDeg.toFixed(2)}°</div>
      )}
      {row.contactLineVelocityMmS != null && (
        <div>
          接触线速度 v: {row.contactLineVelocityMmS.toFixed(3)} mm/s{' '}
          <span style={{ color: '#64748b', fontSize: 10 }}>(½·dD/dt)</span>
        </div>
      )}
      {row.contactLineAccelMmS2 != null && (
        <div>接触线加速度 a: {row.contactLineAccelMmS2.toFixed(3)} mm/s²</div>
      )}
      {row.outerContourPx != null && row.outerContourPx.length > 0 && (
        <div style={{ color: '#67e8f9', marginTop: 4 }}>
          外轮廓（Moore）: {row.outerContourPx.length} 点 · 闭合链
        </div>
      )}
    </div>
  )
}

type CurveVisibility = {
  beta: boolean
  thetaL: boolean
  thetaR: boolean
  thetaAvg: boolean
  vel: boolean
  acc: boolean
}

export function BetaChart({
  data,
  contactTimeMs,
  onPointClick,
  onRefitJumps,
  isRefitting,
  onRefineContactAngles,
  onCurvePlaybackStep,
}: BetaChartProps) {
  const [curvePlayback, setCurvePlayback] = useState(false)
  const [playbackTimeX, setPlaybackTimeX] = useState<number | null>(null)
  const [chartCollapsed, setChartCollapsed] = useState(false)
  const dataRef = useRef(data)
  dataRef.current = data

  const handlePointClick = useCallback(
    (point: AnalysisPoint, meta?: ChartPointClickMeta) => {
      setCurvePlayback(false)
      setPlaybackTimeX(null)
      onPointClick(point, meta)
    },
    [onPointClick],
  )

  useEffect(() => {
    const series = dataRef.current
    if (!curvePlayback || series.length === 0 || !onCurvePlaybackStep) {
      setPlaybackTimeX(null)
      if (series.length === 0 && curvePlayback) setCurvePlayback(false)
      return undefined
    }
    let idx = 0
    const len = series.length
    onCurvePlaybackStep(idx)
    setPlaybackTimeX(series[idx]?.time ?? null)
    const id = window.setInterval(() => {
      idx += 1
      if (idx >= len) {
        setCurvePlayback(false)
        setPlaybackTimeX(null)
        return
      }
      const row = dataRef.current[idx]
      onCurvePlaybackStep(idx)
      setPlaybackTimeX(row?.time ?? null)
    }, CURVE_PLAYBACK_STEP_MS)
    return () => clearInterval(id)
  }, [curvePlayback, data.length, onCurvePlaybackStep])

  const [curves, setCurves] = useState<CurveVisibility>({
    beta: true,
    thetaL: true,
    thetaR: true,
    thetaAvg: true,
    vel: true,
    acc: true,
  })
  const showBeta = curves.beta
  const showThetaLeft = curves.thetaL
  const showThetaRight = curves.thetaR
  const showThetaAvg = curves.thetaAvg
  const showVel = curves.vel
  const showAcc = curves.acc
  const anyCurve =
    showBeta || showThetaLeft || showThetaRight || showThetaAvg || showVel || showAcc

  const noTheta = !showThetaLeft && !showThetaRight && !showThetaAvg
  /** 左侧未被 β 占用时显示 v 轴；与 θ 同图时 v 在左、θ 在右 */
  const velAxisVisible = showVel && !showBeta
  /** 右侧未被 θ 占用时才显示 a 的刻度（否则 scale 仍独立，仅无刻度） */
  const accAxisVisible = showAcc && !showBeta && noTheta
  const playbackRefAxisId = showBeta
    ? 'beta'
    : showThetaLeft || showThetaRight || showThetaAvg
      ? 'theta'
      : showVel
        ? 'vel'
        : 'acc'

  const patchCurve = useCallback((key: keyof CurveVisibility, v: boolean) => {
    setCurves((prev) => {
      const next = { ...prev, [key]: v }
      if (!next.beta && !next.thetaL && !next.thetaR && !next.thetaAvg && !next.vel && !next.acc)
        return prev
      return next
    })
  }, [])

  const chartData = useMemo<ChartRow[]>(() => {
    const kin = enrichWithContactLineKinematics(data)
    return kin.map((d) => ({
      ...d,
      contactAngleLeftDeg: d.contactAngleLeftDeg ?? null,
      contactAngleRightDeg: d.contactAngleRightDeg ?? null,
      contactAngleAvgDeg: d.contactAngleAvgDeg ?? null,
      contactLineVelocityMmS: d.contactLineVelocityMmS,
      contactLineAccelMmS2: d.contactLineAccelMmS2,
    }))
  }, [data])

  /** β 全局最大处（首个取得最大值的采样点），用于 X 轴位置五角星 */
  const maxBetaMark = useMemo(() => {
    if (!chartData.length) return null
    let bestI = -1
    let bestB = -Infinity
    for (let i = 0; i < chartData.length; i++) {
      const b = chartData[i].beta
      if (typeof b === 'number' && Number.isFinite(b) && b > bestB) {
        bestB = b
        bestI = i
      }
    }
    if (bestI < 0 || !Number.isFinite(bestB)) return null
    const row = chartData[bestI]
    return { time: row.time, beta: row.beta }
  }, [chartData])

  const thetaLeftCount = useMemo(
    () => chartData.filter((d) => d.contactAngleLeftDeg != null).length,
    [chartData],
  )
  const thetaRightCount = useMemo(
    () => chartData.filter((d) => d.contactAngleRightDeg != null).length,
    [chartData],
  )
  const thetaAvgCount = useMemo(
    () => chartData.filter((d) => d.contactAngleAvgDeg != null).length,
    [chartData],
  )

  const handleChartBackgroundClick = useCallback(
    (nextState: unknown, _event?: unknown) => {
      const point = resolveClickedPoint(nextState, chartData as AnalysisPoint[])
      if (point) handlePointClick(point, { source: 'beta' })
    },
    [chartData, handlePointClick],
  )

  return (
    <div className={`panel chart-panel ${chartCollapsed ? 'chart-panel-collapsed' : ''}`}>
      <div className="chart-header chart-header-with-collapse">
        <button
          type="button"
          className="chart-collapse-toggle"
          aria-expanded={!chartCollapsed}
          aria-label={chartCollapsed ? '展开接触线动力学面板' : '收起接触线动力学面板'}
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
        <div className="panel-title">接触线动力学</div>
        <div className="chart-actions">
          <div className="panel-subtitle chart-metrics">
            <span title={maxBetaMark != null ? `Max β 时刻（图中★）: ${maxBetaMark.time.toFixed(3)} ms` : undefined}>
              Max β: {data.length > 0 ? Math.max(...data.map((d) => d.beta)).toFixed(4) : '0.0000'}
              {maxBetaMark != null && (
                <span style={{ marginLeft: 6, color: '#fbbf24' }} aria-hidden>
                  ★ {maxBetaMark.time.toFixed(0)}ms
                </span>
              )}
            </span>
            <span className="contact-time-label">
              接触时间:{' '}
              {contactTimeMs !== null
                ? `${contactTimeMs} ms`
                : data.length >= 3
                  ? '—（未检测到弹起）'
                  : '—'}
            </span>
            <span className="contact-time-label">
              θ 点数: 左 {thetaLeftCount} / 右 {thetaRightCount} / θavr {thetaAvgCount}
              {data.length > 0 && thetaLeftCount === 0 && thetaRightCount === 0
                ? '（无轮廓回归数据，请重跑分析或换 Legacy）'
                : ''}
            </span>
          </div>
          <div className="chart-action-btns">
            {onCurvePlaybackStep && (
              <button
                type="button"
                className={`algo-btn ${curvePlayback ? 'active' : ''}`}
                disabled={data.length === 0}
                title={`按分析序列逐点跳转视频并保留选中帧标注（约 ${CURVE_PLAYBACK_STEP_MS} ms/点）`}
                onClick={() => setCurvePlayback((p) => !p)}
              >
                {curvePlayback ? <Pause size={14} /> : <Play size={14} />}
                {curvePlayback ? '停止' : '沿曲线播放'}
              </button>
            )}
            {onRefitJumps && (
              <button className="algo-btn" onClick={onRefitJumps} disabled={Boolean(isRefitting) || data.length < 3}>
                {isRefitting ? '修正中...' : 'β 拟合修正'}
              </button>
            )}
            {onRefineContactAngles && (
              <button
                type="button"
                className="algo-btn"
                title="按邻帧与左右对称约束平滑 θ（不改 β 与轮廓）"
                onClick={onRefineContactAngles}
                disabled={
                  Boolean(isRefitting) ||
                  data.length < 3 ||
                  (thetaLeftCount === 0 && thetaRightCount === 0 && thetaAvgCount === 0)
                }
              >
                接触角修正
              </button>
            )}
          </div>
        </div>
      </div>

      {!chartCollapsed && (
        <>
      <div className="chart-series-toggles" onClick={(e) => e.stopPropagation()}>
        <span className="chart-series-toggles-label">曲线显示（勾选为显示）</span>
        <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.beta}>
          <input type="checkbox" checked={showBeta} onChange={(e) => patchCurve('beta', e.target.checked)} />
          <span className="swatch beta" /> β
        </label>
        <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.thetaLeft}>
          <input type="checkbox" checked={showThetaLeft} onChange={(e) => patchCurve('thetaL', e.target.checked)} />
          <span className="swatch theta-l" /> θ左
        </label>
        <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.thetaRight}>
          <input type="checkbox" checked={showThetaRight} onChange={(e) => patchCurve('thetaR', e.target.checked)} />
          <span className="swatch theta-r" /> θ右
        </label>
        <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.thetaAvg}>
          <input type="checkbox" checked={showThetaAvg} onChange={(e) => patchCurve('thetaAvg', e.target.checked)} />
          <span className="swatch theta-avg" /> θavr
        </label>
        <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.contactLineVelocity}>
          <input type="checkbox" checked={showVel} onChange={(e) => patchCurve('vel', e.target.checked)} />
          <span className="swatch kin-v" /> v (mm/s)
        </label>
        <label className="chart-series-toggle" title={CHART_METRIC_TOOLTIPS.contactLineAccel}>
          <input type="checkbox" checked={showAcc} onChange={(e) => patchCurve('acc', e.target.checked)} />
          <span className="swatch kin-a" /> a (mm/s²)
        </label>
      </div>

      <p className="chart-footnote">
        直径 D 对应铺展位移；单侧接触线速度 v = ½·dD/dt、加速度 a = dv/dt（时间轴为相对时间 ms）。「沿曲线播放」便于逐帧核对；θ 依赖轮廓回归。
      </p>
      <div className="chart-wrap">
        {!anyCurve || chartData.length === 0 ? (
          <div className="chart-empty-hint">{chartData.length === 0 ? '暂无分析数据' : '请至少勾选一条曲线'}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 5, right: 16, left: 0, bottom: 5 }}
              style={{ cursor: 'pointer' }}
              onClick={handleChartBackgroundClick}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" type="number" domain={[0, 'auto']} tickFormatter={(v) => `${v}ms`} />
              {showBeta && (
                <YAxis
                  yAxisId="beta"
                  domain={[0, 'auto']}
                  tickFormatter={(v) => v.toFixed(2)}
                  width={44}
                />
              )}
              {(showThetaLeft || showThetaRight || showThetaAvg) && (
                <YAxis
                  yAxisId="theta"
                  orientation="right"
                  domain={[0, 180]}
                  tickFormatter={(v) => `${v}°`}
                  width={40}
                />
              )}
              {showVel && (
                <YAxis
                  yAxisId="vel"
                  orientation="left"
                  hide={!velAxisVisible}
                  domain={['auto', 'auto']}
                  width={velAxisVisible ? 42 : 0}
                  tickFormatter={(v) => v.toFixed(1)}
                />
              )}
              {showAcc && (
                <YAxis
                  yAxisId="acc"
                  orientation="right"
                  hide={!accAxisVisible}
                  domain={['auto', 'auto']}
                  width={accAxisVisible ? 42 : 0}
                  tickFormatter={(v) => v.toFixed(0)}
                />
              )}
              <Tooltip content={<CustomTooltip />} />
              {playbackTimeX != null && Number.isFinite(playbackTimeX) && (
                <ReferenceLine
                  x={playbackTimeX}
                  yAxisId={playbackRefAxisId}
                  stroke="#f472b6"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              )}
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                formatter={(value) => <span style={{ color: '#64748b' }}>{value}</span>}
              />
              {showBeta && (
                <Line
                  yAxisId="beta"
                  type="monotone"
                  dataKey="beta"
                  name="β"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={(props) => (
                    <ClickableBetaDot
                      cx={props.cx}
                      cy={props.cy}
                      payload={props.payload as AnalysisPoint | undefined}
                      maxBetaMark={maxBetaMark}
                      onPointClick={handlePointClick}
                    />
                  )}
                  activeDot={(props) => (
                    <ClickableBetaDot
                      cx={props.cx}
                      cy={props.cy}
                      payload={props.payload as AnalysisPoint | undefined}
                      maxBetaMark={maxBetaMark}
                      onPointClick={handlePointClick}
                    />
                  )}
                  isAnimationActive={false}
                />
              )}
              {showThetaLeft && (
                <Line
                  yAxisId="theta"
                  type="monotone"
                  dataKey="contactAngleLeftDeg"
                  name="θ左"
                  stroke="#22c55e"
                  strokeWidth={2.4}
                  connectNulls
                  dot={(props) => (
                    <ClickableThetaDot
                      cx={props.cx}
                      cy={props.cy}
                      payload={props.payload as AnalysisPoint | undefined}
                      side="thetaLeft"
                      onPointClick={handlePointClick}
                    />
                  )}
                  activeDot={false}
                  isAnimationActive={false}
                />
              )}
              {showThetaRight && (
                <Line
                  yAxisId="theta"
                  type="monotone"
                  dataKey="contactAngleRightDeg"
                  name="θ右"
                  stroke="#eab308"
                  strokeWidth={2.4}
                  connectNulls
                  dot={(props) => (
                    <ClickableThetaDot
                      cx={props.cx}
                      cy={props.cy}
                      payload={props.payload as AnalysisPoint | undefined}
                      side="thetaRight"
                      onPointClick={handlePointClick}
                    />
                  )}
                  activeDot={false}
                  isAnimationActive={false}
                />
              )}
              {showThetaAvg && (
                <Line
                  yAxisId="theta"
                  type="monotone"
                  dataKey="contactAngleAvgDeg"
                  name="θavr"
                  stroke="#a855f7"
                  strokeWidth={2.4}
                  connectNulls
                  dot={(props) => (
                    <ClickableThetaDot
                      cx={props.cx}
                      cy={props.cy}
                      payload={props.payload as AnalysisPoint | undefined}
                      side="thetaAvg"
                      onPointClick={handlePointClick}
                    />
                  )}
                  activeDot={false}
                  isAnimationActive={false}
                />
              )}
              {showVel && (
                <Line
                  yAxisId="vel"
                  type="monotone"
                  dataKey="contactLineVelocityMmS"
                  name="v (mm/s)"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}
              {showAcc && (
                <Line
                  yAxisId="acc"
                  type="monotone"
                  dataKey="contactLineAccelMmS2"
                  name="a (mm/s²)"
                  stroke="#fb923c"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
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
