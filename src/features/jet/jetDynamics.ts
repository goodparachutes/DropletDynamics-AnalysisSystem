import type { AnalysisRegionRect } from '../analysis/analysisRegion'
import { cavityDiscreteFrameSeekTimeSec, cropImageData } from '../analysis/analysisRegion'
import { imageDataToGrayUint8, traceMooreOuterContour } from '../analysis/dropletContour'
import { binaryClosing3x3Iterations, binaryClosingDisk } from '../analysis/contourMorphology'
import { claheGray8, otsuThresholdGray } from '../cavity/bubbleDynamics'
import type { CalibrationPoint } from '../../types/analysis'
import type { JetDropSample, JetDropTrack } from '../../types/jetDynamics'
import { fitEllipseFromContourPx, type FittedEllipsePx } from './ellipseAlgebraicFit'
import { linearLeastSquaresXY } from './linearLeastSquares'

const CLAHE_TILE = 16
const CLAHE_CLIP = 4

/** 撞击标定 t(ms) 参数；与 CSV 导出、Z_c 弹道线性拟合一致 */
export type JetImpactTimeCalib = {
  zeroTimeSec: number
  exportedFps: number
  samplingFps: number
  durationSec: number
}

export interface JetBlobFrame {
  frameIndex: number
  /** 全图画布坐标 */
  blobs: JetBlob[]
}

export interface JetBlob {
  cx: number
  cy: number
  /** 用于 Z 标高的参考 y（全图画布 px）：有 LS 椭圆时为椭圆中心 cy，否则为连通域形心 y */
  yRefPx: number
  areaPx: number
  bboxW: number
  bboxH: number
  /** Halír–Flusser 代数椭圆（全图画布坐标）；失败为 null */
  fittedEllipsePx: FittedEllipsePx | null
}

function dist2(a: JetBlob, b: JetBlob): number {
  const dx = a.cx - b.cx
  const dy = a.cy - b.cy
  return dx * dx + dy * dy
}

function blobToSample(
  frameIndex: number,
  timeSec: number,
  blob: JetBlob,
  mmPerPx: number,
  surfaceYPx: number | null,
): JetDropSample {
  const mm = mmPerPx
  const fe = blob.fittedEllipsePx
  const zTipMm =
    surfaceYPx != null && Number.isFinite(surfaceYPx)
      ? (surfaceYPx - blob.yRefPx) * mm
      : null

  if (fe) {
    const aMm = fe.semiMajorPx * mm
    const bMm = fe.semiMinorPx * mm
    const areaMm2 = Math.PI * aMm * bMm
    const volMm3 = (4 / 3) * Math.PI * aMm * bMm * bMm
    const ar = aMm / Math.max(1e-12, bMm)
    return {
      frameIndex,
      timeSec,
      cxPx: blob.cx,
      cyPx: blob.cy,
      zTipMm,
      vJetMmPerS: null,
      areaDropMm2: areaMm2,
      volMm3,
      aspectRatio: ar,
      ellipseSemiMajorMm: aMm,
      ellipseSemiMinorMm: bMm,
      ellipsePhiRad: fe.phiRad,
    }
  }

  const areaMm2 = blob.areaPx * mm * mm
  const reqMm = Math.sqrt(Math.max(0, areaMm2) / Math.PI)
  const volMm3 = (4 / 3) * Math.PI * reqMm * reqMm * reqMm
  const ar = blob.bboxH / Math.max(1e-9, blob.bboxW)
  return {
    frameIndex,
    timeSec,
    cxPx: blob.cx,
    cyPx: blob.cy,
    zTipMm,
    vJetMmPerS: null,
    areaDropMm2: areaMm2,
    volMm3,
    aspectRatio: ar,
  }
}

type JetRoiSegOpts = {
  invertOtsu: boolean
  bubbleDark: boolean
  otsuRelaxEpsilon: number
  morphCloseDiskRadiusPx: number
}

/** ROI 裁剪图内：CLAHE → Otsu → 闭运算后的前景掩膜（0/1） */
function prepareJetRoiBinaryMaskFromCrop(crop: ImageData, opts: JetRoiSegOpts): Uint8Array {
  const gray0 = imageDataToGrayUint8(crop)
  const w = crop.width
  const h = crop.height
  const gray = claheGray8(gray0, w, h, CLAHE_TILE, CLAHE_CLIP)
  const otsuEps = Math.max(0, Math.min(60, Math.round(opts.otsuRelaxEpsilon)))
  const morphRDefault = opts.morphCloseDiskRadiusPx
  const morphR = Math.max(0, Math.min(24, Math.min(morphRDefault, Math.floor(Math.min(w, h) / 4))))

  const thr = otsuThresholdGray(gray)
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const g = gray[i]!
    const fg = opts.bubbleDark
      ? (g <= Math.min(255, thr + otsuEps) ? 1 : 0)
      : (g > Math.max(0, thr - otsuEps) ? 1 : 0)
    mask[i] = fg
  }
  if (opts.invertOtsu) {
    for (let i = 0; i < mask.length; i++) mask[i] = mask[i] === 1 ? 0 : 1
  }
  let m =
    morphR > 0 ? new Uint8Array(binaryClosingDisk(mask, w, h, morphR)) : new Uint8Array(mask)
  m = new Uint8Array(binaryClosing3x3Iterations(m, w, h, 1))
  return m
}

function findNearestForegroundSeed(
  m: Uint8Array,
  w: number,
  h: number,
  ax: number,
  ay: number,
  maxR: number,
): { sx: number; sy: number } | null {
  const x0 = Math.max(0, Math.min(w - 1, Math.round(ax)))
  const y0 = Math.max(0, Math.min(h - 1, Math.round(ay)))
  if (m[y0 * w + x0] === 1) return { sx: x0, sy: y0 }
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = x0 + dx
        const y = y0 + dy
        if (x < 0 || x >= w || y < 0 || y >= h) continue
        if (m[y * w + x] === 1) return { sx: x, sy: y }
      }
    }
  }
  return null
}

function floodFillForegroundComponent(
  m: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
  out: Uint8Array,
): void {
  out.fill(0)
  const stack: number[] = []
  const si = sy * w + sx
  if (m[si] !== 1) return
  stack.push(si)
  while (stack.length) {
    const i = stack.pop()!
    if (out[i]) continue
    if (m[i] !== 1) continue
    out[i] = 1
    const x = i % w
    const yy = (i / w) | 0
    if (x > 0) stack.push(i - 1)
    if (x + 1 < w) stack.push(i + 1)
    if (yy > 0) stack.push(i - w)
    if (yy + 1 < h) stack.push(i + w)
  }
}

/**
 * 相邻整数帧在撞击标定时间轴上的名义间隔 Δt（ms）。
 * 与 `cavityDiscreteFrameSeekTimeSec` 的 floor(fps) 一致：Δt = (1000 / f_decode) × (fe/fs)。
 */
export function jetNominalFrameDeltaMs(exportedFps: number, samplingFps: number): number {
  const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
  const timeScaleFactor = exportedFps / Math.max(1, samplingFps)
  return (1000 / decodeFps) * timeScaleFactor
}

/** 标定时间（ms）在 UI 上建议的小数位数，与 Δt 量级一致 */
export function jetCalibratedTimeMsDecimalPlaces(stepMs: number): number {
  if (!(stepMs > 0) || !Number.isFinite(stepMs)) return 2
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(stepMs) - 1e-12)))
}

/**
 * 与主区「物理时间」读数一致：离散帧 fi 对应 seek 时刻相对撞击零时刻的标定时间（ms）。
 * t_ms = (T_seek(fi) − t₀) × (fe/fs) × 1000，其中 fe=导出帧率，fs=采样帧率。
 * 结果按名义帧间隔 Δt 四舍五入到网格，避免双精度与 Recharts 比例尺刻度出现 6.681 这类非物理小数。
 */
export function jetCalibratedTimeMs(
  frameIndex: number,
  exportedFps: number,
  samplingFps: number,
  zeroTimeSec: number,
  durationSec: number,
): number {
  const decodeFps = Math.max(1, Math.floor(exportedFps) || 1)
  const seekT = cavityDiscreteFrameSeekTimeSec(frameIndex, decodeFps, durationSec)
  const timeScaleFactor = exportedFps / Math.max(1, samplingFps)
  const raw = (seekT - zeroTimeSec) * timeScaleFactor * 1000
  const stepMs = jetNominalFrameDeltaMs(exportedFps, samplingFps)
  if (!(stepMs > 0) || !Number.isFinite(stepMs) || !Number.isFinite(raw)) return raw
  return Math.round(raw / stepMs) * stepMs
}

/**
 * 在锚点（全图画布坐标）所在连通域上提取 Moore 外轮廓；用于曲线选点回放。
 */
export function extractJetContourAtAnchor(
  fullImageData: ImageData,
  roi: AnalysisRegionRect,
  opts: JetRoiSegOpts,
  anchorCx: number,
  anchorCy: number,
): CalibrationPoint[] | null {
  if (!(roi.w >= 4 && roi.h >= 4)) return null
  const crop = cropImageData(fullImageData, roi)
  const w = crop.width
  const h = crop.height
  const m = prepareJetRoiBinaryMaskFromCrop(crop, opts)
  const ox = roi.x
  const oy = roi.y
  const lax = anchorCx - ox
  const lay = anchorCy - oy
  const seed = findNearestForegroundSeed(m, w, h, lax, lay, 64)
  if (!seed) return null
  const comp = new Uint8Array(w * h)
  floodFillForegroundComponent(m, w, h, seed.sx, seed.sy, comp)
  const local = traceMooreOuterContour(comp, w, h)
  if (!local || local.length < 8) return null
  return local.map((p) => ({ x: p.x + ox, y: p.y + oy }))
}

/**
 * ROI 内 CLAHE → Otsu → 闭运算，枚举面积 ≥ minJetPixels 的前景连通域（与空泡预处理同族）。
 */
export function extractJetBlobsOneFrame(
  fullImageData: ImageData,
  roi: AnalysisRegionRect,
  opts: {
    minJetPixels: number
    invertOtsu: boolean
    bubbleDark: boolean
    otsuRelaxEpsilon: number
    morphCloseDiskRadiusPx: number
    frameIndex: number
  },
): JetBlobFrame | null {
  if (!(roi.w >= 4 && roi.h >= 4)) return null
  const crop = cropImageData(fullImageData, roi)
  const w = crop.width
  const h = crop.height
  const m = prepareJetRoiBinaryMaskFromCrop(crop, opts)

  const minA = Math.max(1, Math.floor(opts.minJetPixels))
  const ox = roi.x
  const oy = roi.y
  const blobs: JetBlob[] = []
  const seen = new Uint8Array(w * h)
  const stack: number[] = []

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const si = sy * w + sx
      if (m[si] !== 1 || seen[si]) continue
      let count = 0
      let sumx = 0
      let sumy = 0
      let minx = sx
      let maxx = sx
      let miny = sy
      let maxy = sy
      stack.length = 0
      stack.push(si)
      seen[si] = 1
      while (stack.length) {
        const j = stack.pop()!
        const x = j % w
        const yy = (j / w) | 0
        count++
        sumx += x
        sumy += yy
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (yy < miny) miny = yy
        if (yy > maxy) maxy = yy
        if (x > 0) {
          const k = j - 1
          if (m[k] === 1 && !seen[k]) {
            seen[k] = 1
            stack.push(k)
          }
        }
        if (x + 1 < w) {
          const k = j + 1
          if (m[k] === 1 && !seen[k]) {
            seen[k] = 1
            stack.push(k)
          }
        }
        if (yy > 0) {
          const k = j - w
          if (m[k] === 1 && !seen[k]) {
            seen[k] = 1
            stack.push(k)
          }
        }
        if (yy + 1 < h) {
          const k = j + w
          if (m[k] === 1 && !seen[k]) {
            seen[k] = 1
            stack.push(k)
          }
        }
      }
      if (count < minA) continue
      const bw = Math.max(1, maxx - minx + 1)
      const bh = Math.max(1, maxy - miny + 1)
      const cx = sumx / count
      const cy = sumy / count

      const comp = new Uint8Array(w * h)
      floodFillForegroundComponent(m, w, h, sx, sy, comp)
      const localContour = traceMooreOuterContour(comp, w, h)
      let fitted: FittedEllipsePx | null = null
      if (localContour && localContour.length >= 8) {
        const globalContour = localContour.map((p) => ({ x: p.x + ox, y: p.y + oy }))
        fitted = fitEllipseFromContourPx(globalContour)
      }
      const yRefPx = fitted != null ? fitted.cy : oy + cy

      blobs.push({
        cx: ox + cx,
        cy: oy + cy,
        yRefPx,
        areaPx: count,
        bboxW: bw,
        bboxH: bh,
        fittedEllipsePx: fitted,
      })
    }
  }

  return { frameIndex: opts.frameIndex, blobs }
}

/**
 * 弹道拟合：Z_c ≈ (dZ/dt)·t + Z₀，t 为撞击标定时间（ms），斜率换为 V_jet（mm/s），
 * 整条轨迹同一常数；E_k = ½ρ⟨V⟩²·⟨V_sphere⟩ 用 **volMm3>0 的算术平均体积** 锁定唯一输出（η、β 与此一致）。
 */
export function postprocessJetBallisticVelocityAndEk(
  samples: JetDropSample[],
  timeCalib: JetImpactTimeCalib | null,
  rhoKgM3: number,
): JetDropSample[] {
  const sorted = [...samples].sort((a, b) => a.frameIndex - b.frameIndex)
  if (sorted.length === 0) return sorted

  const ts: number[] = []
  const zs: number[] = []
  for (const s of sorted) {
    if (s.zTipMm != null && Number.isFinite(s.zTipMm)) {
      const tms = timeCalib
        ? jetCalibratedTimeMs(
            s.frameIndex,
            timeCalib.exportedFps,
            timeCalib.samplingFps,
            timeCalib.zeroTimeSec,
            timeCalib.durationSec,
          )
        : s.timeSec * 1000
      ts.push(tms)
      zs.push(s.zTipMm)
    }
  }

  const fit = linearLeastSquaresXY(ts, zs)
  const vMmPerS =
    fit != null && Number.isFinite(fit.slope) ? fit.slope * 1000 : null

  const vols = sorted.map((s) => s.volMm3).filter((v) => v > 0 && Number.isFinite(v))
  const volLock =
    vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : sorted.find((s) => s.volMm3 > 0)?.volMm3 ?? 0

  let ek: number | null = null
  if (
    vMmPerS != null &&
    Number.isFinite(vMmPerS) &&
    volLock > 0 &&
    rhoKgM3 > 0 &&
    Number.isFinite(rhoKgM3)
  ) {
    const V_m3 = volLock * 1e-9
    const v_m_s = vMmPerS * 1e-3
    ek = 0.5 * rhoKgM3 * V_m3 * v_m_s * v_m_s
  }

  return sorted.map((s) => ({ ...s, vJetMmPerS: vMmPerS, ekJoule: ek }))
}

/** 侧栏宏观量：用于 E_in、η、β；U₀ 来自撞击速度分析（m/s），缺则为 null */
export type JetMacroEnergyParams = {
  rhoKgM3: number
  /** 母液滴等效直径 D₀（mm），与侧栏一致 */
  d0Mm: number
  /** 撞击速度 U₀（m/s） */
  u0Mps: number | null
  /** 表面张力 σ（N/m） */
  sigmaNm: number
}

/**
 * E_in = ½ M₀ U₀² + σ (4πR₀²)，M₀ = ρ (4/3 π R₀³)，R₀ = D₀/2（SI）。
 * 需 U₀、ρ、D₀ 有效且 σ 有限。
 */
export function computeJetMacroInputEnergyJ(p: JetMacroEnergyParams): number | null {
  const rho = p.rhoKgM3
  const d0m = p.d0Mm * 1e-3
  const R0 = d0m / 2
  const u0 = p.u0Mps
  const sigma = p.sigmaNm
  if (!(rho > 0 && d0m > 0 && R0 > 0 && Number.isFinite(sigma) && sigma >= 0)) return null
  if (u0 == null || !(u0 > 0) || !Number.isFinite(u0)) return null
  const V0 = (4 / 3) * Math.PI * R0 ** 3
  const M0 = rho * V0
  const ek0 = 0.5 * M0 * u0 * u0
  const es0 = sigma * 4 * Math.PI * R0 ** 2
  const ein = ek0 + es0
  return ein > 0 && Number.isFinite(ein) ? ein : null
}

function postprocessJetEtaBeta(
  samples: JetDropSample[],
  macro: JetMacroEnergyParams | null | undefined,
): JetDropSample[] {
  if (!macro) {
    return samples.map((s) => ({ ...s, efficiencyEta: null, amplificationBeta: null }))
  }
  const ein = computeJetMacroInputEnergyJ(macro)
  const u0 = macro.u0Mps
  if (ein == null || u0 == null || !(u0 > 0)) {
    return samples.map((s) => ({ ...s, efficiencyEta: null, amplificationBeta: null }))
  }
  return samples.map((s) => {
    let efficiencyEta: number | null = null
    let amplificationBeta: number | null = null
    const ek = s.ekJoule
    if (ek != null && Number.isFinite(ek) && ein > 0) efficiencyEta = ek / ein
    const v = s.vJetMmPerS
    if (v != null && Number.isFinite(v)) {
      const vm = v * 1e-3
      amplificationBeta = (vm / u0) ** 2
    }
    return { ...s, efficiencyEta, amplificationBeta }
  })
}

/**
 * 形心最近邻贪心匹配；首帧按 x 排序后依次赋 ID；断裂产生新 ID。
 */
export function runJetDynamicsTracking(
  frames: JetBlobFrame[],
  mmPerPx: number,
  surfaceYPx: number | null,
  physicsHz: number,
  fluidDensityKgM3: number,
  macroEnergy?: JetMacroEnergyParams | null,
  impactTimeCalib?: JetImpactTimeCalib | null,
): JetDropTrack[] {
  if (frames.length === 0) return []

  const tracks = new Map<number, JetDropSample[]>()
  let nextId = 1
  const sortBlobs = (blobs: JetBlob[]) => [...blobs].sort((a, b) => a.cx - b.cx || a.cy - b.cy)

  let prevList: { blob: JetBlob; id: number }[] = []

  for (let fi = 0; fi < frames.length; fi++) {
    const fr = frames[fi]!
    const cur = sortBlobs(fr.blobs)
    const timeSec = fr.frameIndex / Math.max(1e-6, physicsHz)

    if (fi === 0) {
      prevList = cur.map((blob) => {
        const id = nextId++
        const sample = blobToSample(fr.frameIndex, timeSec, blob, mmPerPx, surfaceYPx)
        tracks.set(id, [sample])
        return { blob, id }
      })
      continue
    }

    const pairs: { pi: number; qi: number; d2: number }[] = []
    for (let pi = 0; pi < prevList.length; pi++) {
      for (let qi = 0; qi < cur.length; qi++) {
        pairs.push({ pi, qi, d2: dist2(prevList[pi]!.blob, cur[qi]!) })
      }
    }
    pairs.sort((a, b) => a.d2 - b.d2)
    const prevUsed = new Set<number>()
    const nextUsed = new Set<number>()
    const qiToId = new Map<number, number>()

    for (const { pi, qi } of pairs) {
      if (prevUsed.has(pi) || nextUsed.has(qi)) continue
      const id = prevList[pi]!.id
      prevUsed.add(pi)
      nextUsed.add(qi)
      qiToId.set(qi, id)
    }

    const newPrevList: { blob: JetBlob; id: number }[] = []
    for (let qi = 0; qi < cur.length; qi++) {
      const blob = cur[qi]!
      let id = qiToId.get(qi)
      if (id == null) {
        id = nextId++
      }
      const sample = blobToSample(fr.frameIndex, timeSec, blob, mmPerPx, surfaceYPx)
      if (!tracks.has(id)) tracks.set(id, [])
      tracks.get(id)!.push(sample)
      newPrevList.push({ blob, id })
    }
    prevList = newPrevList
  }

  return [...tracks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, samples]) => ({
      id,
      samples: postprocessJetEtaBeta(
        postprocessJetBallisticVelocityAndEk(
          [...samples].sort((a, b) => a.frameIndex - b.frameIndex),
          impactTimeCalib ?? null,
          fluidDensityKgM3,
        ),
        macroEnergy ?? null,
      ),
    }))
}

export type JetExportTimeCalib = JetImpactTimeCalib

export function exportJetDynamicsCsv(
  tracks: JetDropTrack[],
  sampleLabel: string,
  timeCalib?: JetExportTimeCalib | null,
): void {
  const lines: string[] = []
  lines.push('# Jet dynamics export')
  if (timeCalib) {
    lines.push(
      '# t_ms = (T_seek(frame) - t0) * (fe/fs) * 1000; T_seek = (frame+0.5)/fe clamped to duration; t0 = impact zero from sidebar; fe=export fps; fs=sampling fps.',
    )
  } else {
    lines.push('# t_ms = frame * (1000/fs) legacy axis (not impact-referenced)')
  }
  lines.push(
    '# Ellipse LS: z_c=center height mm. v_jet=constant from Z–t LSQ slope (mm/s). ek_J=1/2*rho*<vol>*v^2 with <vol>=mean(vol_mm3). eta=E_k/E_in, beta=(v/U0)^2.',
  )
  lines.push(
    '# macro: E_in = 1/2*rho*(4/3*pi*R0^3)*U0^2 + sigma*(4*pi*R0^2) J; R0=D0/2 m; D0_mm, rho, sigma, U0_m/s from sidebar / impact velocity.',
  )
  for (const tr of tracks) {
    lines.push(`# Drop_${tr.id}`)
    lines.push(
      'frame,t_ms,z_c_mm,v_jet_mm_s,area_mm2,vol_mm3,aspect_ratio,a_mm,b_mm,phi_rad,ek_J,eta,beta',
    )
    for (const s of tr.samples) {
      const tms =
        timeCalib != null
          ? jetCalibratedTimeMs(
              s.frameIndex,
              timeCalib.exportedFps,
              timeCalib.samplingFps,
              timeCalib.zeroTimeSec,
              timeCalib.durationSec,
            )
          : s.timeSec * 1000
      lines.push(
        [
          s.frameIndex,
          tms.toFixed(4),
          s.zTipMm != null ? s.zTipMm.toFixed(6) : '',
          s.vJetMmPerS != null ? s.vJetMmPerS.toFixed(6) : '',
          s.areaDropMm2.toFixed(8),
          s.volMm3.toFixed(10),
          s.aspectRatio.toFixed(6),
          s.ellipseSemiMajorMm != null ? s.ellipseSemiMajorMm.toFixed(8) : '',
          s.ellipseSemiMinorMm != null ? s.ellipseSemiMinorMm.toFixed(8) : '',
          s.ellipsePhiRad != null ? s.ellipsePhiRad.toFixed(8) : '',
          s.ekJoule != null && Number.isFinite(s.ekJoule) ? s.ekJoule.toExponential(6) : '',
          s.efficiencyEta != null && Number.isFinite(s.efficiencyEta) ? s.efficiencyEta.toExponential(10) : '',
          s.amplificationBeta != null && Number.isFinite(s.amplificationBeta)
            ? s.amplificationBeta.toExponential(10)
            : '',
        ].join(','),
      )
    }
    lines.push('')
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `jet-dynamics-${(sampleLabel || 'export').replace(/[^\w\-]+/g, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
