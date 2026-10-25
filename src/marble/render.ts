// 2.5D canvas rendering of the dish and marble. Oblique view from ELEVATION
// above the horizon: dish y (forward) is foreshortened by sin(elev) and height
// z lifts points up the screen by cos(elev). Light comes from the upper left.

import {
  MARBLE_RADIUS,
  RIM_RADIUS,
  centreHeight,
  rimHeight,
  surfaceHeight,
  type MarbleState,
} from './physics'

const ELEVATION = (58 * Math.PI) / 180
const KY = Math.sin(ELEVATION)
const KZ = Math.cos(ELEVATION)
const BANDS = 14

interface View {
  cx: number
  cy: number
  s: number
}

function project(v: View, x: number, y: number, z: number): [number, number] {
  return [v.cx + x * v.s, v.cy - y * v.s * KY - z * v.s * KZ]
}

function ellipseAt(ctx: CanvasRenderingContext2D, v: View, r: number, z: number) {
  const [x, y] = project(v, 0, 0, z)
  ctx.beginPath()
  ctx.ellipse(x, y, r * v.s, r * v.s * KY, 0, 0, Math.PI * 2)
}

export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: MarbleState,
  bowlRadius: number,
  drive: [number, number],
) {
  const rimH = rimHeight(bowlRadius)
  const s = Math.min(w / (2 * RIM_RADIUS * 1.25), h / (2 * RIM_RADIUS * KY * 1.25 + rimH * KZ * 2))
  const v: View = { cx: w / 2, cy: h / 2 + rimH * s * KZ * 0.5, s }

  ctx.clearRect(0, 0, w, h)

  // Table shadow under the dish.
  const [bx, by] = project(v, 0, 0, 0)
  const shadow = ctx.createRadialGradient(bx + 10, by + 14, 0, bx + 10, by + 14, RIM_RADIUS * s * 1.25)
  shadow.addColorStop(0, 'rgba(0,0,0,0.45)')
  shadow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.ellipse(bx + 10, by + 14, RIM_RADIUS * s * 1.25, RIM_RADIUS * s * KY * 1.25, 0, 0, Math.PI * 2)
  ctx.fill()

  // Outer wall: from the rim down to a foot ring, visible on the near side.
  const footR = RIM_RADIUS * 0.6
  const [rx0, ry0] = project(v, 0, 0, rimH)
  const [fx0, fy0] = project(v, 0, 0, -0.012)
  const wall = ctx.createLinearGradient(v.cx - RIM_RADIUS * s, 0, v.cx + RIM_RADIUS * s, 0)
  wall.addColorStop(0, '#c9d4e3')
  wall.addColorStop(0.5, '#8d9bb0')
  wall.addColorStop(1, '#4a5568')
  ctx.fillStyle = wall
  ctx.beginPath()
  ctx.ellipse(rx0, ry0, RIM_RADIUS * s, RIM_RADIUS * s * KY, 0, 0, Math.PI)
  ctx.ellipse(fx0, fy0, footR * s, footR * s * KY, 0, Math.PI, 0, true)
  ctx.closePath()
  ctx.fill()

  // Inner surface: concentric bands at equal height steps, so ring spacing
  // follows the actual curvature. Each band is shaded by its slope: the far
  // wall faces the light/viewer, the near wall falls into shade.
  for (let i = BANDS; i >= 1; i--) {
    const z = (rimH * i) / BANDS
    const r = i === BANDS ? RIM_RADIUS : Math.sqrt(Math.max(0, 2 * bowlRadius * z - z * z))
    const slope = r / bowlRadius // sin of the wall angle
    const [, ty] = project(v, 0, r, z)
    const [, ny] = project(v, 0, -r, z)
    const g = ctx.createLinearGradient(v.cx - r * s * 0.7, ty, v.cx + r * s * 0.7, ny)
    const lit = 70 + 22 * slope
    const dark = 62 - 34 * slope
    g.addColorStop(0, `hsl(212 38% ${lit}%)`)
    g.addColorStop(1, `hsl(216 30% ${dark}%)`)
    ctx.fillStyle = g
    ellipseAt(ctx, v, r, z)
    ctx.fill()
    ctx.strokeStyle = `rgba(30,40,60,${0.05 + 0.12 * slope})`
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // Glaze sheen in the bottom of the bowl.
  const [c0x, c0y] = project(v, -RIM_RADIUS * 0.25, RIM_RADIUS * 0.2, 0)
  const sheen = ctx.createRadialGradient(c0x, c0y, 0, c0x, c0y, RIM_RADIUS * s * 0.6)
  sheen.addColorStop(0, 'rgba(255,255,255,0.28)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ellipseAt(ctx, v, RIM_RADIUS, rimH)
  ctx.fill()

  // Target rings (d = 0.5) and centre mark.
  ctx.setLineDash([4, 5])
  ctx.strokeStyle = 'rgba(20,90,60,0.45)'
  const rh = RIM_RADIUS * 0.5
  ellipseAt(ctx, v, rh, surfaceHeight(rh, 0, bowlRadius))
  ctx.stroke()
  ctx.setLineDash([])
  const [mx, my] = project(v, 0, 0, 0)
  ctx.strokeStyle = 'rgba(20,40,70,0.5)'
  ctx.beginPath()
  ctx.moveTo(mx - 6, my)
  ctx.lineTo(mx + 6, my)
  ctx.moveTo(mx, my - 6 * KY)
  ctx.lineTo(mx, my + 6 * KY)
  ctx.stroke()

  // Drive arrow: direction the marble is being pushed (inertial acceleration).
  const dl = Math.hypot(drive[0], drive[1])
  if (dl > 0.05) {
    const k = Math.min(1, dl / 4) * RIM_RADIUS * 0.8
    const [ax, ay] = project(v, (drive[0] / dl) * k, (drive[1] / dl) * k, 0)
    ctx.strokeStyle = 'rgba(220,80,40,0.7)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(mx, my)
    ctx.lineTo(ax, ay)
    ctx.stroke()
    ctx.lineWidth = 1
  }

  // Rim lip.
  ellipseAt(ctx, v, RIM_RADIUS, rimH)
  const lip = ctx.createLinearGradient(v.cx - RIM_RADIUS * s, ry0 - RIM_RADIUS * s * KY, v.cx + RIM_RADIUS * s, ry0 + RIM_RADIUS * s * KY)
  lip.addColorStop(0, '#ffffff')
  lip.addColorStop(0.5, '#b6c2d4')
  lip.addColorStop(1, '#5d6b80')
  ctx.strokeStyle = lip
  ctx.lineWidth = Math.max(3, s * 0.006)
  ctx.stroke()
  ctx.lineWidth = 1

  // Marble contact shadow, cast on the surface down-right of the marble.
  const mr = MARBLE_RADIUS * s
  const sz = surfaceHeight(m.x, m.y, bowlRadius)
  const [sx, sy] = project(v, m.x + MARBLE_RADIUS * 0.6, m.y - MARBLE_RADIUS * 0.4, sz)
  const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, mr * 1.3)
  sg.addColorStop(0, 'rgba(10,15,30,0.55)')
  sg.addColorStop(1, 'rgba(10,15,30,0)')
  ctx.fillStyle = sg
  ctx.beginPath()
  ctx.ellipse(sx, sy, mr * 1.3, mr * 1.3 * KY, 0, 0, Math.PI * 2)
  ctx.fill()

  // Marble body with diffuse falloff, specular highlight and rim light.
  const [px, py] = project(v, m.x, m.y, centreHeight(m.x, m.y, bowlRadius))
  const body = ctx.createRadialGradient(px - mr * 0.35, py - mr * 0.4, mr * 0.1, px, py, mr)
  body.addColorStop(0, '#ff9a8a')
  body.addColorStop(0.45, '#e0322b')
  body.addColorStop(0.9, '#6e0d0d')
  body.addColorStop(1, '#3a0505')
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(px, py, mr, 0, Math.PI * 2)
  ctx.fill()

  const spec = ctx.createRadialGradient(px - mr * 0.38, py - mr * 0.42, 0, px - mr * 0.38, py - mr * 0.42, mr * 0.35)
  spec.addColorStop(0, 'rgba(255,255,255,0.95)')
  spec.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = spec
  ctx.beginPath()
  ctx.arc(px - mr * 0.38, py - mr * 0.42, mr * 0.35, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(255,200,190,0.35)'
  ctx.lineWidth = Math.max(1, mr * 0.08)
  ctx.beginPath()
  ctx.arc(px, py, mr * 0.92, Math.PI * 0.15, Math.PI * 0.75)
  ctx.stroke()
  ctx.lineWidth = 1
}
