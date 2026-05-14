import type { ContactAngleFitGeometry } from './contactAngle'

function angleBetweenUnit(
  u: { x: number; y: number },
  v: { x: number; y: number },
): number {
  const c = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))
  return Math.acos(c)
}

/**
 * 由 Young θ（°）得到气–液界面「指向液相」的单位方向（画布 y 向下）。
 * 与数值 θ 在几何上一致：界面射线与固面「指向液滴」射线夹角等于 θ（液相内侧），而非补角。
 */
export function interfaceIntoLiquidFromAngleDeg(side: 'left' | 'right', angleDeg: number): { x: number; y: number } {
  const θ = (Math.PI / 180) * angleDeg
  const vx = side === 'left' ? Math.cos(θ) : -Math.cos(θ)
  const vy = -Math.sin(θ)
  const len = Math.hypot(vx, vy)
  if (len < 1e-9) return { x: 0, y: -1 }
  return { x: vx / len, y: vy / len }
}

/**
 * 回归给出的切向只有轴向二义性；取与 Young θ（液相内侧）一致的一支，避免扇形/彩色射线画成锐角而标注钝角。
 */
export function chooseInterfaceIntoLiquidForYoungAngle(
  side: 'left' | 'right',
  solidIntoLiquid: { x: number; y: number },
  candidate: { x: number; y: number },
  thetaDeg: number,
): { x: number; y: number } {
  const θ = (Math.PI / 180) * thetaDeg
  const len = Math.hypot(candidate.x, candidate.y)
  if (len < 1e-9) return interfaceIntoLiquidFromAngleDeg(side, thetaDeg)
  const v1 = { x: candidate.x / len, y: candidate.y / len }
  const v2 = { x: -v1.x, y: -v1.y }
  const e1 = Math.abs(angleBetweenUnit(solidIntoLiquid, v1) - θ)
  const e2 = Math.abs(angleBetweenUnit(solidIntoLiquid, v2) - θ)
  if (Math.abs(e1 - e2) < 1e-3) {
    const preferLiquidUp = (q: { x: number; y: number }) => q.y < 0
    if (preferLiquidUp(v1) !== preferLiquidUp(v2)) return preferLiquidUp(v1) ? v1 : v2
  }
  return e1 <= e2 ? v1 : v2
}

/** 在画布上绘制单侧接触角拟合示意：回归点、拟合直线、固面射线、界面切线、液相内夹角扇形 */
export function drawContactAngleFitOverlay(
  ctx: CanvasRenderingContext2D,
  surfaceY: number,
  footX: number,
  geom: ContactAngleFitGeometry,
  side: 'left' | 'right',
  theme: { accent: string; accentMuted: string },
  scale: number,
  /** 与序列中 θ 一致（含「接触角修正」后）；用于扇形与彩色界面射线、θ 标注 */
  displayAngleDeg?: number | null,
  /** 是否在扇形旁标注 θ（°） */
  showAngleLabel = true,
): void {
  const { p, dxDy, band, solidIntoLiquid } = geom

  const thetaForRay =
    displayAngleDeg != null && Number.isFinite(displayAngleDeg) ? displayAngleDeg : geom.angleDeg

  const interfaceIntoLiquid =
    displayAngleDeg != null && Number.isFinite(displayAngleDeg)
      ? interfaceIntoLiquidFromAngleDeg(side, displayAngleDeg)
      : chooseInterfaceIntoLiquidForYoungAngle(side, solidIntoLiquid, geom.interfaceIntoLiquid, thetaForRay)

  const angleLabelDeg =
    displayAngleDeg != null && Number.isFinite(displayAngleDeg) ? displayAngleDeg : geom.angleDeg

  /** 虚线回归线与 θ 一致：有 displayAngle 时用该角反推 q，并让直线过触点 */
  let lineP = p
  let lineQ = dxDy
  if (displayAngleDeg != null && Number.isFinite(displayAngleDeg)) {
    const θ = (Math.PI / 180) * displayAngleDeg
    lineQ = side === 'left' ? Math.tan(θ - Math.PI / 2) : Math.tan(Math.PI / 2 - θ)
    lineP = footX - lineQ * surfaceY
  }

  const lw = Math.max(1.2, scale / 500)
  const raySolid = Math.max(36, scale / 22)
  const rayIface = Math.max(48, scale / 18)
  const arcR = Math.max(22, Math.min(44, scale / 32))

  ctx.save()

  ctx.fillStyle = 'rgba(248, 250, 252, 0.78)'
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)'
  ctx.lineWidth = lw * 0.8
  for (const q of band) {
    ctx.beginPath()
    ctx.arc(q.x, q.y, Math.max(2, lw * 2), 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  if (band.length >= 2) {
    let yMin = band[0].y
    let yMax = band[0].y
    for (const q of band) {
      yMin = Math.min(yMin, q.y)
      yMax = Math.max(yMax, q.y)
    }
    const x1 = lineP + lineQ * yMin
    const x2 = lineP + lineQ * yMax
    ctx.beginPath()
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = lw * 2
    ctx.setLineDash([7, 5])
    ctx.globalAlpha = 0.95
    ctx.moveTo(x1, yMin)
    ctx.lineTo(x2, yMax)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  const sx = footX + solidIntoLiquid.x * raySolid
  const sy = surfaceY + solidIntoLiquid.y * raySolid
  const ix = footX + interfaceIntoLiquid.x * rayIface
  const iy = surfaceY + interfaceIntoLiquid.y * rayIface

  const as = Math.atan2(solidIntoLiquid.y, solidIntoLiquid.x)
  const ai = Math.atan2(interfaceIntoLiquid.y, interfaceIntoLiquid.x)

  let delta = ai - as
  while (delta <= -Math.PI) delta += 2 * Math.PI
  while (delta > Math.PI) delta -= 2 * Math.PI

  let mid = as + delta / 2
  let my = surfaceY + Math.sin(mid) * arcR
  // 夹角扇形应主要在液相一侧（图像上方，y 更小）
  if (my >= surfaceY - 4) {
    delta = delta > 0 ? delta - 2 * Math.PI : delta + 2 * Math.PI
    mid = as + delta / 2
    my = surfaceY + Math.sin(mid) * arcR
  }

  ctx.beginPath()
  ctx.moveTo(footX, surfaceY)
  ctx.arc(footX, surfaceY, arcR, as, as + delta, delta < 0)
  ctx.closePath()
  ctx.fillStyle = theme.accentMuted
  ctx.globalAlpha = 1
  ctx.fill()
  ctx.strokeStyle = theme.accent
  ctx.lineWidth = Math.max(lw * 1.6, 2)
  ctx.stroke()

  ctx.beginPath()
  ctx.strokeStyle = '#f8fafc'
  ctx.lineWidth = lw * 2.5
  ctx.setLineDash([4, 3])
  ctx.moveTo(footX, surfaceY)
  ctx.lineTo(sx, sy)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.beginPath()
  ctx.strokeStyle = theme.accent
  ctx.lineWidth = lw * 2.5
  ctx.moveTo(footX, surfaceY)
  ctx.lineTo(ix, iy)
  ctx.stroke()

  if (showAngleLabel && Number.isFinite(angleLabelDeg)) {
    const bx = solidIntoLiquid.x + interfaceIntoLiquid.x
    const by = solidIntoLiquid.y + interfaceIntoLiquid.y
    const bl = Math.hypot(bx, by)
    if (bl > 1e-6) {
      const ux = bx / bl
      const uy = by / bl
      const tx = footX + ux * (arcR + 26)
      const ty = surfaceY + uy * (arcR + 26)
      const tag = `θ=${angleLabelDeg.toFixed(1)}°`
      ctx.font = `600 ${Math.max(12, scale / 80)}px Inter, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)'
      ctx.strokeText(tag, tx, ty)
      ctx.fillStyle = theme.accent
      ctx.fillText(tag, tx, ty)
    }
  }

  ctx.restore()
}
