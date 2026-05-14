import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeSuppressCircles } from '../../features/analysis/analysisRegion'
import { buildForegroundMaskForContour } from '../../features/analysis/dropletContour'

export type SuppressCircle = { x: number; y: number; rPx: number }

export type ContourMaskRepairSavePayload = {
  circles: SuppressCircle[]
  /** 亮度分割：拟写入的本帧阈值（与侧栏全局相同则清除单帧覆盖）；差分模式省略 */
  luminanceThreshold?: number
  /** 背景差分：拟写入的本帧 |ΔI| 阈值（与侧栏全局相同则清除单帧覆盖）；亮度模式省略 */
  diffThreshold?: number
  mooreStrictOuterRaySeed: boolean
}

interface ContourMaskRepairModalProps {
  open: boolean
  imageData: ImageData | null
  segmentationMode: 'luminance' | 'absDiff'
  globalLuminanceThreshold: number
  dropletIsBright: boolean
  surfaceYPx: number | null
  morphCloseIterations: number
  diffThreshold: number
  backgroundGray?: Uint8Array | null
  initialContourPerFrameThreshold?: number
  initialContourPerFrameDiffThreshold?: number
  initialMooreStrictOuterRaySeed?: boolean
  /** 本帧已保存的单帧涂抹（可编辑） */
  initialCircles: SuppressCircle[]
  /** 侧栏「全局背景涂抹」圆域（只读参与预览，与保存流水线一致） */
  globalSuppressCircles?: SuppressCircle[]
  defaultRadiusPx: number
  onClose: () => void
  onSave: (payload: ContourMaskRepairSavePayload) => void
}

function clientToImage(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
): { ix: number; iy: number } {
  const rect = canvas.getBoundingClientRect()
  const sx = canvas.width / Math.max(rect.width, 1e-6)
  const sy = canvas.height / Math.max(rect.height, 1e-6)
  return {
    ix: (clientX - rect.left) * sx,
    iy: (clientY - rect.top) * sy,
  }
}

function maskToBinaryPreviewImageData(mask: Uint8Array, width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 248 : 36
    const o = i * 4
    data[o] = v
    data[o + 1] = v
    data[o + 2] = v
    data[o + 3] = 255
  }
  return new ImageData(data, width, height)
}

export function ContourMaskRepairModal({
  open,
  imageData,
  segmentationMode,
  globalLuminanceThreshold,
  dropletIsBright,
  surfaceYPx,
  morphCloseIterations,
  diffThreshold,
  backgroundGray = null,
  initialContourPerFrameThreshold,
  initialContourPerFrameDiffThreshold,
  initialMooreStrictOuterRaySeed,
  initialCircles,
  globalSuppressCircles = [],
  defaultRadiusPx,
  onClose,
  onSave,
}: ContourMaskRepairModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const [circles, setCircles] = useState<SuppressCircle[]>([])
  const [radius, setRadius] = useState(defaultRadiusPx)
  const [luminanceThr, setLuminanceThr] = useState(globalLuminanceThreshold)
  const [diffThrLocal, setDiffThrLocal] = useState(diffThreshold)
  const [strictOuterRayMoore, setStrictOuterRayMoore] = useState(false)
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setCircles([...initialCircles])
    setRadius(defaultRadiusPx)
    const eff =
      initialContourPerFrameThreshold != null && Number.isFinite(initialContourPerFrameThreshold)
        ? Math.round(initialContourPerFrameThreshold)
        : Math.round(globalLuminanceThreshold)
    setLuminanceThr(Math.max(0, Math.min(255, eff)))
    const effDiff =
      initialContourPerFrameDiffThreshold != null && Number.isFinite(initialContourPerFrameDiffThreshold)
        ? Math.round(initialContourPerFrameDiffThreshold)
        : Math.round(diffThreshold)
    setDiffThrLocal(Math.max(4, Math.min(80, effDiff)))
    setStrictOuterRayMoore(Boolean(initialMooreStrictOuterRaySeed))
  }, [
    open,
    initialCircles,
    defaultRadiusPx,
    globalLuminanceThreshold,
    initialContourPerFrameThreshold,
    initialContourPerFrameDiffThreshold,
    diffThreshold,
    initialMooreStrictOuterRaySeed,
  ])

  const redraw = useCallback(() => {
    const c = canvasRef.current
    if (!c || !imageData) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    c.width = imageData.width
    c.height = imageData.height
    ctx.putImageData(imageData, 0, 0)

    ctx.globalAlpha = 0.38
    ctx.fillStyle = '#f97316'
    for (const k of globalSuppressCircles) {
      ctx.beginPath()
      ctx.arc(k.x, k.y, k.rPx, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#ef4444'
    for (const k of circles) {
      ctx.beginPath()
      ctx.arc(k.x, k.y, k.rPx, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }, [imageData, circles, globalSuppressCircles])

  useEffect(() => {
    redraw()
  }, [redraw])

  useEffect(() => {
    const pc = previewCanvasRef.current
    if (!open || !imageData || surfaceYPx == null || !pc) return
    const { width: w, height: h } = imageData
    const ctx = pc.getContext('2d')
    if (!ctx) return

    const bgOk =
      segmentationMode !== 'absDiff' ||
      (backgroundGray != null && backgroundGray.length === w * h)

    pc.width = w
    pc.height = h

    if (!bgOk) {
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#94a3b8'
      ctx.font = `${Math.max(12, Math.min(18, Math.round(w * 0.028)))}px system-ui, sans-serif`
      ctx.fillText('差分模式需与同尺寸参考背景灰度；请在侧栏「轮廓分割」采集背景', 10, 26)
      ctx.fillText('后再打开此处查看二值预览。', 10, 48)
      return
    }

    let mask: Uint8Array
    try {
      mask = buildForegroundMaskForContour({
        imageData,
        threshold: globalLuminanceThreshold,
        dropletIsBright,
        surfaceYPx,
        segmentationMode,
        backgroundGray,
        diffThreshold: segmentationMode === 'absDiff' ? diffThrLocal : diffThreshold,
        morphCloseIterations,
        manualSuppressCircles: mergeSuppressCircles(globalSuppressCircles, circles),
        luminanceThresholdOverride: segmentationMode === 'luminance' ? luminanceThr : null,
      })
    } catch {
      ctx.fillStyle = '#450a0a'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fecaca'
      ctx.font = '14px system-ui, sans-serif'
      ctx.fillText('二值预览计算失败', 10, 28)
      return
    }

    ctx.putImageData(maskToBinaryPreviewImageData(mask, w, h), 0, 0)
  }, [
    open,
    imageData,
    surfaceYPx,
    segmentationMode,
    globalLuminanceThreshold,
    luminanceThr,
    dropletIsBright,
    morphCloseIterations,
    diffThreshold,
    diffThrLocal,
    backgroundGray,
    circles,
    globalSuppressCircles,
  ])

  const appendStrokeDisc = useCallback((ix: number, iy: number, r: number) => {
    setCircles((prev) => [...prev, { x: ix, y: iy, rPx: r }])
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return
    const { ix, iy } = clientToImage(e.clientX, e.clientY, canvasRef.current)
    canvasRef.current.setPointerCapture(e.pointerId)
    dragRef.current = { x: ix, y: iy }
    appendStrokeDisc(ix, iy, radius)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !dragRef.current) return
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return
    const { ix, iy } = clientToImage(e.clientX, e.clientY, canvasRef.current)
    const last = dragRef.current
    const d = Math.hypot(ix - last.x, iy - last.y)
    const step = Math.max(3, radius * 0.45)
    if (d < step) return
    const n = Math.ceil(d / step)
    for (let s = 1; s <= n; s++) {
      const t = s / n
      appendStrokeDisc(last.x + (ix - last.x) * t, last.y + (iy - last.y) * t, radius)
    }
    dragRef.current = { x: ix, y: iy }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  if (!open) return null

  return (
    <div className="contour-repair-modal-backdrop" role="dialog" aria-modal aria-labelledby="contour-repair-title">
      <div className="contour-repair-modal">
        <h3 id="contour-repair-title" className="panel-title">
          掩码橡皮擦（轮廓修补）
        </h3>
        <p className="panel-hint">
          滴内背光等会在二值图里连成<strong>多余前景</strong>，Moore 沿整块连通域走线。用<strong>涂抹橡皮</strong>（红色）把区域在二值掩码中<strong>强制为背景</strong>后再提取外轮廓；侧栏<strong>全局背景涂抹</strong>（橙色）已在右侧预览与本帧保存时一并参与，与主流程一致。保存仅重算该帧轮廓并写入红色涂抹，不改变 β/D/θ。流水线：<strong>空洞填实 → 闭运算 → 基准线以下清零 → 全局+本帧橡皮</strong>。
        </p>
        {!imageData && <p className="calib-error">无法读取帧图像。</p>}
        {imageData && (
          <div className="contour-repair-split">
            <div className="contour-repair-canvas-col">
              <div className="contour-repair-canvas-caption">
                原图与橡皮覆盖（在此涂抹红色；橙色为全局背景涂抹，参与右侧预览）
              </div>
              <div className="contour-repair-canvas-wrap">
                <canvas
                  ref={canvasRef}
                  className="contour-repair-canvas"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              </div>
            </div>
            <div className="contour-repair-canvas-col">
              <div className="contour-repair-canvas-caption">
                二值预览（闭运算 ×{morphCloseIterations}）
              </div>
              <div className="contour-repair-canvas-wrap contour-repair-binary-wrap">
                <canvas
                  ref={previewCanvasRef}
                  className="contour-repair-canvas contour-repair-binary-canvas"
                  aria-label="二值化预览"
                />
              </div>
            </div>
          </div>
        )}
        <div className="contour-repair-extract-opts">
          {segmentationMode === 'luminance' && (
            <label className="contour-repair-threshold-label">
              本帧亮度阈值（保存并重算轮廓）: {luminanceThr}
              <input
                type="range"
                min={0}
                max={255}
                step={1}
                value={luminanceThr}
                onChange={(e) => setLuminanceThr(+e.target.value)}
              />
              <span className="panel-field-sub">
                拖动时右侧二值预览同步更新。与侧栏全局 {Math.round(globalLuminanceThreshold)}{' '}
                相同则清除「单帧阈值覆盖」。
              </span>
            </label>
          )}
          {segmentationMode === 'absDiff' && (
            <label className="contour-repair-threshold-label">
              本帧差分阈值 |ΔI| &gt; {diffThrLocal}（保存并重算轮廓）
              <input
                type="range"
                min={4}
                max={80}
                step={1}
                value={diffThrLocal}
                onChange={(e) => setDiffThrLocal(+e.target.value)}
              />
              <span className="panel-field-sub">
                与侧栏全局差分阈值 {Math.round(diffThreshold)} 相同则清除「单帧差分阈值覆盖」。
              </span>
            </label>
          )}
          <label className="chart-series-toggle contour-repair-ray-toggle">
            <input
              type="checkbox"
              checked={strictOuterRayMoore}
              onChange={(e) => setStrictOuterRayMoore(e.target.checked)}
            />
            单行从左射线 Moore 起点（优先物理外壳，减轻滴内空洞轮廓）
          </label>
        </div>
        <label>
          橡皮半径（px）: {radius.toFixed(0)}
          <input type="range" min={4} max={56} step={1} value={radius} onChange={(e) => setRadius(+e.target.value)} />
        </label>
        <div className="contour-repair-actions">
          <button type="button" className="ghost-btn" onClick={() => setCircles([])}>
            清除涂抹
          </button>
          <button type="button" className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="success-btn"
            disabled={!imageData}
            onClick={() =>
              onSave({
                circles,
                ...(segmentationMode === 'luminance' ? { luminanceThreshold: luminanceThr } : {}),
                ...(segmentationMode === 'absDiff' ? { diffThreshold: diffThrLocal } : {}),
                mooreStrictOuterRaySeed: strictOuterRayMoore,
              })
            }
          >
            保存并重算轮廓
          </button>
        </div>
      </div>
    </div>
  )
}
