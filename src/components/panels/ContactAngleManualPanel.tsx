import { useEffect, useState } from 'react'
import type { AnalysisPoint } from '../../types/analysis'
import type { ContactAngleFitOpts } from '../../features/analysis/contactAngle'
import { enrichAnalysisPointContactAngles } from '../../features/analysis/contactAngle'

function clampThetaDeg(v: number): number {
  return Math.max(8, Math.min(172, v))
}

interface ContactAngleManualPanelProps {
  selectedIdx: number
  point: AnalysisPoint | null
  surfaceY: number | null
  /** 侧栏「图像设置」全局拟合精度；与本帧覆盖对比 */
  globalFitPrecision: number
  contactAngleFitOpts: ContactAngleFitOpts
  analysisData: AnalysisPoint[]
  onReplaceAnalysisData: (next: AnalysisPoint[]) => void
  onRedraw: () => void
}

export function ContactAngleManualPanel({
  selectedIdx,
  point,
  surfaceY,
  globalFitPrecision,
  contactAngleFitOpts,
  analysisData,
  onReplaceAnalysisData,
  onRedraw,
}: ContactAngleManualPanelProps) {
  const [leftStr, setLeftStr] = useState('')
  const [rightStr, setRightStr] = useState('')

  useEffect(() => {
    if (!point) {
      setLeftStr('')
      setRightStr('')
      return
    }
    setLeftStr(
      point.contactAngleLeftDeg !== undefined && Number.isFinite(point.contactAngleLeftDeg)
        ? String(point.contactAngleLeftDeg)
        : '',
    )
    setRightStr(
      point.contactAngleRightDeg !== undefined && Number.isFinite(point.contactAngleRightDeg)
        ? String(point.contactAngleRightDeg)
        : '',
    )
  }, [point?.time, point?.contactAngleLeftDeg, point?.contactAngleRightDeg, selectedIdx])

  if (selectedIdx < 0 || !point) return null

  const canAlgorithm =
    surfaceY !== null &&
    point.beta !== 0 &&
    point.absDiameter !== 0 &&
    Boolean(point.ptsL?.length && point.ptsR?.length && point.subL !== undefined && point.subR !== undefined)

  const applyManual = () => {
    const next = [...analysisData]
    const p = { ...next[selectedIdx] }
    const l = parseFloat(leftStr.replace(',', '.'))
    const r = parseFloat(rightStr.replace(',', '.'))
    if (Number.isFinite(l)) p.contactAngleLeftDeg = +clampThetaDeg(l).toFixed(2)
    else delete p.contactAngleLeftDeg
    if (Number.isFinite(r)) p.contactAngleRightDeg = +clampThetaDeg(r).toFixed(2)
    else delete p.contactAngleRightDeg
    if (
      p.contactAngleLeftDeg !== undefined &&
      p.contactAngleRightDeg !== undefined &&
      Number.isFinite(p.contactAngleLeftDeg) &&
      Number.isFinite(p.contactAngleRightDeg)
    ) {
      p.contactAngleAvgDeg = +((p.contactAngleLeftDeg + p.contactAngleRightDeg) / 2).toFixed(2)
    } else {
      delete p.contactAngleAvgDeg
    }
    next[selectedIdx] = p
    onReplaceAnalysisData(next)
    onRedraw()
  }

  const recalcAlgorithm = () => {
    if (!canAlgorithm || surfaceY === null) return
    const next = [...analysisData]
    next[selectedIdx] = enrichAnalysisPointContactAngles(next[selectedIdx], surfaceY, contactAngleFitOpts)
    onReplaceAnalysisData(next)
    onRedraw()
  }

  const effectiveFitPrec =
    point.contactAngleFitPrecision != null && Number.isFinite(point.contactAngleFitPrecision)
      ? Math.max(0, Math.min(100, Math.round(point.contactAngleFitPrecision)))
      : globalFitPrecision

  const applyFrameFitPrecision = (raw: number) => {
    const v = Math.max(0, Math.min(100, Math.round(raw)))
    const next = [...analysisData]
    let p = { ...next[selectedIdx] }
    if (v === Math.round(globalFitPrecision)) {
      delete p.contactAngleFitPrecision
    } else {
      p.contactAngleFitPrecision = v
    }
    if (canAlgorithm && surfaceY !== null) {
      p = enrichAnalysisPointContactAngles(p, surfaceY, contactAngleFitOpts)
    }
    next[selectedIdx] = p
    onReplaceAnalysisData(next)
    onRedraw()
  }

  const clearFrameFitPrecision = () => {
    const next = [...analysisData]
    let p = { ...next[selectedIdx] }
    delete p.contactAngleFitPrecision
    if (canAlgorithm && surfaceY !== null) {
      p = enrichAnalysisPointContactAngles(p, surfaceY, contactAngleFitOpts)
    }
    next[selectedIdx] = p
    onReplaceAnalysisData(next)
    onRedraw()
  }

  return (
    <section className="panel control-panel contact-angle-manual-panel">
      <h3 className="panel-heading">选中帧 θ</h3>
      <p className="panel-hint">
        拖动铺展直径柄<strong>不会</strong>自动改接触角。需要改 θ 时：在此填入数值点「应用」，或点「按算法重算」用当前轮廓与触点重新估计。
      </p>
      <label className="contact-angle-fitprec-label">
        本帧拟合精度（0–100）: {effectiveFitPrec}
        {point.contactAngleFitPrecision == null ? (
          <span className="contact-angle-fitprec-badge">沿用全局 {globalFitPrecision}</span>
        ) : (
          <span className="contact-angle-fitprec-badge">本帧覆盖</span>
        )}
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={effectiveFitPrec}
          disabled={!canAlgorithm}
          onChange={(e) => applyFrameFitPrecision(+e.target.value)}
        />
      </label>
      <div className="contact-angle-manual-actions contact-angle-fitprec-actions">
        <button
          type="button"
          className="ghost-btn"
          disabled={
            !canAlgorithm ||
            point.contactAngleFitPrecision == null ||
            !Number.isFinite(point.contactAngleFitPrecision)
          }
          onClick={clearFrameFitPrecision}
        >
          清除本帧覆盖（跟随全局）
        </button>
      </div>
      <p className="panel-hint contact-angle-fitprec-hint">
        与侧栏「拟合精度」相同刻度：直线回归控制取样深度与点数，青样条控制竖直带。滑动后立即按当前方法重算本帧 θ（需有轮廓点）。
      </p>
      <div className="contact-angle-manual-row">
        <label className="contact-angle-manual-label">
          θ左 (°)
          <input
            type="text"
            inputMode="decimal"
            className="contact-angle-manual-input"
            value={leftStr}
            onChange={(e) => setLeftStr(e.target.value)}
            placeholder="—"
          />
        </label>
        <label className="contact-angle-manual-label">
          θ右 (°)
          <input
            type="text"
            inputMode="decimal"
            className="contact-angle-manual-input"
            value={rightStr}
            onChange={(e) => setRightStr(e.target.value)}
            placeholder="—"
          />
        </label>
      </div>
      <div className="contact-angle-manual-actions">
        <button type="button" className="algo-btn" onClick={applyManual}>
          应用手动数值
        </button>
        <button type="button" className="algo-btn" disabled={!canAlgorithm} onClick={recalcAlgorithm}>
          按算法重算本帧
        </button>
      </div>
    </section>
  )
}
