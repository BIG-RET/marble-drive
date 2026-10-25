// Marble-in-a-spherical-bowl physics. All units SI (metres, seconds, radians).
//
// Dish frame: origin at the bowl's lowest point, z up, x right, y forward
// (away from the viewer / toward the car's nose). The inner surface is a
// spherical cap of curvature radius `bowlRadius`; the marble's centre therefore
// moves on a concentric sphere of radius bowlRadius - MARBLE_RADIUS. The marble
// is driven by an "effective gravity" vector expressed in the dish frame: real
// gravity plus the inertial (pseudo) acceleration -a_vehicle.

export const G = 9.81
export const RIM_RADIUS = 0.12 // horizontal radius of the rim (in dish frame)
export const MARBLE_RADIUS = 0.009
/** Furthest the marble centre can get from the dish axis (touching the rim wall). */
export const MAX_R = RIM_RADIUS - MARBLE_RADIUS

// Curvature slider range. Smaller curvature radius = deeper bowl = stronger
// restoring force (equilibrium offset r = R·a/g for a steady acceleration a).
export const BOWL_RADIUS_SHALLOW = 1.2
export const BOWL_RADIUS_DEEP = 0.14

const ROLLING_FACTOR = 5 / 7 // solid sphere rolling without slipping: a = 5/7 g sinθ
const ROLLING_RESISTANCE = 0.012 // coefficient of rolling resistance (glass on glazed ceramic-ish)
const LINEAR_DAMPING = 0.35 // 1/s, air drag + surface losses
const RESTITUTION = 0.55 // normal-velocity bounce off the rim
const RIM_FRICTION = 0.85 // tangential velocity kept on rim impact
const HIT_SPEED = 0.04 // m/s normal speed for an impact to count as a rim hit
const SUBSTEP = 1 / 480

export type Vec3 = [number, number, number]

export interface MarbleState {
  x: number
  y: number
  vx: number
  vy: number
}

export interface Tilt {
  /** Rotation that lowers the +x (right) side of the dish (radians). */
  x: number
  /** Rotation that lowers the +y (far) side of the dish (radians). */
  y: number
}

export function createMarble(): MarbleState {
  return { x: 0, y: 0, vx: 0, vy: 0 }
}

/** Map slider position 0 (shallow) .. 1 (deep) to a curvature radius, log-spaced. */
export function bowlRadiusFor(depth: number): number {
  return BOWL_RADIUS_SHALLOW * (BOWL_RADIUS_DEEP / BOWL_RADIUS_SHALLOW) ** depth
}

export function rimHeight(bowlRadius: number): number {
  return bowlRadius - Math.sqrt(bowlRadius ** 2 - RIM_RADIUS ** 2)
}

/** Height of the marble centre above the bowl's lowest point, dish frame. */
export function centreHeight(x: number, y: number, bowlRadius: number): number {
  const p = bowlRadius - MARBLE_RADIUS
  const r2 = Math.min(x * x + y * y, p * p)
  return MARBLE_RADIUS + p - Math.sqrt(p * p - r2)
}

/** Height of the bowl surface at (x, y), dish frame. */
export function surfaceHeight(x: number, y: number, bowlRadius: number): number {
  const r2 = Math.min(x * x + y * y, bowlRadius * bowlRadius)
  return bowlRadius - Math.sqrt(bowlRadius * bowlRadius - r2)
}

/** Gravity in the dish frame when the dish is tilted by `tilt` (world z up). */
export function tiltGravity(tilt: Tilt): Vec3 {
  // Lowering +x by angle a rotates the down vector toward +x, likewise for y.
  const cx = Math.cos(tilt.x)
  const sx = Math.sin(tilt.x)
  const cy = Math.cos(tilt.y)
  const sy = Math.sin(tilt.y)
  return [G * sx, G * cx * sy, -G * cx * cy]
}

/** Returns true if this substep produced a rim impact hard enough to count. */
function substep(m: MarbleState, g: Vec3, dt: number, bowlRadius: number): boolean {
  const p = bowlRadius - MARBLE_RADIUS
  // Inward surface normal at the marble's position (points at sphere centre).
  const cz = centreHeight(m.x, m.y, bowlRadius) - MARBLE_RADIUS
  const nx = -m.x / p
  const ny = -m.y / p
  const nz = (p - cz) / p
  const gn = g[0] * nx + g[1] * ny + g[2] * nz

  // Tangential component of gravity drives rolling.
  let ax = (g[0] - gn * nx) * ROLLING_FACTOR
  let ay = (g[1] - gn * ny) * ROLLING_FACTOR

  // Rolling resistance scales with the normal force (marble pressed into the bowl).
  const speed = Math.hypot(m.vx, m.vy)
  const normalAccel = Math.max(0, -gn) + (speed * speed) / p
  const rr = ROLLING_RESISTANCE * normalAccel
  if (speed > 1e-6) {
    ax -= (rr * m.vx) / speed
    ay -= (rr * m.vy) / speed
  } else {
    // Static: stay put unless the slope beats rolling resistance.
    const am = Math.hypot(ax, ay)
    if (am <= rr) {
      ax = 0
      ay = 0
    } else {
      ax *= (am - rr) / am
      ay *= (am - rr) / am
    }
  }

  const prevVx = m.vx
  const prevVy = m.vy
  m.vx += ax * dt
  m.vy += ay * dt
  // Resistance must not reverse the direction of travel.
  if (speed > 1e-6 && m.vx * prevVx + m.vy * prevVy < 0) {
    m.vx = 0
    m.vy = 0
  }

  const damp = Math.exp(-LINEAR_DAMPING * dt)
  m.vx *= damp
  m.vy *= damp
  m.x += m.vx * dt
  m.y += m.vy * dt

  // Rim collision.
  const r = Math.hypot(m.x, m.y)
  if (r > MAX_R) {
    const ux = m.x / r
    const uy = m.y / r
    m.x = ux * MAX_R
    m.y = uy * MAX_R
    const vn = m.vx * ux + m.vy * uy
    if (vn > 0) {
      const tx = m.vx - vn * ux
      const ty = m.vy - vn * uy
      m.vx = tx * RIM_FRICTION - vn * RESTITUTION * ux
      m.vy = ty * RIM_FRICTION - vn * RESTITUTION * uy
      return vn > HIT_SPEED
    }
  }
  return false
}

/**
 * Advance the simulation by `dt` seconds under effective gravity `g` (dish
 * frame). Returns the number of counted rim hits during the step.
 */
export function step(m: MarbleState, g: Vec3, dt: number, bowlRadius: number): number {
  let hits = 0
  let remaining = Math.min(dt, 0.1) // avoid a huge jump after a background tab
  while (remaining > 1e-9) {
    const h = Math.min(SUBSTEP, remaining)
    if (substep(m, g, h, bowlRadius)) hits++
    remaining -= h
  }
  return hits
}
