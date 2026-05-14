/**
 * 当前解码视频帧的 RGBA（不含主画布上的基准线、铺展、标定圆等叠加），
 * 用于掩码修补、轮廓等与肉眼「原图」一致的二值输入。
 */
export function captureVideoFrameImageData(videoEl: HTMLVideoElement): ImageData | null {
  const w = videoEl.videoWidth
  const h = videoEl.videoHeight
  if (w <= 0 || h <= 0) return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { alpha: false })
  if (!ctx) return null
  ctx.drawImage(videoEl, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}
