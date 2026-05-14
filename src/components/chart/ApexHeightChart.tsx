import { useCallback, useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisPoint } from '../../types/analysis'
import { apexHeightAboveBaselineMm } from '../../features/analysis/apexHeightFromContour'

type ApexRow = AnalysisPoint & { apexHeightMm: number | null }

function parseTooltipDataIndex(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v !== '') {
    const n = Number.parseInt(v, 10)
    if (!Number.isNaN(n)) return n
  }
  return null
}

function resolveClickedPoint(eventData: unknown, rows: ApexRow[]): AnalysisPoint | null {
  if (!eventData || typeof eventData !== 'object') return null
  const raw = eventData as {
    activePayload?: Array<{ payload?: ApexRow }>
    activeTooltipIndex?: unknown
    activeIndex?: unknown
  }
  const fromPayload = raw.activePayload?.[0]?.payload
  if (fromPayload) return fromPayload

  const idx =
    parseTooltipDataIndex(raw.activeTooltipIndex) ?? parseTooltipDataIndex(raw.activeIndex)
  if (idx != null && idx >= 0 && idx < rows.length) return rows[idx]
  return null
}

function ApexDot(props: {
  cx?: number
  cy?: number
  payload?: ApexRow
  onPointClick: (point: AnalysisPoint) => void
}) {
  const { cx, cy, payload, onPointClick } = props
  if (!payload || typeof cx !== 'number' || typeof cy !== 'number') return null
  if (payload.apexHeightMm == null || Number.isNaN(payload.apexHeightMm)) return null
  const isInvalid = Boolean(payload.isInvalid)
  const fill = isInvalid ? '#ef4444' : '#2dd4bf'
  const stroke = isInvalid ? '#fecaca' : '#0f766e'
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation()
        onPointClick(payload)
      }}
    >
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
      <circle cx={cx} cy={cy} r={2.8} fill={fill} stroke={stroke} strokeWidth={1.2} />
    </g>
  )
}

function ApexTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ payload: ApexRow }>
  label?: number
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  if (!row) return null
  return (
    <div className="tooltip">
      <div>相对时间: {label} ms</div>
      {row.apexHeightMm != null && Number.isFinite(row.apexHeightMm) ? (
        <div>轮廓最高点相对基准: {row.apexHeightMm.toFixed(3)} mm</div>
      ) : (
        <div style={{ color: '#94a3b8' }}>本帧无 Moore 外轮廓或未标定</div>
      )}
    </div>
  )
}

export interface ApexHeightChartProps {
  data: AnalysisPoint[]
  surfaceY: number | null
  /** px/mm，与侧栏空间标定一致 */
  pixelScale: number | null
  onPointClick: (point: AnalysisPoint) => void
}

export function ApexHeightChart({ data, surfaceY, pixelScale, onPointClick }: ApexHeightChartProps) {
  const chartData = useMemo<ApexRow[]>(() => {
    if (surfaceY == null || pixelScale == null || !(pixelScale > 0)) {
      return data.map((p) => ({ ...p, apexHeightMm: null }))
    }
    return data.map((p) => ({
      ...p,
      apexHeightMm: apexHeightAboveBaselineMm({
        surfaceYPx: surfaceY,
        outerContourPx: p.outerContourPx,
        pixelScalePxPerMm: pixelScale,
      }),
    }))
  }, [data, surfaceY, pixelScale])

  const validCount = useMemo(
    () => chartData.filter((d) => d.apexHeightMm != null && Number.isFinite(d.apexHeightMm)).length,
    [chartData],
  )

  const handleChartClick = useCallback(
    (nextState: unknown) => {
      const point = resolveClickedPoint(nextState, chartData)
      if (point) onPointClick(point)
    },
    [chartData, onPointClick],
  )

  const ready = surfaceY != null && pixelScale != null && pixelScale > 0

  return (
    <div className="panel chart-panel">
      <div className="chart-header">
        <div className="panel-title">竖直高度（轮廓最高点相对基准线）</div>
        <div className="chart-actions">
          <div className="panel-subtitle chart-metrics">
            <span className="contact-time-label">
              有效点数: {validCount} / {data.length}
            </span>
          </div>
        </div>
      </div>
      <p className="chart-footnote">
        横轴为相对时间 (ms)。对每帧 Moore 外轮廓取最小 y 作为最高点，与图像设置中 Surface Y（红线）之差，按 px/mm
        标定换算为竖直距离 (mm)。点击数据点可跳转该分析帧。
      </p>
      <div className="chart-wrap">
        {!ready ? (
          <div className="chart-empty-hint">请设置基准线 Surface Y 并完成空间标定（px/mm）</div>
        ) : chartData.length === 0 ? (
          <div className="chart-empty-hint">暂无分析数据</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 12, left: 0, bottom: 5 }}
              style={{ cursor: 'pointer' }}
              onClick={handleChartClick}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" type="number" domain={[0, 'auto']} tickFormatter={(v) => `${v}ms`} />
              <YAxis
                domain={[0, 'auto']}
                width={46}
                tickFormatter={(v) => v.toFixed(2)}
                label={{ value: 'mm', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
              />
              <Tooltip content={<ApexTooltip />} />
              <Line
                type="monotone"
                dataKey="apexHeightMm"
                name="H (mm)"
                stroke="#2dd4bf"
                strokeWidth={2}
                connectNulls={false}
                dot={(props) => (
                  <ApexDot
                    cx={props.cx}
                    cy={props.cy}
                    payload={props.payload as ApexRow | undefined}
                    onPointClick={onPointClick}
                  />
                )}
                activeDot={(props) => (
                  <ApexDot
                    cx={props.cx}
                    cy={props.cy}
                    payload={props.payload as ApexRow | undefined}
                    onPointClick={onPointClick}
                  />
                )}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
