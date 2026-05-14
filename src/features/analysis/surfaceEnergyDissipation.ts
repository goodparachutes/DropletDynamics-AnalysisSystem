/**
 * 耗散功 \(W_\mathrm{diss}(t)=E_\mathrm{mech}(0)-(E_k+\Delta E_\sigma)\) 与瞬态耗散功率
 * \(\Phi=\mathrm d W_\mathrm{diss}/\mathrm d t\)（W）。
 * \(E_\mathrm{mech}(0)\) 优先取序列**首帧**；若首帧尚无有效 \(E_k+\Delta E_\sigma\)，则退化为**首个**具备完整机械能的行。
 * 若样本携带可选字段 `emechanicalJ`，则耗散计算以该值为准（覆盖 \(E_k+\Delta E_\sigma\)）。
 * **表面能序列管线**（`computeSurfaceEnergySeries`）仅传入分量、不传该字段，使 \(W_\mathrm{diss}\) 与
 * \(E_k+\Delta E_\sigma+W_\mathrm{diss}\) 校验恒用的分量一致；图上 **E_mech** 仍可单独做单调钳制展示。
 *
 * **算法顺序（能量保真 + 功率降噪）**：
 * ① **能量层**：\(W_\mathrm{diss}=\max(0,\,E_\mathrm{mech}(0)-E_\mathrm{mech}(t))\)，**不**对 \(W\) 做平滑或零点锚定——图上 \(E_k,\Delta E_\sigma,W_\mathrm{diss}\) 与 \(E_\mathrm{total}\) 严格分量闭合。
 * ② **功率层**：对**原始** \(W\) 做中心差分（及首尾单侧差分）得 **raw \(\Phi\)**（允许为负）；再对 \(\Phi\) 序列做 **MA / SG**；最后 **`Math.max(0,\Phi)\)** 输出展示用耗散功率。
 */

import savitzkyGolay from 'ml-savitzky-golay'

/** 对 **raw \(\Phi\)** 滤波的窗宽（奇数，≥3）；MA 与 SG 共用（SG 要求片段长度 ≥ 窗宽） */
export const DISSIPATION_WDISS_SMOOTH_WINDOW_DEFAULT = 7

/** SG 默认多项式阶数（须 \< 窗宽） */
export const DISSIPATION_SG_POLYNOMIAL_DEFAULT = 3

export type DissipationSmoothMode = 'ma' | 'sg'

export interface DissipationEnergySample {
  timeMs: number
  ekJ: number | null
  deltaESigmaJ: number | null
  /** 若给定且有限，作为当前 \(E_\mathrm{mech}(t)\) 参与 \(W_\mathrm{diss}\) 与 \(E_\mathrm{mech}(0)\) 参考 */
  emechanicalJ?: number | null
}

export interface DissipationAugmentation {
  /** 参考机械能 \(E_\mathrm{mech}(0)\)：首帧有效则用首帧，否则用首个有效帧 */
  emechanical0J: number | null
  /** 累积耗散功（J）：**原始** \(\max(0,\cdots)\)，不做平滑或锚定 */
  dissipationWorkJ: number | null
  /** \(\Phi\)（J/s = W）：先由原始 \(W\) 差分，再对 \(\Phi\) 做 MA/SG，最后 \(\max(0,\cdot)\) */
  dissipationPowerW: number | null
}

function mechanicalJAtFrame(ekJ: number | null, deltaESigmaJ: number | null): number | null {
  if (ekJ == null || deltaESigmaJ == null) return null
  if (!Number.isFinite(ekJ) || !Number.isFinite(deltaESigmaJ)) return null
  const s = ekJ + deltaESigmaJ
  return Number.isFinite(s) ? s : null
}

function currentMechanicalForDissipation(p: DissipationEnergySample): number | null {
  const em = p.emechanicalJ
  if (em != null && Number.isFinite(em)) return em
  return mechanicalJAtFrame(p.ekJ, p.deltaESigmaJ)
}

function referenceMechanicalJ0(
  points: ReadonlyArray<DissipationEnergySample>,
): number | null {
  if (points.length === 0) return null
  const e0Head = currentMechanicalForDissipation(points[0]!)
  if (e0Head != null) return e0Head
  for (let i = 1; i < points.length; i++) {
    const e = currentMechanicalForDissipation(points[i]!)
    if (e != null) return e
  }
  return null
}

function normalizeOddWindow(windowSize: number): number {
  let w = Math.max(3, Math.round(windowSize))
  if (w % 2 === 0) w += 1
  return w
}

function clampSgPolynomial(polynomialDegree: number, windowSize: number): number {
  let p = Math.round(polynomialDegree)
  return Math.max(1, Math.min(p, windowSize - 2))
}

/** 短片段：不超过 preferredWs 的最大奇数窗（≥3），且不超过片段长度可支持的奇数 */
function oddWindowForShortSegment(segmentLen: number, preferredWs: number): number {
  if (segmentLen <= 0) return 3
  const maxOdd = segmentLen % 2 === 1 ? segmentLen : segmentLen - 1
  const capped = Math.min(preferredWs, Math.max(3, maxOdd))
  return normalizeOddWindow(capped)
}

/**
 * 对称滑动平均：与经典 `smoothArray` 相同的几何窗，但对 `null`/非有限样本跳过，仅对窗内有限值取算术平均；
 * 若窗内无任何有限值则为 `null`。
 */
export function smoothDissipationWorkMovingAverage(
  data: ReadonlyArray<number | null>,
  windowSize: number = DISSIPATION_WDISS_SMOOTH_WINDOW_DEFAULT,
): (number | null)[] {
  const n = data.length
  const ws = normalizeOddWindow(windowSize)
  const half = Math.floor(ws / 2)
  const smoothed: (number | null)[] = []

  for (let i = 0; i < n; i++) {
    let sum = 0
    let count = 0
    for (let j = -half; j <= half; j++) {
      const idx = i + j
      if (idx < 0 || idx >= n) continue
      const v = data[idx]
      if (v != null && Number.isFinite(v)) {
        sum += v
        count++
      }
    }
    smoothed.push(count > 0 ? sum / count : null)
  }

  return smoothed
}

/** 稠密序列 MA 回退；输入全有限，输出同长有限数 */
function smoothDissipationWorkMovingAverageDense(
  segment: ReadonlyArray<number>,
  preferredWs: number,
): number[] {
  const nullable = segment.map((x) => x as number | null)
  const ma = smoothDissipationWorkMovingAverage(nullable, oddWindowForShortSegment(segment.length, preferredWs))
  return ma.map((v, i) => (v != null && Number.isFinite(v) ? v : segment[i]!))
}

function runSavitzkyGolaySegment(
  segment: ReadonlyArray<number>,
  windowSize: number,
  polynomialDegree: number,
): number[] {
  const ws = normalizeOddWindow(windowSize)
  const poly = clampSgPolynomial(polynomialDegree, ws)
  const len = segment.length
  if (len < ws) {
    return smoothDissipationWorkMovingAverageDense([...segment], ws)
  }
  try {
    const y = savitzkyGolay([...segment], 1, {
      windowSize: ws,
      polynomial: poly,
      derivative: 0,
      pad: 'post',
      padValue: 'replicate',
    }) as number[]
    if (y.length !== len) return smoothDissipationWorkMovingAverageDense([...segment], ws)
    return y
  } catch {
    return smoothDissipationWorkMovingAverageDense([...segment], ws)
  }
}

/**
 * **Savitzky–Golay**（derivative=0）：在每一段**连续有限**序列上分别滤波（历史上用于 \(W\)，测试仍覆盖）；片段长度 ≥ 窗宽时用 SG，
 * 否则退化为该段上的滑动平均。`null` 切段保持不变。输出对有限值做 **`Math.max(0,·)`**。
 */
export function smoothDissipationWorkSavitzkyGolay(
  data: ReadonlyArray<number | null>,
  windowSize: number = DISSIPATION_WDISS_SMOOTH_WINDOW_DEFAULT,
  polynomialDegree: number = DISSIPATION_SG_POLYNOMIAL_DEFAULT,
): (number | null)[] {
  const n = data.length
  const out: (number | null)[] = [...data]
  const ws = normalizeOddWindow(windowSize)

  let i = 0
  while (i < n) {
    while (i < n && (data[i] == null || !Number.isFinite(data[i]!))) i++
    if (i >= n) break
    const start = i
    while (i < n && data[i] != null && Number.isFinite(data[i]!)) i++
    const end = i
    const segment = data.slice(start, end) as number[]
    const len = segment.length

    const smoothedSeg =
      len >= ws
        ? runSavitzkyGolaySegment(segment, ws, polynomialDegree)
        : smoothDissipationWorkMovingAverageDense(segment, ws)

    for (let k = 0; k < len; k++) {
      const v = smoothedSeg[k]
      out[start + k] = v != null && Number.isFinite(v) ? Math.max(0, v) : null
    }
  }

  return out
}

/**
 * 对 **\(\Phi\)** 的 SG 平滑（允许中间量为负）；不做 `Math.max(0)`——截断在整条流水线末尾执行。
 */
function smoothPhiSavitzkyGolay(
  data: ReadonlyArray<number | null>,
  windowSize: number = DISSIPATION_WDISS_SMOOTH_WINDOW_DEFAULT,
  polynomialDegree: number = DISSIPATION_SG_POLYNOMIAL_DEFAULT,
): (number | null)[] {
  const n = data.length
  const out: (number | null)[] = [...data]
  const ws = normalizeOddWindow(windowSize)

  let i = 0
  while (i < n) {
    while (i < n && (data[i] == null || !Number.isFinite(data[i]!))) i++
    if (i >= n) break
    const start = i
    while (i < n && data[i] != null && Number.isFinite(data[i]!)) i++
    const end = i
    const segment = data.slice(start, end) as number[]
    const len = segment.length

    const smoothedSeg =
      len >= ws
        ? runSavitzkyGolaySegment(segment, ws, polynomialDegree)
        : smoothDissipationWorkMovingAverageDense(segment, ws)

    for (let k = 0; k < len; k++) {
      const v = smoothedSeg[k]
      out[start + k] = v != null && Number.isFinite(v) ? v : null
    }
  }

  return out
}

/** 由**原始** \(W_\mathrm{diss}\) 差分得到 raw \(\Phi\)（**不**对功率做 `Math.max`）。 */
function assignDissipationPowerRaw(
  wDiss: ReadonlyArray<number | null>,
  timesMs: ReadonlyArray<number>,
): (number | null)[] {
  const n = wDiss.length
  const dissipationPowerW: (number | null)[] = new Array(n).fill(null)

  const phiAt = (dW: number, dtS: number): number | null =>
    dtS > 1e-15 ? dW / dtS : null

  for (let i = 0; i < n; i++) {
    const wi = wDiss[i]
    if (wi == null || !Number.isFinite(wi)) continue

    if (i === 0) {
      if (n >= 2) {
        const w1 = wDiss[1]
        if (w1 != null && Number.isFinite(w1)) {
          dissipationPowerW[i] = phiAt(w1 - wi, (timesMs[1]! - timesMs[0]!) / 1000)
        }
      }
      continue
    }

    if (i === n - 1) {
      const wPrev = wDiss[i - 1]
      if (wPrev != null && Number.isFinite(wPrev)) {
        dissipationPowerW[i] = phiAt(wi - wPrev, (timesMs[i]! - timesMs[i - 1]!) / 1000)
      }
      continue
    }

    const wPrev = wDiss[i - 1]
    const wNext = wDiss[i + 1]
    if (
      wPrev != null &&
      wNext != null &&
      Number.isFinite(wPrev) &&
      Number.isFinite(wNext)
    ) {
      dissipationPowerW[i] = phiAt(wNext - wPrev, (timesMs[i + 1]! - timesMs[i - 1]!) / 1000)
    } else if (wNext != null && Number.isFinite(wNext)) {
      dissipationPowerW[i] = phiAt(wNext - wi, (timesMs[i + 1]! - timesMs[i]!) / 1000)
    } else if (wPrev != null && Number.isFinite(wPrev)) {
      dissipationPowerW[i] = phiAt(wi - wPrev, (timesMs[i]! - timesMs[i - 1]!) / 1000)
    }
  }

  return dissipationPowerW
}

export interface ComputeDissipationSeriesOptions {
  /**
   * `'ma'`：对 **raw \(\Phi\)** 对称滑动平均（默认）；
   * `'sg'`：对 **raw \(\Phi\)** 做 Savitzky–Golay。
   */
  smoothMode?: DissipationSmoothMode
  /** raw \(\Phi\) 滤波窗宽（奇数 ≥3）；MA 与 SG 共用 */
  smoothWindow?: number
  /** SG 多项式阶数，须 \< `smoothWindow`；默认 {@link DISSIPATION_SG_POLYNOMIAL_DEFAULT} */
  sgPolynomialDegree?: number
}

function smoothDissipationPhiSeries(
  phiRaw: ReadonlyArray<number | null>,
  options?: ComputeDissipationSeriesOptions,
): (number | null)[] {
  const smoothWindow = options?.smoothWindow ?? DISSIPATION_WDISS_SMOOTH_WINDOW_DEFAULT
  const mode = options?.smoothMode ?? 'ma'
  if (mode === 'sg') {
    return smoothPhiSavitzkyGolay(
      phiRaw,
      smoothWindow,
      options?.sgPolynomialDegree ?? DISSIPATION_SG_POLYNOMIAL_DEFAULT,
    )
  }
  return smoothDissipationWorkMovingAverage(phiRaw, smoothWindow)
}

/**
 * **零点锚定**：平滑后整条 \(W_\mathrm{diss}\) 减去首索引处的平滑值（边界效应常把原本为 0 的首点拉高）。
 * 若 `w[0]` 为 `null`/非有限，则改用**首个有限**平滑值作为偏移（首帧缺测序列）。
 * `w[0]` 已为 0 时不改动。
 */
export function anchorSmoothedDissipationWorkAtZero(w: (number | null)[]): void {
  if (w.length === 0) return

  let offset: number | null = null
  const head = w[0]
  if (head != null && Number.isFinite(head)) {
    offset = head
  } else {
    for (let i = 0; i < w.length; i++) {
      const v = w[i]
      if (v != null && Number.isFinite(v)) {
        offset = v
        break
      }
    }
  }

  if (offset == null || offset === 0) return

  for (let i = 0; i < w.length; i++) {
    const v = w[i]
    if (v != null && Number.isFinite(v)) {
      w[i] = Math.max(0, v - offset)
    }
  }
}

/**
 * @param points 按时间排序；首元素对应 \(t=0\) 接触时刻（若该帧无能量则参考态顺延至首个有效帧）
 */
export function computeDissipationSeries(
  points: ReadonlyArray<DissipationEnergySample>,
  options?: ComputeDissipationSeriesOptions,
): DissipationAugmentation[] {
  const n = points.length
  if (n === 0) return []

  const eMech0 = referenceMechanicalJ0(points)

  const wRaw: (number | null)[] = points.map((p) => {
    if (eMech0 == null) return null
    const cur = currentMechanicalForDissipation(p)
    if (cur == null) return null
    return Math.max(0, eMech0 - cur)
  })

  const timesMs = points.map((p) => p.timeMs)
  const phiRaw = assignDissipationPowerRaw(wRaw, timesMs)
  const phiSmoothed = smoothDissipationPhiSeries(phiRaw, options)
  const dissipationPowerW = phiSmoothed.map((v) =>
    v != null && Number.isFinite(v) ? Math.max(0, v) : null,
  )

  /** Vitest 里 MODE 为 test；避免 81 条用例刷屏 */
  if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
    for (let i = 0; i < Math.min(10, n); i++) {
      const p = points[i]!
      const ek = p.ekJ
      const es = p.deltaESigmaJ
      const curComp = mechanicalJAtFrame(ek, es)
      const rawWUncapped =
        eMech0 != null && curComp != null && Number.isFinite(eMech0) && Number.isFinite(curComp)
          ? eMech0 - curComp
          : null
      const rawWClamped = rawWUncapped != null ? Math.max(0, rawWUncapped) : null
      const finalW = wRaw[i]
      const sumComp =
        ek != null &&
        es != null &&
        finalW != null &&
        Number.isFinite(ek) &&
        Number.isFinite(es) &&
        Number.isFinite(finalW)
          ? ek + es + finalW
          : null
      const diff = sumComp != null && eMech0 != null ? sumComp - eMech0 : null
      const curField = currentMechanicalForDissipation(p)
      const rawWFromField =
        eMech0 != null && curField != null ? Math.max(0, eMech0 - curField) : null
      console.log(
        `[dissipation probe frame ${i}] diff(E_total vs E0)=${diff != null ? diff.toExponential(2) : '—'} | ` +
          `rawW(compon., uncapped)=${rawWUncapped != null ? rawWUncapped.toExponential(2) : '—'} | ` +
          `rawW(compon., max0)=${rawWClamped != null ? rawWClamped.toExponential(2) : '—'} | ` +
          `rawW(field,max0)=${rawWFromField != null ? rawWFromField.toExponential(2) : '—'} | ` +
          `W_final(raw,max0)=${finalW != null && Number.isFinite(finalW) ? finalW.toExponential(2) : '—'}`,
      )
    }
  }

  return points.map((_, i) => ({
    emechanical0J: eMech0,
    dissipationWorkJ: wRaw[i],
    dissipationPowerW: dissipationPowerW[i],
  }))
}
