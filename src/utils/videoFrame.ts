function waitDoubleRaf(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/**
 * 等待 seek 后的一帧可用于 drawImage/getImageData。
 * 暂停态下 `requestVideoFrameCallback` 在部分浏览器永不触发，会卡死「正在解码…」；故 paused 或超时则回退双 rAF。
 */
export function waitNextVideoFrame(video: HTMLVideoElement): Promise<void> {
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
  if (typeof v.requestVideoFrameCallback !== 'function' || video.paused) {
    return waitDoubleRaf()
  }
  return Promise.race([
    new Promise<void>((resolve) => {
      v.requestVideoFrameCallback!(() => resolve())
    }),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 220)
    }),
  ])
}
