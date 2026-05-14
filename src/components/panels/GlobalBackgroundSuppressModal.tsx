import { useCallback, useEffect, useRef, useState } from 'react'
import { buildForegroundMaskForContour } from '../../features/analysis/dropletContour'
import type { SuppressCircle } from './ContourMaskRepairModal'

export type GlobalBackgroundSuppressSavePayload = {
  circles: SuppressCircle[]
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

interface GlobalBackgroundSuppressModalProps {
  open: boolean
  imageData: ImageData | null
  segmentationMode: 'luminance' | 'absDiff'
  globalLuminanceThreshold: number
  dropletIsBright: boolean
  surfaceYPx: number | null
  morphCloseIterations: number
  diffThreshold: number
  backgroundGray?: Uint8Array | null
  initialCircles: SuppressCircle[]
  defaultRadiusPx: number
  onClose: () => void
  onSave: (payload: GlobalBackgroundSuppressSavePayload) => void
}

/**
 * 与单帧「掩码橡皮」相同的涂抹交互，但保存结果写入**全局**列表：
 * 每一帧二值化后都会在相同画布坐标上强制抹除前景，抑制静止背景杂质。
 */
export function GlobalBackgroundSuppressModal({
  open,
  imageData,
  segmentationMode,
  globalLuminanceThreshold,
  dropletIsBright,
  surfaceYPx,
  morphCloseIterations,
  diffThreshold,
  backgroundGray = null,
  initialCircles,
  defaultRadiusPx,
  onClose,
  onSave,
}: GlobalBackgroundSuppressModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const [circles, setCircles] = useState<SuppressCircle[]>([])
  const [radius, setRadius] = useState(defaultRadiusPx)
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setCircles([...initialCircles])
    setRadius(defaultRadiusPx)
  }, [open, initialCircles, defaultRadiusPx])

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
    for (const k of circles) {
      ctx.beginPath()
      ctx.arc(k.x, k.y, k.rPx, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }, [imageData, circles])

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
      ctx.fillText('差分模式需与同尺寸参考背景灰度；请在「轮廓分割」采集背景后再预览。', 10, 26)
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
        diffThreshold,
        morphCloseIterations,
        manualSuppressCircles: circles,
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
    dropletIsBright,
    morphCloseIterations,
    diffThreshold,
    backgroundGray,
    circles,
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
    <div
      className="contour-repair-modal-backdrop"
      role="dialog"
      aria-modal
      aria-labelledby="global-bg-suppress-title"
    >
      <div className="contour-repair-modal">
        <h3 id="global-bg-suppress-title" className="panel-title">
          全局背景杂质涂抹（所有帧）
        </h3>
        <p className="panel-hint">
          在<strong>当前视频时刻</strong>的画面上涂抹静止杂质区域（橘色）：保存后<strong>每一帧</strong>轮廓提取都会在<strong>相同像素坐标</strong>把掩码强制为背景（在<strong>空洞填实 → 闭运算 → 基准线裁剪之后</strong>最后施加，避免闭运算把涂抹又糊回去）。不改变各帧单独的「掩码橡皮擦」设置；修改后请<strong>重新运行自动分析</strong>以刷新全序列轮廓。
        </p>
        {!imageData && <p className="calib-error">无法读取帧图像。</p>}
        {imageData && (
          <div className="contour-repair-split">
            <div className="contour-repair-canvas-col">
              <div className="contour-repair-canvas-caption">参考帧（在此涂抹全局抑制区）</div>
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
              <div className="contour-repair-canvas-caption">二值预览（含全局涂抹 · 闭运算 ×{morphCloseIterations}）</div>
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
        <label>
          涂抹半径（px）: {radius.toFixed(0)}
          <input type="range" min={4} max={56} step={1} value={radius} onChange={(e) => setRadius(+e.target.value)} />
        </label>
        <div className="contour-repair-actions">
          <button type="button" className="ghost-btn" onClick={() => setCircles([])}>
            清除本窗口涂抹
          </button>
          <button type="button" className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="success-btn"
            disabled={!imageData}
            onClick={() => onSave({ circles })}
          >
            保存为全局涂抹
          </button>
        </div>
      </div>
    </div>
  )
}
