import { useMemo, useState } from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import type { AnalysisPoint, CalibrationPoint } from '../../types/analysis'
import {
  DISPLAY_BASELINE_PRESERVE_PX_DEFAULT,
  MERIDIAN_SG_WINDOW_DEFAULT,
  contourDisplaySmoothPercentToWindow,
  contourRingPixelLength,
  smoothClosedOuterContourPxForDisplay,
} from '../../features/analysis/surfaceEnergy'

function contourToCsv(pts: CalibrationPoint[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join('\n')
}

/** 本帧是否存在轮廓相关的「手工」覆盖（复位按钮仅在有时启用） */
export function contourFrameOverridesPresent(p: AnalysisPoint | null): boolean {
  if (!p) return false
  return (
    p.contourPerFrameThreshold != null ||
    p.contourPerFrameDiffThreshold != null ||
    Boolean(p.mooreStrictOuterRaySeed) ||
    (p.manualSuppressCircles?.length ?? 0) > 0
  )
}

function subsamplePreview(pts: CalibrationPoint[], maxPts: number): CalibrationPoint[] {
  if (pts.length <= maxPts) return pts
  const out: CalibrationPoint[] = []
  const step = (pts.length - 1) / (maxPts - 1)
  for (let i = 0; i < maxPts; i++) {
    out.push(pts[Math.min(pts.length - 1, Math.round(i * step))]!)
  }
  return out
}

type SvgPreviewSpec = { d: string; viewBox: string; strokeW: number }

function bboxCenterOfSample(sample: CalibrationPoint[]): { cx: number; cy: number } | null {
  if (sample.length < 1) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of sample) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

/** zoomMag：相对整幅的放大倍率，1=整幅，3≈宽高各取 1/3（液滴在预览里约 3 倍大） */
function buildContourPreviewSpec(
  pts: CalibrationPoint[],
  frameW: number | undefined,
  frameH: number | undefined,
  zoomMag: number,
): SvgPreviewSpec | null {
  const sample = subsamplePreview(pts, 1600)
  if (sample.length < 2) return null

  const useFixedFrame =
    frameW != null &&
    frameH != null &&
    frameW > 0 &&
    frameH > 0 &&
    Number.isFinite(frameW) &&
    Number.isFinite(frameH)

  if (useFixedFrame) {
    const W = frameW
    const H = frameH
    const m = Math.max(1, Math.min(zoomMag, 14))
    const vw = W / m
    const vh = H / m
    const c = bboxCenterOfSample(sample) ?? { cx: W / 2, cy: H / 2 }
    let vx = c.cx - vw / 2
    let vy = c.cy - vh / 2
    vx = Math.max(0, Math.min(vx, W - vw))
    vy = Math.max(0, Math.min(vy, H - vh))
    const d = sample
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ')
    const strokeW = Math.max(0.85, (vw + vh) * 0.002)
    return { d, viewBox: `${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`, strokeW }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of sample) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const pad = Math.max(4, (maxX - minX + maxY - minY) * 0.02)
  const w = maxX - minX + 2 * pad
  const h = maxY - minY + 2 * pad
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return null
  const d = sample
    .map((p, i) => {
      const sx = p.x - minX + pad
      const sy = p.y - minY + pad
      return `${i === 0 ? 'M' : 'L'} ${sx.toFixed(2)} ${sy.toFixed(2)}`
    })
    .join(' ')
  const strokeW = Math.max(1.2, (w + h) * 0.002)
  return { d, viewBox: `0 0 ${w.toFixed(2)} ${h.toFixed(2)}`, strokeW }
}

function ContourPreviewSvg({
  pts,
  previewFrameWidthPx,
  previewFrameHeightPx,
  zoomMag,
}: {
  pts: CalibrationPoint[]
  /** 与主画布/视频一致时：同像素比例 + 可调取景放大 */
  previewFrameWidthPx?: number
  previewFrameHeightPx?: number
  /** 仅固定画幅模式生效，见 `buildContourPreviewSpec` */
  zoomMag: number
}) {
  const spec = useMemo(
    () => buildContourPreviewSpec(pts, previewFrameWidthPx, previewFrameHeightPx, zoomMag),
    [pts, previewFrameWidthPx, previewFrameHeightPx, zoomMag],
  )

  if (!spec) {
    return <div className="contour-seq-preview-empty">点过少，无法预览</div>
  }

  return (
    <svg
      className="contour-seq-preview-svg"
      viewBox={spec.viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <path d={`${spec.d} Z`} fill="none" stroke="#22d3ee" strokeWidth={spec.strokeW} />
    </svg>
  )
}

function contourBBoxMmHint(
  pts: CalibrationPoint[],
  pixelScalePxPerMm: number | null | undefined,
): string | null {
  if (pts.length < 2 || pixelScalePxPerMm == null || !(pixelScalePxPerMm > 0)) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const mmPerPx = 1 / pixelScalePxPerMm
  const wMm = (maxX - minX) * mmPerPx
  const hMm = (maxY - minY) * mmPerPx
  if (!(wMm > 0 && hMm > 0 && Number.isFinite(wMm) && Number.isFinite(hMm))) return null
  return `外接框约 ${wMm.toFixed(3)} × ${hMm.toFixed(3)} mm（显示链 × ${(1 / pixelScalePxPerMm).toFixed(5)} mm/px）`
}

export interface ContourSequencePanelProps {
  /** 与空间标定一致：用于把本帧轮廓外接框换算为物理尺寸提示 */
  pixelScalePxPerMm?: number | null
  /** 与视频/主画布分辨率一致时，轮廓预览使用整幅固定 viewBox，避免逐帧外接框缩放 */
  previewFrameWidthPx?: number
  previewFrameHeightPx?: number
  /** 基准线 Y（px）；用于外轮廓显示平滑时在触点带保留原始 Moore，减轻基线旁「尾巴」 */
  surfaceYPx?: number | null
  /** 当前选中的分析点；未选中时为 null */
  point: AnalysisPoint | null
  /** 已导入视频、已设 Surface Y 且图表上选中了一帧 */
  canOpenRepair?: boolean
  /** 亮度分割且已选中一帧时可备用阈值重试 */
  canRetryAltThreshold?: boolean
  /** 已选中一帧且已设 Surface Y 时可用单行从左射线 Moore 起点重算外壳 */
  canRetryStrictOuterRay?: boolean
  /** 打开掩码橡皮擦修补对话框 */
  onOpenMaskRepair?: () => void
  /** 本帧用全局阈值 ± 步长重算 Moore（仅 luminance） */
  onRetryAltThreshold?: () => void
  /** 本帧用射线外壳 Moore 起点重算（可与单帧阈值覆盖共用） */
  onRetryStrictOuterRay?: () => void
  /** 清除本帧轮廓自定义并用侧栏当前设置默认方式重提轮廓 */
  canResetContourDefaults?: boolean
  onResetContourDefaults?: () => void
  /** 对序列中每一帧 seek 后用当前分割设置重算 Moore 外轮廓（保留铺展柄与各帧掩码/阈值覆盖） */
  canRecalculateAllOuterContours?: boolean
  isRecalculatingAllOuterContours?: boolean
  onRecalculateAllOuterContours?: () => void
  /** 与表面能/体积图联动：0=原始 Moore 参与积分 */
  contourSmoothPct: number
  onContourSmoothPctChange: (pct: number) => void
  contourPreserveBaselineBand: boolean
  onContourPreserveBaselineBandChange: (v: boolean) => void
}

export function ContourSequencePanel({
  pixelScalePxPerMm = null,
  previewFrameWidthPx = 0,
  previewFrameHeightPx = 0,
  surfaceYPx = null,
  point,
  canOpenRepair = false,
  canRetryAltThreshold = false,
  canRetryStrictOuterRay = false,
  onOpenMaskRepair,
  onRetryAltThreshold,
  onRetryStrictOuterRay,
  canResetContourDefaults = false,
  onResetContourDefaults,
  canRecalculateAllOuterContours = false,
  isRecalculatingAllOuterContours = false,
  onRecalculateAllOuterContours,
  contourSmoothPct,
  onContourSmoothPctChange,
  contourPreserveBaselineBand,
  onContourPreserveBaselineBandChange,
}: ContourSequencePanelProps) {
  /** 100=整幅取景，300≈宽高各取 1/3（默认略放大便于看清液滴） */
  const [contourPreviewZoomPct, setContourPreviewZoomPct] = useState(320)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const contourPreviewZoomMag = contourPreviewZoomPct / 100
  const useFixedContourPreview =
    previewFrameWidthPx > 0 && previewFrameHeightPx > 0 && Number.isFinite(previewFrameWidthPx + previewFrameHeightPx)

  const ptsRaw = point?.outerContourPx
  const nRaw = ptsRaw?.length ?? 0
  const ringLen = ptsRaw?.length ? contourRingPixelLength(ptsRaw) : 0
  const contourSgWindowApplied = useMemo(
    () => (ptsRaw?.length ? contourDisplaySmoothPercentToWindow(contourSmoothPct, ringLen) : null),
    [ptsRaw, contourSmoothPct, ringLen],
  )

  const displayPts = useMemo(() => {
    if (!ptsRaw?.length) return undefined
    if (contourSmoothPct <= 0 || contourSgWindowApplied == null) return [...ptsRaw]
    return smoothClosedOuterContourPxForDisplay(ptsRaw, {
      surfaceYPx: surfaceYPx ?? undefined,
      windowSize: contourSgWindowApplied,
      preserveRawNearBaselinePx: contourPreserveBaselineBand ? undefined : 0,
    })
  }, [ptsRaw, surfaceYPx, contourSmoothPct, contourSgWindowApplied, contourPreserveBaselineBand])
  const nDisplay = displayPts?.length ?? 0
  const overridesPresent = contourFrameOverridesPresent(point)
  const bboxMmHint = useMemo(
    () => (displayPts?.length ? contourBBoxMmHint(displayPts, pixelScalePxPerMm) : null),
    [displayPts, pixelScalePxPerMm],
  )

  const copyCsv = () => {
    if (!displayPts?.length) return
    void navigator.clipboard.writeText(contourToCsv(displayPts)).catch(() => {})
  }

  return (
    <div className={`panel contour-seq-panel ${panelCollapsed ? 'chart-panel-collapsed' : ''}`}>
      <div className="chart-header chart-header-with-collapse">
        <button
          type="button"
          className="chart-collapse-toggle"
          aria-expanded={!panelCollapsed}
          aria-label={panelCollapsed ? '展开外轮廓序列面板' : '收起外轮廓序列面板'}
          title={panelCollapsed ? '展开' : '收起'}
          onClick={(e) => {
            e.stopPropagation()
            setPanelCollapsed((c) => !c)
          }}
        >
          <ChevronDown
            size={18}
            className={`chart-collapse-chevron ${panelCollapsed ? 'chart-collapse-chevron-folded' : ''}`}
          />
        </button>
        <div className="panel-title">外轮廓序列</div>
      </div>
      {!panelCollapsed && (
        <>
      <p className="panel-hint">
        点击「接触线动力学」或「表面能」图表上的数据点后，此处<strong>预览与 CSV</strong>可对 Moore 闭合链做可调强度的 Savitzky–Golay
        平滑（默认约等同原先固定窗口 {MERIDIAN_SG_WINDOW_DEFAULT}）。图像坐标 y 向下增大：默认在 Surface Y 以下约{' '}
        {DISPLAY_BASELINE_PRESERVE_PX_DEFAULT}px 宽的<strong>触点带</strong>保留原始 Moore，只对<strong>靠上的弧段</strong>做 SG；取消勾选「触点带保留原始」即<strong>整圈平滑</strong>。
        <strong>平滑设置与下方表面能、体积曲线实时一致</strong>（仍基于存储的原始 Moore 现算）。已加载视频时，轮廓预览与主画布
        <strong>同像素比例</strong>；<strong>平滑程度</strong>与<strong>预览放大</strong>由下方滑块调节（放大倍率固定时沿曲线播放尺度一致）。坐标 x→右、y→下；可复制为
        CSV。静态杂质可在侧栏「轮廓分割」用背景差分
        + 闭运算抑制；滴内误连通可用下方<strong>掩码橡皮擦</strong>仅修补当前选中帧。
        调整侧栏阈值、差分或全局压制后，可用<strong>一键重算全部外轮廓</strong>对整条序列按当前设置逐帧重提 Moore（耗时与帧数成正比）。
      </p>
      {(onOpenMaskRepair ||
        onRetryAltThreshold ||
        onRetryStrictOuterRay ||
        onResetContourDefaults ||
        onRecalculateAllOuterContours) && (
        <div className="contour-seq-actions">
          {onOpenMaskRepair && (
            <button type="button" className="algo-btn" disabled={!canOpenRepair} onClick={onOpenMaskRepair}>
              掩码橡皮擦…
            </button>
          )}
          {onRetryAltThreshold && (
            <button
              type="button"
              className="algo-btn"
              disabled={!canRetryAltThreshold}
              title={
                canRetryAltThreshold
                  ? '亮滴：全局阈值 +18；暗滴：全局阈值 −18；成功则写入本帧阈值覆盖'
                  : '仅在「轮廓分割」为亮度阈值模式且已选中一帧时可用'
              }
              onClick={onRetryAltThreshold}
            >
              备用阈值重试轮廓
            </button>
          )}
          {onRetryStrictOuterRay && (
            <button
              type="button"
              className="algo-btn"
              disabled={!canRetryStrictOuterRay}
              title={
                canRetryStrictOuterRay
                  ? '在近似基底高度从左向右找首条液–背边界作为唯一种子，仅追踪该闭合链（不扫全图）'
                  : '需已导入视频、设定 Surface Y 并在图表上选中一帧'
              }
              onClick={onRetryStrictOuterRay}
            >
              射线外壳 Moore
            </button>
          )}
          {onResetContourDefaults && (
            <button
              type="button"
              className="ghost-btn"
              disabled={!canResetContourDefaults || !overridesPresent}
              title={
                canResetContourDefaults && overridesPresent
                  ? '清除本帧：单帧亮度阈值、射线 Moore、橡皮涂抹；用侧栏全局分割设置与全图 Moore 起点重新提取'
                  : !canResetContourDefaults
                    ? '需已导入视频、设定 Surface Y 并在图表上选中一帧'
                    : '当前帧没有可清除的轮廓自定义'
              }
              onClick={onResetContourDefaults}
            >
              轮廓复位
            </button>
          )}
          {onRecalculateAllOuterContours && (
            <button
              type="button"
              className="primary-btn"
              disabled={!canRecalculateAllOuterContours}
              title={
                canRecalculateAllOuterContours
                  ? '逐帧定位到采样时刻，用侧栏当前分割参数与各帧已有掩码/单帧阈值/射线 Moore 选项重新提取闭合外轮廓；失败帧保留原轮廓'
                  : '需已导入视频、设定 Surface Y、序列非空，且在非播放、非自动分析、非撞击/跳变拟合进行中'
              }
              onClick={() => void onRecalculateAllOuterContours()}
            >
              {isRecalculatingAllOuterContours ? '正在重算外轮廓…' : '一键重算全部外轮廓'}
            </button>
          )}
        </div>
      )}
      {!point && <div className="contour-seq-placeholder">尚未选中数据点</div>}
      {point && !ptsRaw?.length && (
        <div className="contour-seq-placeholder">
          该帧无外轮廓数据（需在分析流程中提取成功；无效帧可能沿用上一帧轮廓）。
        </div>
      )}
      {point && displayPts && displayPts.length > 0 && (
        <>
          <div className="contour-seq-meta">
            <span>相对时间 {point.time.toFixed(1)} ms</span>
            <span title={`原始 Moore 闭合链 ${nRaw} 点（用于提取与物理计算）`}>
              显示点数 {nDisplay}
              {contourSgWindowApplied != null && (
                <span title="当前预览链的 Savitzky–Golay 奇数窗口"> · SG {contourSgWindowApplied}</span>
              )}
              {contourSmoothPct > 0 && contourSgWindowApplied == null && (
                <span title="环上点数不足，无法做 SG"> · 原始</span>
              )}
            </span>
            {bboxMmHint && (
              <span className="contour-seq-bbox-mm" title="平滑显示链的轴对齐外接框；物理量以侧栏 px/mm 为准">
                {bboxMmHint}
              </span>
            )}
            {point.contourPerFrameThreshold != null && (
              <span title="本帧亮度阈值覆盖（备用重试写入）">亮度阈值 {point.contourPerFrameThreshold}</span>
            )}
            {point.contourPerFrameDiffThreshold != null && (
              <span title="本帧差分阈值覆盖（掩码橡皮擦写入）">差分阈值 {point.contourPerFrameDiffThreshold}</span>
            )}
            {point.mooreStrictOuterRaySeed && (
              <span title="Moore 使用单行从左射线起点">射线 Moore</span>
            )}
            <button
              type="button"
              className="algo-btn contour-seq-copy"
              onClick={copyCsv}
              title={
                contourSgWindowApplied != null
                  ? '复制当前预览链全部 x,y（含 SG 平滑，非原始 Moore）'
                  : '复制当前预览链全部 x,y（原始 Moore）'
              }
            >
              <Copy size={14} />
              复制 CSV
            </button>
          </div>
          <label className="contour-seq-zoom">
            轮廓平滑 {contourSmoothPct}%（左原始 · 右更强）
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={contourSmoothPct}
              onChange={(e) => onContourSmoothPctChange(+e.target.value)}
            />
            <span className="panel-field-sub">
              {contourSmoothPct <= 0
                ? '当前为原始 Moore 链（无 SG）。'
                : contourSgWindowApplied != null
                  ? `Savitzky–Golay 窗口 ${contourSgWindowApplied}（奇数）；向右增大窗口、轮廓更顺滑。`
                  : `当前轮廓环过短（少于 5 点不足以 SG），显示仍为原始。`}
            </span>
          </label>
          {contourSmoothPct > 0 && contourSgWindowApplied != null && (
            <label className="checkbox-row contour-seq-baseline-preserve">
              <input
                type="checkbox"
                checked={contourPreserveBaselineBand}
                disabled={surfaceYPx == null}
                onChange={(e) => onContourPreserveBaselineBandChange(e.target.checked)}
              />
              <span
                title={`勾选后：带宽 ${DISPLAY_BASELINE_PRESERVE_PX_DEFAULT}px 内（y ≥ Surface Y − ${DISPLAY_BASELINE_PRESERVE_PX_DEFAULT}）保留原始 Moore，不平滑。`}
              >
                触点带保留原始 Moore（Surface Y 以下约 {DISPLAY_BASELINE_PRESERVE_PX_DEFAULT}px 不平滑）
              </span>
            </label>
          )}
          {useFixedContourPreview && (
            <label className="contour-seq-zoom">
              预览放大 {contourPreviewZoomPct}%
              <input
                type="range"
                min={100}
                max={1200}
                step={20}
                value={contourPreviewZoomPct}
                onChange={(e) => setContourPreviewZoomPct(+e.target.value)}
              />
              <span className="panel-field-sub">
                100% 显示整幅（与主画面同比例）；向右增大则取景窗口变小、液滴在预览中更大。倍率不变时换帧只平移取景，尺度不跳变。
              </span>
            </label>
          )}
          <ContourPreviewSvg
            pts={displayPts}
            previewFrameWidthPx={previewFrameWidthPx}
            previewFrameHeightPx={previewFrameHeightPx}
            zoomMag={contourPreviewZoomMag}
          />
          <pre className="contour-seq-pre" aria-label="外轮廓坐标序列（平滑显示）">
            {contourToCsv(displayPts)}
          </pre>
        </>
      )}
        </>
      )}
    </div>
  )
}
