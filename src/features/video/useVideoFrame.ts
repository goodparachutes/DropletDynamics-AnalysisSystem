import { useEffect } from 'react'
import type { RefObject } from 'react'

interface UseVideoFrameProps {
  videoRef: RefObject<HTMLVideoElement | null>
  isAnalyzing: boolean
  isPlaying: boolean
  onAnalyzeStep: () => void
  onFrameDraw: () => void
}

export function useVideoFrame({
  videoRef,
  isAnalyzing,
  isPlaying,
  onAnalyzeStep,
  onFrameDraw,
}: UseVideoFrameProps): void {
  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return

    const handleSeeked = () => {
      if (isAnalyzing) window.setTimeout(onAnalyzeStep, 40)
      onFrameDraw()
    }
    const handleTimeUpdate = () => {
      if (isPlaying) onFrameDraw()
    }
    const handleLoadedMeta = () => onFrameDraw()
    /** 首帧像素解码完成；仅靠 loadedmetadata 时 readyState 可能仍不足，主画布不会 drawImage */
    const handleLoadedData = () => onFrameDraw()

    videoEl.addEventListener('seeked', handleSeeked)
    videoEl.addEventListener('timeupdate', handleTimeUpdate)
    videoEl.addEventListener('loadedmetadata', handleLoadedMeta)
    videoEl.addEventListener('loadeddata', handleLoadedData)
    return () => {
      videoEl.removeEventListener('seeked', handleSeeked)
      videoEl.removeEventListener('timeupdate', handleTimeUpdate)
      videoEl.removeEventListener('loadedmetadata', handleLoadedMeta)
      videoEl.removeEventListener('loadeddata', handleLoadedData)
    }
  }, [videoRef, isAnalyzing, isPlaying, onAnalyzeStep, onFrameDraw])
}
