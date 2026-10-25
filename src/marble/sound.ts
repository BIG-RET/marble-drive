// Synthesised sound effects (Web Audio, no files): a metallic clang for rim
// hits and a bell ding when the marble crosses the target ring.

type AudioCtor = typeof AudioContext

const CLANG_FULL_SPEED = 0.6 // m/s impact speed for full clang volume
const CLANG_MIN_GAP = 0.06 // s between clangs
const RING_HYSTERESIS = 0.004 // m, half-width of the dead band around the target ring

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let lastClang = -Infinity

/** Create/resume the AudioContext; call from a user gesture. */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
      if (!C) return
      ctx = new C()
      master = ctx.createGain()
      master.gain.value = 0.7
      master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
    master = null
  }
}

function ready(): { c: AudioContext; out: GainNode } | null {
  return ctx && master && ctx.state === 'running' ? { c: ctx, out: master } : null
}

function partial(c: AudioContext, out: AudioNode, freq: number, gain: number, t0: number, decay: number) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.frequency.value = freq
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
  o.connect(g).connect(out)
  o.start(t0)
  o.stop(t0 + decay + 0.05)
}

/** Metallic clang, volume scaled by rim impact speed (m/s). */
export function playClang(impact: number): void {
  const r = ready()
  if (!r) return
  const { c, out } = r
  const t0 = c.currentTime
  if (t0 - lastClang < CLANG_MIN_GAP) return
  lastClang = t0
  const v = Math.min(1, impact / CLANG_FULL_SPEED)
  const level = 0.06 + 0.6 * v
  // Inharmonic partials of a struck metal plate.
  const f0 = 480 + Math.random() * 60
  const ratios = [1, 2.32, 3.87, 5.43, 7.18]
  const gains = [1, 0.6, 0.45, 0.3, 0.2]
  const decays = [0.7, 0.5, 0.38, 0.27, 0.18]
  ratios.forEach((k, i) => partial(c, out, f0 * k, level * gains[i] * 0.4, t0, decays[i]))

  // Short filtered noise burst for the strike transient.
  if (!noise) {
    noise = c.createBuffer(1, Math.round(c.sampleRate * 0.04), c.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
  }
  const src = c.createBufferSource()
  src.buffer = noise
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3200
  bp.Q.value = 0.8
  const g = c.createGain()
  g.gain.value = level * 0.5
  src.connect(bp).connect(g).connect(out)
  src.start(t0)
}

/** Bright bell ding. */
export function playDing(): void {
  const r = ready()
  if (!r) return
  const { c, out } = r
  const t0 = c.currentTime
  const f0 = 1568 // G6
  const ratios = [1, 2, 2.76, 4.07]
  const gains = [1, 0.35, 0.25, 0.12]
  const decays = [1.4, 0.9, 0.6, 0.35]
  ratios.forEach((k, i) => partial(c, out, f0 * k, 0.22 * gains[i], t0, decays[i]))
}

export interface RingState {
  inside: boolean | null
}

/** True once per crossing of the ring at radius `ringR`, with a small dead band. */
export function ringCrossed(s: RingState, r: number, ringR: number): boolean {
  const side = r < ringR - RING_HYSTERESIS ? true : r > ringR + RING_HYSTERESIS ? false : s.inside
  const crossed = s.inside != null && side != null && side !== s.inside
  s.inside = side
  return crossed
}
