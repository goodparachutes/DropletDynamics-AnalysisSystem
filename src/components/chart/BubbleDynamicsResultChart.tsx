import { useCallback, useMemo, useState } from 'react'
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
import type {
  CavityDynamicsSessionPersisted,
  CavityPipelineDebug,
  CavityStopReason,
} from '../../types/cavityDynamics'
import {
  cavityAbTooltip,
  cavityDeltaPTooltip,
  cavityKappaMmTooltip,
  cavityReqTooltip,
  cavityTimeMsTooltip,
  cavityVrAbsTooltip,
  cavityVrTooltip,
  cavityZcTooltip,
  CAVITY_CURVE_METRIC_TOOLTIPS,
} from '../../features/cavity/cavityParamTooltips'

function stopReasonLabel(r: CavityStopReason | null): string {
  if (!r) return '—'
  switch (r) {
    case 'complete':
      return '已跑完全部指定帧'
    case 'collapse_area':
      return '溃灭（面积低于阈值）'
    case 'open_to_roi_edge':
      return '与 ROI 边界连通（未启用自动停）'
    case 'extract_failed':
      return '提取失败'
    case 'invalid_range':
      return '帧范围无效'
    case 'debris_ar':
      return '长宽比护栏：非气泡杂质，已终止'
    default:
      return String(r)
  }
}

function parseTooltipDataIndex(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v !== '') {
    const n = Number.parseInt(v, 10)
    if (!Number.isNaN(n)) return n
  }
  return null
}

type CavityChartRow = {
  tMs: number
  req?: number
  Ab?: number
  dP?: number
  vrAbs?: number
  zc?: number
  resultIndex: number
  hitAnchor: number
}

type CurveKey = 'req' | 'ab' | 'dP' | 'vrAbs' | 'zc'

function resolveClickedCavityRow(
  eventData: unknown,
  data: CavityChartRow[],
): CavityChartRow | null {
  if (!eventData || typeof eventData !== 'object') return null
  const raw = eventData as {
    activePayload?: Array<{ payload?: CavityChartRow }>
    activeTooltipIndex?: unknown
    activeIndex?: unknown
  }
  const fromPayload = raw.activePayload?.[0]?.payload
  if (fromPayload && typeof fromPayload.resultIndex === 'number') return fromPayload

  const idx =
    parseTooltipDataIndex(raw.activeTooltipIndex) ?? parseTooltipDataIndex(raw.activeIndex)
  if (idx != null && idx >= 0 && idx < data.length) return data[idx]!
  return null
}

function CavityChartPickDot(props: {
  cx?: number
  cy?: number
  payload?: CavityChartRow
  selectedResultIndex: number | null
  onPick: (index: number) => void
}) {
  const { cx, cy, payload, selectedResultIndex, onPick } = props
  if (!payload || typeof cx !== 'number' || typeof cy !== 'number') return null
  const sel = payload.resultIndex === selectedResultIndex
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation()
        onPick(payload.resultIndex)
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

function tooltipValueStr(value: unknown, name: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '')
  if (name.includes('ΔP') || name.includes('Pa')) {
    if (Math.abs(value) >= 1e5) return value.toExponential(3)
    if (Math.abs(value) >= 1e3) return value.toFixed(1)
    return value.toFixed(3)
  }
  return value.toFixed(6)
}

function PipelineDetailBlock(props: {
  session: CavityDynamicsSessionPersisted
  resultIndex: number
  loading: boolean
  pipeline: CavityPipelineDebug | null
}) {
  const { session, resultIndex, loading, pipeline } = props
  const row = session.lastResults[resultIndex]
  if (!row) return null

  return (
    <div className="cavity-chart-selection-detail">
      <div className="cavity-chart-selection-head">
        <span title={cavityTimeMsTooltip}>
          已选序列点 #{resultIndex + 1} · 帧 {row.frameIndex} · t = {(row.timeSec * 1000).toFixed(3)} ms
        </span>
        {loading && <span className="cavity-chart-selection-loading">正在解码并提取轮廓…</span>}
      </div>
      {!loading && pipeline && (
        <ol className="cavity-chart-pipeline-steps">
          <li>
            ROI 内灰度：min / max = {pipeline.grayMin} / {pipeline.grayMax}
            {pipeline.claheApplied ? '；已做 CLAHE(16×16, clip≈4)，在 Otsu 之前' : '；本帧调试跳过 CLAHE'}
          </li>
          <li>
            Otsu 阈值 T = {pipeline.otsuThreshold}；前景判定（invert 前，松弛 ε = {pipeline.otsuRelaxEpsilon}）：
            {session.bubbleDark ? '灰度 ≤ T+ε 为泡（暗泡）' : '灰度 > T−ε 为泡（亮泡）'}
            {session.invertOtsu ? '；已反转二值' : ''}
          </li>
          <li>
            形态学：圆盘闭运算半径 {pipeline.morphCloseDiskRadiusPx}px（弥合小孔）+ 3×3 闭运算 ×{pipeline.morphCloseIterations} 次
          </li>
          <li>
            最大连通域像素 ≈ {pipeline.largestComponentPixels ?? '—'}；Moore 外轮廓点数 ≈{' '}
            {pipeline.moorePointCount ?? '—'}
          </li>
          <li>SG 平滑窗口（奇数）= {pipeline.sgWindow}；画布青色线为平滑后闭合轮廓</li>
        </ol>
      )}
      <div className="cavity-chart-selection-metrics">
        <span title={cavityReqTooltip}>R_eq: {row.reqMm != null ? `${row.reqMm.toFixed(6)} mm` : '—'}</span>
        <span title={cavityAbTooltip}>A_b: {row.areaMm2 != null ? `${row.areaMm2.toFixed(6)} mm²` : '—'}</span>
        <span title={cavityZcTooltip}>Z_c: {row.zcMm != null ? `${row.zcMm.toFixed(6)} mm` : '—'}</span>
        <span title={cavityDeltaPTooltip}>ΔP: {row.deltaPLaplacePa != null ? `${row.deltaPLaplacePa.toExponential(4)} Pa` : '—'}</span>
        <span title={cavityVrAbsTooltip}>|V_r|: {row.vrAbsMmPerS != null ? `${row.vrAbsMmPerS.toFixed(6)} mm/s` : '—'}</span>
        <span title={cavityKappaMmTooltip}>κ_apex: {row.kappaApexPerMm != null ? `${row.kappaApexPerMm.toFixed(6)} /mm` : '—'}</span>
        <span title={cavityVrTooltip}>V_r: {row.vrMmPerS != null ? `${row.vrMmPerS.toFixed(6)} mm/s` : '—'}</span>
        {row.failedReason ? <span className="cavity-chart-selection-warn">本帧记录：{row.failedReason}</span> : null}
      </div>
    </div>
  )
}

export interface BubbleDynamicsResultChartProps {
  session: CavityDynamicsSessionPersisted
  selectedResultIndex: number | null
  selectionLoading: boolean
  selectionPipeline: CavityPipelineDebug | null
  onSelectResultIndex: (index: number) => void
  onClearChartSelection: () => void
}

const initialCurves: Record<CurveKey, boolean> = {
  req: true,
  ab: true,
  dP: true,
  vrAbs: true,
  zc: true,
}

/** 主内容区：空泡动力学多参曲线（侧栏负责参数与运行） */
export function BubbleDynamicsResultChart({
  session,
  selectedResultIndex,
  selectionLoading,
  selectionPipeline,
  onSelectResultIndex,
  onClearChartSelection,
}: BubbleDynamicsResultChartProps) {
  const [curves, setCurves] = useState(initialCurves)
  const [chartCollapsed, setChartCollapsed] = useState(false)

  const patchCurve = useCallback((key: CurveKey, v: boolean) => {
    setCurves((prev) => {
      const next = { ...prev, [key]: v }
      if (!next.req && !next.ab && !next.dP && !next.vrAbs && !next.zc) return prev
      return next
    })
  }, [])

  const chartData = useMemo<CavityChartRow[]>(
    () =>
      session.lastResults.map((row, resultIndex) => ({
        tMs: row.timeSec * 1000,
        req: row.reqMm ?? undefined,
        Ab: row.areaMm2 ?? undefined,
        dP: row.deltaPLaplacePa ?? undefined,
        vrAbs: row.vrAbsMmPerS ?? undefined,
        zc: row.zcMm ?? undefined,
        resultIndex,
        hitAnchor: 0,
      })),
    [session.lastResults],
  )

  const hasSummary =
    session.lastStopReason != null || session.lastCollapseFrameIndex != null

  const rightAxisCount =
    (curves.ab ? 1 : 0) + (curves.dP ? 1 : 0) + (curves.vrAbs ? 1 : 0) + (curves.zc ? 1 : 0)
  const marginRight = 10 + rightAxisCount * 50
  const marginLeft = curves.req ? 8 : 10

  const handleChartClick = useCallback(
    (nextState: unknown) => {
      const hit = resolveClickedCavityRow(nextState, chartData)
      if (hit) onSelectResultIndex(hit.resultIndex)
      else onClearChartSelection()
    },
    [chartData, onClearChartSelection, onSelectResultIndex],
  )

  const dotRenderer = useCallback(
    (props: Record<string, unknown>) => (
      <CavityChartPickDot
        {...props}
        selectedResultIndex={selectedResultIndex}
        onPick={onSelectResultIndex}
      />
    ),
    [selectedResultIndex, onSelectResultIndex],
  )

  return (
    <div className={`panel chart-panel bubble-dynamics-main-chart ${chartCollapsed ? 'chart-panel-collapsed' : ''}`}>
      <div className="chart-header chart-header-with-collapse">
        <button
          type="button"
          className="chart-collapse-toggle"
          aria-expanded={!chartCollapsed}
          aria-label={chartCollapsed ? '展开空泡动力学图' : '收起空泡动力学图'}
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
        <div className="panel-title">空泡动力学 — R_eq、A_b、ΔP、|V_r|、Z_c</div>
      </div>
      {!chartCollapsed && (
        <>
      <p className="chart-footnote">
        横轴为物理时间 <strong>t（ms）= frame × (1000/fs)</strong>，fs 为侧栏「采样 fs」；相邻点间隔 <strong>1000/fs ms</strong>。视频寻址按<strong>导出 fe</strong>与帧号对齐。各量说明：将鼠标移到下方「曲线显示」对应<strong>勾选项</strong>上，通过浏览器原生 <strong>title</strong> 悬停查看（与铺展动力学主图一致）。纵轴可多选 R_eq、A_b、ΔP、|V_r|、Z_c（需 Surface Y）。<strong>点击数据点</strong>跳转该帧并提取轮廓；侧栏「标注显示 → 空泡动力学」中<strong>空泡轮廓</strong>会随之自动勾选（也可手动开关）。
      </p>
      {chartData.length > 0 && (
        <div className="chart-series-toggles bubble-dynamics-curve-toggles" onClick={(e) => e.stopPropagation()}>
          <span className="chart-series-toggles-label">曲线显示（悬停 label 见说明）</span>
          <label className="chart-series-toggle" title={CAVITY_CURVE_METRIC_TOOLTIPS.req}>
            <input type="checkbox" checked={curves.req} onChange={(e) => patchCurve('req', e.target.checked)} />
            <span className="swatch cav-req" /> R_eq
          </label>
          <label className="chart-series-toggle" title={CAVITY_CURVE_METRIC_TOOLTIPS.ab}>
            <input type="checkbox" checked={curves.ab} onChange={(e) => patchCurve('ab', e.target.checked)} />
            <span className="swatch cav-ab" /> A_b
          </label>
          <label className="chart-series-toggle" title={CAVITY_CURVE_METRIC_TOOLTIPS.dP}>
            <input type="checkbox" checked={curves.dP} onChange={(e) => patchCurve('dP', e.target.checked)} />
            <span className="swatch cav-dp" /> ΔP
          </label>
          <label className="chart-series-toggle" title={CAVITY_CURVE_METRIC_TOOLTIPS.vrAbs}>
            <input type="checkbox" checked={curves.vrAbs} onChange={(e) => patchCurve('vrAbs', e.target.checked)} />
            <span className="swatch cav-vr" /> |V_r|
          </label>
          <label className="chart-series-toggle" title={CAVITY_CURVE_METRIC_TOOLTIPS.zc}>
            <input type="checkbox" checked={curves.zc} onChange={(e) => patchCurve('zc', e.target.checked)} />
            <span className="swatch cav-zc" /> Z_c
          </label>
        </div>
      )}
      {hasSummary && (
        <div className="bubble-dynamics-summary bubble-dynamics-summary-main">
          上次终止：{stopReasonLabel(session.lastStopReason)}
          {session.lastCollapseFrameIndex != null && ` · 溃灭帧索引 ${session.lastCollapseFrameIndex}`}
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
                dataKey="tMs"
                type="number"
                domain={['auto', 'auto']}
                tickFormatter={(v) => `${Number(v).toFixed(2)}`}
                label={{ value: 't (ms)', position: 'insideBottom', offset: -2, fill: '#94a3b8', fontSize: 11 }}
              />
              {curves.req ? (
                <YAxis yAxisId="r" stroke="#38bdf8" tickFormatter={(v) => v.toFixed(3)} width={50} />
              ) : null}
              {curves.ab ? (
                <YAxis yAxisId="a" orientation="right" stroke="#a78bfa" tickFormatter={(v) => v.toFixed(4)} width={48} />
              ) : null}
              {curves.dP ? (
                <YAxis
                  yAxisId="dp"
                  orientation="right"
                  stroke="#fb7185"
                  tickFormatter={(v) => (Math.abs(v) >= 1e4 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0))}
                  width={50}
                />
              ) : null}
              {curves.vrAbs ? (
                <YAxis
                  yAxisId="vr"
                  orientation="right"
                  stroke="#34d399"
                  tickFormatter={(v) => v.toFixed(4)}
                  width={48}
                />
              ) : null}
              {curves.zc ? (
                <YAxis yAxisId="zc" orientation="right" stroke="#fbbf24" tickFormatter={(v) => v.toFixed(4)} width={48} />
              ) : null}
              <YAxis yAxisId="hit" domain={[-1, 1]} hide width={0} />
              <Tooltip
                formatter={(value, name) => [tooltipValueStr(value, String(name)), String(name)]}
                labelFormatter={(v) => `t = ${Number(v).toFixed(3)} ms`}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 2 }} />
              {curves.req ? (
                <Line yAxisId="r" type="monotone" dataKey="req" name="R_eq mm" stroke="#38bdf8" dot={false} strokeWidth={2} />
              ) : null}
              {curves.ab ? (
                <Line yAxisId="a" type="monotone" dataKey="Ab" name="A_b mm²" stroke="#a78bfa" dot={false} strokeWidth={2} />
              ) : null}
              {curves.dP ? (
                <Line
                  yAxisId="dp"
                  type="monotone"
                  dataKey="dP"
                  name="ΔP Pa"
                  stroke="#fb7185"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
              ) : null}
              {curves.vrAbs ? (
                <Line
                  yAxisId="vr"
                  type="monotone"
                  dataKey="vrAbs"
                  name="|V_r| mm/s"
                  stroke="#34d399"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
              ) : null}
              {curves.zc ? (
                <Line
                  yAxisId="zc"
                  type="monotone"
                  dataKey="zc"
                  name="Z_c mm"
                  stroke="#fbbf24"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
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
        <div className="chart-empty-hint">暂无空泡序列结果；请在侧栏配置帧范围、ROI 后运行分析。</div>
      )}
      {selectedResultIndex != null && selectedResultIndex >= 0 && selectedResultIndex < session.lastResults.length ? (
        <PipelineDetailBlock
          session={session}
          resultIndex={selectedResultIndex}
          loading={selectionLoading}
          pipeline={selectionPipeline}
        />
      ) : (
        chartData.length > 0 && (
          <p className="cavity-chart-selection-hint chart-footnote">提示：点击图中数据点可查看该帧轮廓与提取步骤。</p>
        )
      )}
        </>
      )}
    </div>
  )
}
