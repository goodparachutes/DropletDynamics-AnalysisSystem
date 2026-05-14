import { ChevronDown } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
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
import {
  type SurfaceEnergyInstant,
  referenceSphereVolumeMm3,
  VOLUME_CONSERVATION_REL_BAND,
} from '../../features/analysis/surfaceEnergy'
import { CHART_METRIC_TOOLTIPS } from './chartSeriesMetricTooltips'

type ChartRow = {
  analysisIndex: number
  time: number
  /** 瞬时体积 mm³（母线积分） */
  volumeMm3: number | null
  volNorm: number | null
  inBand: boolean | null
}

function parseTooltipDataIndex(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v !== '') {
    const n = Number.parseInt(v, 10)
    if (!Number.isNaN(n)) return n
  }
  return null
}

function resolveClickIndex(eventData: unknown, rows: ChartRow[]): number | null {
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

function HitDot(props: {
  cx?: number
  cy?: number
  payload?: ChartRow
  onPick: (analysisIndex: number) => void
}) {
  const { cx, cy, payload, onPick } = props
  if (!payload || typeof cx !== 'number' || typeof cy !== 'number') return null
  const idx = payload.analysisIndex
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation()
        onPick(idx)
      }}
    >
      <circle cx={cx} cy={cy} r={14} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={3.2}
        fill={payload.inBand === false ? '#f97316' : '#34d399'}
        stroke="rgba(15,23,42,0.45)"
        strokeWidth={1}
      />
    </g>
  )
}

function CustomTooltip({
  active,
  payload,
  label,
  v0Mm3,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartRow }>
  label?: number
  v0Mm3: number | null
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const vn = row.volNorm
  const vMm = row.volumeMm3
  return (
    <div className="tooltip">
      <div>相对时间: {label} ms</div>
      {vMm != null && Number.isFinite(vMm) && <div>V（mm³）: {vMm.toFixed(5)}</div>}
      {v0Mm3 != null && <div>V₀ = π D₀³/6: {v0Mm3.toFixed(5)} mm³</div>}
      {vn != null && Number.isFinite(vn) ? (
        <>
          <div>V/V₀: {vn.toFixed(4)}</div>
          <div style={{ color: Math.abs(vn - 1) <= VOLUME_CONSERVATION_REL_BAND ? '#6ee7b7' : '#fb923c' }}>
            {Math.abs(vn - 1) <= VOLUME_CONSERVATION_REL_BAND
              ? `在 ±${(100 * VOLUME_CONSERVATION_REL_BAND).toFixed(0)}% 带内`
              : `超出 ±${(100 * VOLUME_CONSERVATION_REL_BAND).toFixed(0)}%（轮廓/倒影/积分异常候选）`}
          </div>
        </>
      ) : (
        <div style={{ color: '#94a3b8' }}>该帧无体积（轮廓母线不足）</div>
      )}
    </div>
  )
}

interface VolumeConservationChartProps {
  data: SurfaceEnergyInstant[]
  d0Mm: number
  onAnalysisIndexClick?: (analysisIndex: number) => void
}

export function VolumeConservationChart({ data, d0Mm, onAnalysisIndexClick }: VolumeConservationChartProps) {
  const [showChart, setShowChart] = useState(true)

  const v0Mm3 = useMemo(() => referenceSphereVolumeMm3(d0Mm), [d0Mm])

  const chartData = useMemo<ChartRow[]>(() => {
    if (v0Mm3 == null || v0Mm3 <= 0) return []
    return data.map((d, analysisIndex) => {
      const v = d.volumeMm3
      const volNorm = v != null && Number.isFinite(v) ? v / v0Mm3 : null
      const inBand =
        volNorm != null && Number.isFinite(volNorm)
          ? Math.abs(volNorm - 1) <= VOLUME_CONSERVATION_REL_BAND
          : null
      return {
        analysisIndex,
        time: d.timeMs,
        volumeMm3: v != null && Number.isFinite(v) ? v : null,
        volNorm,
        inBand,
      }
    })
  }, [data, v0Mm3])

  const stats = useMemo(() => {
    const vals = chartData.filter((r) => r.volNorm != null && Number.isFinite(r.volNorm))
    const total = vals.length
    const inBand = vals.filter((r) => r.inBand === true).length
    const outBand = vals.filter((r) => r.inBand === false).length
    return { total, inBand, outBand }
  }, [chartData])

  const yDomain = useMemo((): [number, number] => {
    const nums = chartData.map((r) => r.volNorm).filter((x): x is number => x != null && Number.isFinite(x))
    if (nums.length === 0) return [0.92, 1.08]
    let lo = Math.min(...nums, 1)
    let hi = Math.max(...nums, 1)
    const span = hi - lo
    const pad = Math.max(0.06, span * 0.35, VOLUME_CONSERVATION_REL_BAND * 2)
    return [lo - pad, hi + pad]
  }, [chartData])

  const handleChartClick = useCallback(
    (nextState: unknown, _event?: unknown) => {
      if (!onAnalysisIndexClick) return
      const idx = resolveClickIndex(nextState, chartData)
      if (idx != null) onAnalysisIndexClick(idx)
    },
    [chartData, onAnalysisIndexClick],
  )

  const mkDot = useCallback(
    (stroke: string) => {
      if (!onAnalysisIndexClick) return { r: 2.6, strokeWidth: 1, fill: stroke }
      return (dotProps: { cx?: number; cy?: number; payload?: ChartRow }) => (
        <HitDot cx={dotProps.cx} cy={dotProps.cy} payload={dotProps.payload} onPick={onAnalysisIndexClick} />
      )
    },
    [onAnalysisIndexClick],
  )

  return (
    <div className="panel chart-panel">
      <div className="chart-header chart-header-with-collapse">
        <button
          type="button"
          className="chart-collapse-toggle"
          aria-expanded={showChart}
          aria-label={showChart ? '收起体积守恒图' : '展开体积守恒图'}
          title={showChart ? '收起' : '展开'}
          onClick={(e) => {
            e.stopPropagation()
            setShowChart((c) => !c)
          }}
        >
          <ChevronDown
            size={18}
            className={`chart-collapse-chevron ${showChart ? '' : 'chart-collapse-chevron-folded'}`}
          />
        </button>
        <div className="panel-title chart-metric-title-tooltip" title={CHART_METRIC_TOOLTIPS.volNorm}>
          体积守恒 — V 与 V/V₀
        </div>
      </div>
      {v0Mm3 == null ? (
        <p className="chart-footnote">请设置有效的标定直径 D₀（mm）以计算 V₀ = π D₀³/6。</p>
      ) : (
        <>
          <p className="chart-footnote">
            由子午面积分得到的 V(t) 相对参考球体积 V₀ 归一化；V 与侧栏像素比例（px/mm）一致，对称轴取铺展脚中点。不可压缩下期望曲线钉在 1.0 附近；
            |V/V₀ − 1| ≤ {100 * VOLUME_CONSERVATION_REL_BAND}% 视为 QC 通过。尖峰/深谷多来自倒影误入轮廓或该帧提取失败。
          </p>
          <div className="vol-cons-stats">
            <span>
              有效体积点数: {stats.total} / {chartData.length}
            </span>
            <span className="vol-cons-stats-ok">带内: {stats.inBand}</span>
            <span className="vol-cons-stats-bad">带外: {stats.outBand}</span>
          </div>
          {showChart && (
            <div className="chart-wrap chart-wrap-vol-cons">
              {chartData.length === 0 ? (
                <div className="chart-empty-hint">暂无表面能序列</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 8, right: 14, left: 4, bottom: 6 }}
                    style={{ cursor: onAnalysisIndexClick ? 'pointer' : 'default' }}
                    onClick={onAnalysisIndexClick ? handleChartClick : undefined}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="time" type="number" domain={[0, 'auto']} tickFormatter={(v) => `${v}ms`} />
                    <YAxis
                      yAxisId="vnorm"
                      domain={yDomain}
                      tickFormatter={(v) => v.toFixed(3)}
                      width={56}
                      label={{
                        value: 'V / V₀',
                        angle: -90,
                        position: 'insideLeft',
                        fill: '#94a3b8',
                        fontSize: 11,
                        dy: 14,
                      }}
                    />
                    <Tooltip content={<CustomTooltip v0Mm3={v0Mm3} />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 2 }}
                      formatter={(value) => (
                        <span className="vol-cons-legend-label" title={CHART_METRIC_TOOLTIPS.volNorm}>
                          {value}
                        </span>
                      )}
                    />
                    <ReferenceLine
                      yAxisId="vnorm"
                      y={1}
                      stroke="#94a3b8"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      label={{ value: '1.0', fill: '#94a3b8', fontSize: 11 }}
                    />
                    <ReferenceLine
                      yAxisId="vnorm"
                      y={1 - VOLUME_CONSERVATION_REL_BAND}
                      stroke="#475569"
                      strokeDasharray="6 5"
                      strokeOpacity={0.85}
                    />
                    <ReferenceLine
                      yAxisId="vnorm"
                      y={1 + VOLUME_CONSERVATION_REL_BAND}
                      stroke="#475569"
                      strokeDasharray="6 5"
                      strokeOpacity={0.85}
                    />
                    <Line
                      yAxisId="vnorm"
                      type="monotone"
                      dataKey="volNorm"
                      name="V/V₀（体积比）"
                      stroke="#2dd4bf"
                      strokeWidth={2.2}
                      dot={mkDot('#2dd4bf')}
                      activeDot={onAnalysisIndexClick ? false : { r: 5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
