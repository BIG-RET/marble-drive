// Detecting that the car is stopped, from a rolling window of
// accelerationIncludingGravity samples (plus rotationRate when available).
//
// A parked car on a hill still reads a constant tilt, but with no variance and
// no jerk, so it counts as stopped. Thresholds have hysteresis: entering the
// stopped state needs every metric below the STOP_* limits for STOP_HOLD_MS;
// leaving it needs any metric above the (higher) MOVE_* limits.

import type { Vec3 } from './physics'

export const STOP_WINDOW_MS = 1000
export const STOP_JERK_MAX = 0.8 // m/s³, sample-to-sample jerk (of the lightly smoothed signal)
export const STOP_STD_MAX = 0.15 // m/s², std of the acceleration vector over the window
export const STOP_GYRO_MAX = 3 // deg/s, only used when rotationRate is reported
export const STOP_HOLD_MS = 1000
export const MOVE_JERK_MIN = 1.2 // m/s³
export const MOVE_STD_MIN = 0.25 // m/s²

const JERK_TAU = 0.2 // s, low-pass before differencing so sensor noise isn't read as jerk
const MAX_GAP_MS = 500 // a sensor gap this long invalidates the window

interface Sample {
  t: number
  a: Vec3
  jerk: number
  /** Rotation rate magnitude (deg/s), or null if unavailable. */
  gyro: number | null
}

export interface StopDetector {
  samples: Sample[]
  smooth: Vec3 | null
  lastT: number
  calmSince: number | null
  stopped: boolean
}

export function createStopDetector(): StopDetector {
  return { samples: [], smooth: null, lastT: -Infinity, calmSince: null, stopped: false }
}

/** Feed one devicemotion sample; `t` in ms (performance.now clock). */
export function feedMotion(s: StopDetector, t: number, a: Vec3, gyro: number | null): void {
  if (t - s.lastT > MAX_GAP_MS) {
    s.samples = []
    s.smooth = null
    s.calmSince = null
  }
  let jerk = 0
  if (s.smooth) {
    const dt = (t - s.lastT) / 1000
    if (dt <= 0) return
    const k = 1 - Math.exp(-dt / JERK_TAU)
    const d: Vec3 = [(a[0] - s.smooth[0]) * k, (a[1] - s.smooth[1]) * k, (a[2] - s.smooth[2]) * k]
    for (let i = 0; i < 3; i++) s.smooth[i] += d[i]
    jerk = Math.hypot(d[0], d[1], d[2]) / dt
  } else {
    s.smooth = [a[0], a[1], a[2]]
  }
  s.lastT = t
  s.samples.push({ t, a, jerk, gyro })
  while (s.samples.length && s.samples[0].t < t - STOP_WINDOW_MS) s.samples.shift()
  evaluate(s, t)
}

function evaluate(s: StopDetector, t: number): void {
  const w = s.samples
  const n = w.length
  const mean: Vec3 = [0, 0, 0]
  for (const p of w) for (let i = 0; i < 3; i++) mean[i] += p.a[i] / n
  let variance = 0
  let maxJerk = 0
  let maxGyro = 0
  for (const p of w) {
    for (let i = 0; i < 3; i++) variance += (p.a[i] - mean[i]) ** 2 / n
    maxJerk = Math.max(maxJerk, p.jerk)
    if (p.gyro != null) maxGyro = Math.max(maxGyro, p.gyro)
  }
  const std = Math.sqrt(variance)
  const last = w[n - 1]

  if (s.stopped) {
    if (last.jerk > MOVE_JERK_MIN || std > MOVE_STD_MIN || (last.gyro ?? 0) > STOP_GYRO_MAX) {
      s.stopped = false
      s.calmSince = null
    }
    return
  }

  const covered = n > 1 && t - w[0].t >= STOP_WINDOW_MS * 0.9
  const calm = covered && maxJerk < STOP_JERK_MAX && std < STOP_STD_MAX && maxGyro < STOP_GYRO_MAX
  if (!calm) {
    s.calmSince = null
    return
  }
  s.calmSince ??= t
  if (t - s.calmSince >= STOP_HOLD_MS) s.stopped = true
}

/** Stopped state at time `now`; a stale sensor stream counts as moving. */
export function isStopped(s: StopDetector, now: number): boolean {
  return s.stopped && now - s.lastT <= MAX_GAP_MS
}
