// Smoothness scoring. Position-only, so it is fair across bowl depths.
//
//   d          = clamp(r / MAX_R, 0, 1)          (marble distance / rim travel radius)
//   rimPenalty = 25 · max(0, 1 - tSinceHit / 1s) (linear decay after each rim hit)
//   live       = clamp(100 · (1 - d²) - rimPenalty, 0, 100)
//   trip       = Σ live·dt / Σ dt                (time-weighted mean while running)

export const RIM_PENALTY = 25
export const RIM_PENALTY_DECAY = 1 // seconds

export interface Trip {
  running: boolean
  time: number
  weighted: number
  rimHits: number
  worstScore: number
  worstTime: number
  lastHitAge: number
}

export function createTrip(running = false): Trip {
  return {
    running,
    time: 0,
    weighted: 0,
    rimHits: 0,
    worstScore: 100,
    worstTime: 0,
    lastHitAge: Infinity,
  }
}

export function liveScore(d: number, lastHitAge: number): number {
  const penalty = RIM_PENALTY * Math.max(0, 1 - lastHitAge / RIM_PENALTY_DECAY)
  return Math.min(100, Math.max(0, 100 * (1 - d * d) - penalty))
}

/** Advance by dt; returns the live score for this frame. */
export function updateTrip(t: Trip, d: number, hits: number, dt: number): number {
  t.lastHitAge = hits > 0 ? 0 : t.lastHitAge + dt
  const live = liveScore(d, t.lastHitAge)
  if (t.running && dt > 0) {
    t.rimHits += hits
    t.time += dt
    t.weighted += live * dt
    if (live < t.worstScore) {
      t.worstScore = live
      t.worstTime = t.time
    }
  }
  return live
}

export function tripScore(t: Trip): number | null {
  return t.time > 0 ? t.weighted / t.time : null
}

export function grade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}
