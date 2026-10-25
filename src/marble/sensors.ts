// Turning raw DeviceMotion readings into vehicle acceleration in the dish frame.
//
// W3C convention: at rest, accelerationIncludingGravity points *up* (+9.81 on z
// when the phone lies face-up). iOS Safari historically reports the opposite
// sign. We detect the platform sign at calibration time by comparing the
// baseline with the up-vector implied by DeviceOrientation beta/gamma.

import type { Vec3 } from './physics'

export interface Frame {
  /** Gravity baseline in raw device coordinates (as reported). */
  baseline: Vec3
  /** +1 if readings follow the W3C sign convention, -1 if inverted. */
  sign: number
  right: Vec3
  forward: Vec3
  up: Vec3
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const unit = (a: Vec3): Vec3 => scale(a, 1 / (norm(a) || 1))

export function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
}

/** Up vector in device coordinates implied by DeviceOrientation beta/gamma (degrees). */
export function upFromOrientation(beta: number, gamma: number): Vec3 {
  const b = (beta * Math.PI) / 180
  const g = (gamma * Math.PI) / 180
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)]
}

/**
 * Build a rotation frame aligned to the resting orientation.
 * up      = measured gravity direction (sign-corrected)
 * right   = the screen's horizontal axis (up × screen normal), so a phone mounted
 *           upright in portrait or landscape facing the driver maps to car right;
 *           falls back to the device x axis when the phone lies flat.
 * forward = up × right (out of the back of an upright phone = car forward).
 */
export function buildFrame(
  baseline: Vec3,
  orientation: { beta: number; gamma: number } | null,
  invert: boolean,
): Frame {
  let sign = isIOS() ? -1 : 1
  if (orientation) {
    const c = dot(unit(baseline), upFromOrientation(orientation.beta, orientation.gamma))
    if (Math.abs(c) > 0.5) sign = Math.sign(c)
  }
  if (invert) sign = -sign

  const up = unit(scale(baseline, sign))
  let right = cross(up, [0, 0, 1])
  if (norm(right) < 0.35) {
    // Nearly flat: project device x onto the horizontal plane instead.
    right = sub([1, 0, 0], scale(up, up[0]))
  }
  right = unit(right)
  const forward = unit(cross(up, right))
  return { baseline, sign, right, forward, up }
}

/** Vehicle acceleration (m/s²) in the dish frame: [right, forward, up]. */
export function vehicleAccel(frame: Frame, raw: Vec3): Vec3 {
  const a = scale(sub(raw, frame.baseline), frame.sign)
  return [dot(a, frame.right), dot(a, frame.forward), dot(a, frame.up)]
}
