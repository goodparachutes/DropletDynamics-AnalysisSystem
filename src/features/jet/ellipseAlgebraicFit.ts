/**
 * Direct least-squares ellipse fit (Halír–Flusser / Fitzgibbon family),
 * equivalent in spirit to OpenCV `fitEllipse` algebraic minimization.
 *
 * Conic: a x² + b x y + c y² + d x + e y + f = 0 with ellipse constraint 4ac − b² > 0.
 * Returns semi-axes in **pixels** (a ≥ b), center, rotation φ of semi-major from +x (rad).
 */

export type FittedEllipsePx = {
  cx: number
  cy: number
  /** semi-major (px), ≥ semiMinorPx */
  semiMajorPx: number
  /** semi-minor (px) */
  semiMinorPx: number
  /** rotation of semi-major axis from +x, radians ∈ [0, π) */
  phiRad: number
}

function det3(
  m00: number,
  m01: number,
  m02: number,
  m10: number,
  m11: number,
  m12: number,
  m20: number,
  m21: number,
  m22: number,
): number {
  return (
    m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20)
  )
}

/** Inverse of 3×3 matrix; returns null if singular. */
function inv33(m: number[][]): number[][] | null {
  const det =
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null
  const invDet = 1 / det
  const a00 = (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) * invDet
  const a01 = (m[0]![2]! * m[2]![1]! - m[0]![1]! * m[2]![2]!) * invDet
  const a02 = (m[0]![1]! * m[1]![2]! - m[0]![2]! * m[1]![1]!) * invDet
  const a10 = (m[1]![2]! * m[2]![0]! - m[1]![0]! * m[2]![2]!) * invDet
  const a11 = (m[0]![0]! * m[2]![2]! - m[0]![2]! * m[2]![0]!) * invDet
  const a12 = (m[0]![2]! * m[1]![0]! - m[0]![0]! * m[1]![2]!) * invDet
  const a20 = (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!) * invDet
  const a21 = (m[0]![1]! * m[2]![0]! - m[0]![0]! * m[2]![1]!) * invDet
  const a22 = (m[0]![0]! * m[1]![1]! - m[0]![1]! * m[1]![0]!) * invDet
  return [
    [a00, a01, a02],
    [a10, a11, a12],
    [a20, a21, a22],
  ]
}

function matMul33(a: number[][], b: number[][]): number[][] {
  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0
      for (let k = 0; k < 3; k++) s += a[i]![k]! * b[k]![j]!
      out[i]![j]! = s
    }
  }
  return out
}

/** Real eigenvalues of 3×3 matrix (det(M − λI) = −λ³ + e₁λ² − e₂λ + e₃). */
function eigenvalues3(M: number[][]): number[] {
  const m00 = M[0]![0]!
  const m01 = M[0]![1]!
  const m02 = M[0]![2]!
  const m10 = M[1]![0]!
  const m11 = M[1]![1]!
  const m12 = M[1]![2]!
  const m20 = M[2]![0]!
  const m21 = M[2]![1]!
  const m22 = M[2]![2]!
  const e1 = m00 + m11 + m22
  const e2 =
    m00 * m11 -
    m01 * m10 +
    (m00 * m22 - m02 * m20) +
    (m11 * m22 - m12 * m21)
  const e3 = det3(m00, m01, m02, m10, m11, m12, m20, m21, m22)
  return solveCubicMonic(-e1, e2, -e3)
}

/** Roots of x³ + p2 x² + p1 x + p0 = 0 */
function solveCubicMonic(p2: number, p1: number, p0: number): number[] {
  // Depress: x = t - p2/3  →  t³ + pt + q = 0
  const a = p2
  const p = p1 - (a * a) / 3
  const q = (2 * a * a * a) / 27 - (a * p1) / 3 + p0
  const roots: number[] = []
  const disc = (q * q) / 4 + (p * p * p) / 27
  const offset = -a / 3

  if (Math.abs(p) < 1e-14 && Math.abs(q) < 1e-14) {
    roots.push(offset)
    return roots
  }

  if (disc >= 0) {
    const sd = Math.sqrt(Math.max(0, disc))
    const u = Math.cbrt(-q / 2 + sd)
    const v = Math.cbrt(-q / 2 - sd)
    roots.push(u + v + offset)
    if (Math.abs(disc) < 1e-12) {
      roots.push(-(u + v) / 2 + offset)
      roots.push(-(u + v) / 2 + offset)
    }
  } else {
    const rp = -p / 3
    if (rp <= 0) return roots
    const r = Math.sqrt(rp)
    const ac = Math.acos(Math.max(-1, Math.min(1, (-q / 2) / (r * r * r))))
    for (let k = 0; k < 3; k++) {
      roots.push(2 * r * Math.cos((ac + 2 * Math.PI * k) / 3) + offset)
    }
  }
  return roots.filter((x) => Number.isFinite(x))
}

function nullspaceVector3(M: number[][]): number[] | null {
  // Cross row0 × row1
  const r0 = M[0]!
  const r1 = M[1]!
  const cx = r0[1]! * r1[2]! - r0[2]! * r1[1]!
  const cy = r0[2]! * r1[0]! - r0[0]! * r1[2]!
  const cz = r0[0]! * r1[1]! - r0[1]! * r1[0]!
  const n = Math.hypot(cx, cy, cz)
  if (n < 1e-14) return null
  return [cx / n, cy / n, cz / n]
}

function eigenvectorForLambda(M: number[][], lambda: number): number[] | null {
  const A: number[][] = [
    [M[0]![0]! - lambda, M[0]![1]!, M[0]![2]!],
    [M[1]![0]!, M[1]![1]! - lambda, M[1]![2]!],
    [M[2]![0]!, M[2]![1]!, M[2]![2]! - lambda],
  ]
  let v = nullspaceVector3(A)
  if (!v) {
    const B: number[][] = [
      [A[0]![0]!, A[0]![1]!, A[0]![2]!],
      [A[2]![0]!, A[2]![1]!, A[2]![2]!],
    ]
    const c0 = B[0]![0]! * B[1]![1]! - B[0]![1]! * B[1]![0]!
    const c1 = B[0]![0]! * B[1]![2]! - B[0]![2]! * B[1]![0]!
    const c2 = B[0]![1]! * B[1]![2]! - B[0]![2]! * B[1]![1]!
    const n2 = Math.hypot(c0, c1, c2)
    if (n2 < 1e-14) return null
    v = [c0 / n2, c1 / n2, c2 / n2]
  }
  return v
}

/**
 * Halír–Flusser: returns [a,b,c,d,e,f] for a x² + b x y + c y² + d x + e y + f = 0.
 */
function fitEllipseConicCoeffsHalir(xs: Float64Array, ys: Float64Array): number[] | null {
  const n = xs.length
  if (n < 6) return null

  let s1 = new Float64Array(9).fill(0)
  let s2 = new Float64Array(9).fill(0)
  let s3 = new Float64Array(9).fill(0)

  for (let i = 0; i < n; i++) {
    const x = xs[i]!
    const y = ys[i]!
    const d1 = [x * x, x * y, y * y]
    const d2 = [x, y, 1]
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        s1[r * 3 + c] += d1[r]! * d1[c]!
        s2[r * 3 + c] += d1[r]! * d2[c]!
        s3[r * 3 + c] += d2[r]! * d2[c]!
      }
    }
  }

  const S1: number[][] = [
    [s1[0]!, s1[1]!, s1[2]!],
    [s1[3]!, s1[4]!, s1[5]!],
    [s1[6]!, s1[7]!, s1[8]!],
  ]
  const S2: number[][] = [
    [s2[0]!, s2[1]!, s2[2]!],
    [s2[3]!, s2[4]!, s2[5]!],
    [s2[6]!, s2[7]!, s2[8]!],
  ]
  const S3: number[][] = [
    [s3[0]!, s3[1]!, s3[2]!],
    [s3[3]!, s3[4]!, s3[5]!],
    [s3[6]!, s3[7]!, s3[8]!],
  ]

  const S3i = inv33(S3)
  if (!S3i) return null

  const S2T: number[][] = [
    [S2[0]![0]!, S2[1]![0]!, S2[2]![0]!],
    [S2[0]![1]!, S2[1]![1]!, S2[2]![1]!],
    [S2[0]![2]!, S2[1]![2]!, S2[2]![2]!],
  ]
  const S3iNeg: number[][] = [
    [-S3i[0]![0]!, -S3i[0]![1]!, -S3i[0]![2]!],
    [-S3i[1]![0]!, -S3i[1]![1]!, -S3i[1]![2]!],
    [-S3i[2]![0]!, -S3i[2]![1]!, -S3i[2]![2]!],
  ]
  const T = matMul33(S3iNeg, S2T)
  const S2T_mat = matMul33(S2, T)
  const Msum: number[][] = [
    [S1[0]![0]! + S2T_mat[0]![0]!, S1[0]![1]! + S2T_mat[0]![1]!, S1[0]![2]! + S2T_mat[0]![2]!],
    [S1[1]![0]! + S2T_mat[1]![0]!, S1[1]![1]! + S2T_mat[1]![1]!, S1[1]![2]! + S2T_mat[1]![2]!],
    [S1[2]![0]! + S2T_mat[2]![0]!, S1[2]![1]! + S2T_mat[2]![1]!, S1[2]![2]! + S2T_mat[2]![2]!],
  ]

  const Cq: number[][] = [
    [0, 0, 2],
    [0, -1, 0],
    [2, 0, 0],
  ]
  const Cinv = inv33(Cq)
  if (!Cinv) return null
  const M2 = matMul33(Cinv, Msum)

  const lambdas = eigenvalues3(M2)
  let bestAk: number[] | null = null
  let bestCost = Infinity

  for (const lam of lambdas) {
    const ev = eigenvectorForLambda(M2, lam)
    if (!ev) continue
    const [a, bq, c] = ev
    const con = 4 * a * c - bq * bq
    if (!(con > 0)) continue
    const ak = [a, bq, c]
    const l0 = T[0]![0]! * ak[0]! + T[0]![1]! * ak[1]! + T[0]![2]! * ak[2]!
    const l1 = T[1]![0]! * ak[0]! + T[1]![1]! * ak[1]! + T[1]![2]! * ak[2]!
    const l2 = T[2]![0]! * ak[0]! + T[2]![1]! * ak[1]! + T[2]![2]! * ak[2]!
    const def = [ak[0]!, ak[1]!, ak[2]!, l0, l1, l2]
    const cost = conicAlgebraicCost(xs, ys, def)
    if (cost < bestCost) {
      bestCost = cost
      bestAk = def
    }
  }

  return bestAk
}

function conicAlgebraicCost(xs: Float64Array, ys: Float64Array, coeff: number[]): number {
  const [a, b, c, d, e, f] = coeff
  let s = 0
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!
    const y = ys[i]!
    const v = a * x * x + b * x * y + c * y * y + d * x + e * y + f
    s += v * v
  }
  return s
}

/**
 * Convert conic coefficients (scipython convention) to center, semi-axes, φ.
 * Same normalization as cart_to_pol in scipython blog.
 */
function conicToEllipseParams(coeffs: number[]): FittedEllipsePx | null {
  if (coeffs.length < 6) return null
  const a = coeffs[0]!
  const b = coeffs[1]! / 2
  const c = coeffs[2]!
  const d = coeffs[3]! / 2
  const f = coeffs[4]! / 2
  const g = coeffs[5]!

  const den = b * b - a * c
  if (!Number.isFinite(den) || Math.abs(den) < 1e-14) return null
  if (den > 0) return null

  const x0 = (c * d - b * f) / den
  const y0 = (a * f - b * d) / den

  const num = 2 * (a * f * f + c * d * d + g * b * b - 2 * b * d * f - a * c * g)
  if (!(num > 0) || !(den < 0)) return null
  const fac = Math.hypot(a - c, 2 * b)
  if (!Number.isFinite(fac) || fac < 1e-14) return null

  const inner1 = (num / den) / (fac - a - c)
  const inner2 = (num / den) / (-fac - a - c)
  if (!(inner1 > 0) || !(inner2 > 0)) return null

  let ap = Math.sqrt(inner1)
  let bp = Math.sqrt(inner2)
  let widthGtHeight = true
  if (ap < bp) {
    widthGtHeight = false
    ;[ap, bp] = [bp, ap]
  }

  let phi: number
  if (Math.abs(b) < 1e-14) {
    phi = a < c ? 0 : Math.PI / 2
  } else {
    phi = Math.atan2(2 * b, a - c) / 2
    if (a > c) phi += Math.PI / 2
  }
  if (!widthGtHeight) phi += Math.PI / 2
  phi = ((phi % Math.PI) + Math.PI) % Math.PI

  return { cx: x0, cy: y0, semiMajorPx: ap, semiMinorPx: bp, phiRad: phi }
}

/** Top of ellipse in image coords (y down): min y over dense samples. */
export function ellipseTopYPx(e: FittedEllipsePx): number {
  const { cx, cy, semiMajorPx: a, semiMinorPx: b, phiRad: phi } = e
  let ymin = Infinity
  const n = 128
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    const x = cx + a * Math.cos(t) * Math.cos(phi) - b * Math.sin(t) * Math.sin(phi)
    const y = cy + a * Math.cos(t) * Math.sin(phi) + b * Math.sin(t) * Math.cos(phi)
    void x
    if (y < ymin) ymin = y
  }
  return ymin
}

/** Subsample closed contour (duplicate last≈first) for speed. */
function subsampleContourToArrays(
  pts: ReadonlyArray<{ x: number; y: number }>,
  maxN: number,
): { xs: Float64Array; ys: Float64Array } | null {
  if (pts.length < 6) return null
  const closed = pts.length > 2 && pts[0]!.x === pts[pts.length - 1]!.x && pts[0]!.y === pts[pts.length - 1]!.y
  const innerLen = closed ? pts.length - 1 : pts.length
  const step = Math.max(1, Math.ceil(innerLen / maxN))
  const outLen = Math.max(6, Math.ceil(innerLen / step))
  const xs = new Float64Array(outLen)
  const ys = new Float64Array(outLen)
  let k = 0
  for (let i = 0; i < innerLen && k < outLen; i += step) {
    xs[k] = pts[i]!.x
    ys[k] = pts[i]!.y
    k++
  }
  if (k < 6) return null
  return { xs: xs.subarray(0, k), ys: ys.subarray(0, k) }
}

export function fitEllipseFromContourPx(
  pts: ReadonlyArray<{ x: number; y: number }>,
): FittedEllipsePx | null {
  const pair = subsampleContourToArrays(pts, 400)
  if (!pair) return null
  const coeff = fitEllipseConicCoeffsHalir(pair.xs, pair.ys)
  if (!coeff) return null
  return conicToEllipseParams(coeff)
}
