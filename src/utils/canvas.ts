import type { MouseEvent } from 'react'

export function getCanvasCoordinates(
  event: MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  intrinsicWidth: number,
  intrinsicHeight: number,
): { x: number; y: number } {
  if (intrinsicHeight === 0 || intrinsicWidth === 0) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  const videoRatio = intrinsicWidth / intrinsicHeight
  const elementRatio = rect.width / rect.height
  let actualWidth: number
  let actualHeight: number
  let offsetX = 0
  let offsetY = 0
  if (elementRatio > videoRatio) {
    actualHeight = rect.height
    actualWidth = rect.height * videoRatio
    offsetX = (rect.width - actualWidth) / 2
  } else {
    actualWidth = rect.width
    actualHeight = rect.width / videoRatio
    offsetY = (rect.height - actualHeight) / 2
  }
  return {
    x: ((event.clientX - rect.left - offsetX) / actualWidth) * intrinsicWidth,
    y: ((event.clientY - rect.top - offsetY) / actualHeight) * intrinsicHeight,
  }
}
