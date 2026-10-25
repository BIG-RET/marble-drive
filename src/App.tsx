import { useCallback, useEffect, useRef, useState } from 'react'
import {
  G,
  MAX_R,
  bowlRadiusFor,
  createMarble,
  step,
  tiltGravity,
  type Tilt,
  type Vec3,
} from './marble/physics'
import { draw } from './marble/render'
import { createTrip, grade, tripScore, updateTrip } from './marble/score'
import { buildFrame, vehicleAccel, type Frame } from './marble/sensors'
import './App.css'

const MAX_TILT_DEG = 25
const DEG = Math.PI / 180
const FOLLOW_TAU = 0.05 // s, how quickly the dish follows a drag
const RETURN_TAU = 0.35 // s, easing back to level after a drag is released
const ACCEL_TAU = 0.15 // s, low-pass on the projected vehicle acceleration
const CALIBRATE_MS = 1000

type PermissionCtor = { requestPermission?: () => Promise<'granted' | 'denied'> }
type MotionStatus = 'unsupported' | 'idle' | 'active' | 'denied'

const clampDeg = (d: number) => Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, d))
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

function initialMotionStatus(): MotionStatus {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window ? 'idle' : 'unsupported'
}

interface Hud {
  tiltX: number
  tiltY: number
  accX: number
  accY: number
  speed: number
  live: number
  trip: number | null
  running: boolean
  time: number
  rimHits: number
  worstScore: number
  worstTime: number
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const marble = useRef(createMarble())
  const trip = useRef(createTrip())
  const tilt = useRef<Tilt>({ x: 0, y: 0 })
  const target = useRef<Tilt>({ x: 0, y: 0 }) // degrees
  const drag = useRef<{ id: number; x0: number; y0: number } | null>(null)
  const rawAccel = useRef<Vec3 | null>(null)
  const orientation = useRef<{ beta: number; gamma: number } | null>(null)
  const frameRef = useRef<Frame | null>(null)
  const accel = useRef<Vec3>([0, 0, 0]) // filtered vehicle accel, dish frame
  const samples = useRef<Vec3[] | null>(null)

  const [motion, setMotion] = useState<MotionStatus>(initialMotionStatus)
  const [calibrating, setCalibrating] = useState(false)
  const [calibrated, setCalibrated] = useState(false)
  const [invert, setInvert] = useState(false)
  const [depth, setDepth] = useState(0.5)
  const depthRef = useRef(depth)
  useEffect(() => {
    depthRef.current = depth
  }, [depth])
  const [hud, setHud] = useState<Hud | null>(null)

  // Animation loop.
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let last = performance.now()
    let hudTimer = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(canvas.clientWidth * dpr)
      canvas.height = Math.round(canvas.clientHeight * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      // Sensor path: residual acceleration projected onto the dish plane, low-passed.
      const f = frameRef.current
      const raw = rawAccel.current
      if (f && raw) {
        const a = vehicleAccel(f, raw)
        const k = 1 - Math.exp(-dt / ACCEL_TAU)
        for (let i = 0; i < 3; i++) accel.current[i] += (a[i] - accel.current[i]) * k
      }

      // Drag path: eases toward the drag target, back to level on release.
      const tau = drag.current ? FOLLOW_TAU : RETURN_TAU
      const kt = 1 - Math.exp(-dt / tau)
      tilt.current.x += (target.current.x * DEG - tilt.current.x) * kt
      tilt.current.y += (target.current.y * DEG - tilt.current.y) * kt

      // Effective gravity in the dish frame: tilt gravity minus vehicle accel
      // (the marble accelerates opposite to the car).
      const g = tiltGravity(tilt.current)
      const useSensor = f && !drag.current
      if (useSensor) {
        g[0] -= accel.current[0]
        g[1] -= accel.current[1]
      }

      const bowlRadius = bowlRadiusFor(depthRef.current)
      const m = marble.current
      const hits = step(m, g, dt, bowlRadius)
      const d = Math.min(1, Math.hypot(m.x, m.y) / MAX_R)
      const live = updateTrip(trip.current, d, hits, dt)

      draw(ctx, canvas.clientWidth, canvas.clientHeight, m, bowlRadius, [g[0], g[1]])

      hudTimer += dt
      if (hudTimer > 0.1) {
        hudTimer = 0
        const t = trip.current
        setHud({
          // Equivalent tilt = direction the marble is being pushed, as an angle.
          tiltX: Math.atan2(g[0], -g[2]) / DEG,
          tiltY: Math.atan2(g[1], -g[2]) / DEG,
          accX: useSensor ? accel.current[0] : -g[0],
          accY: useSensor ? accel.current[1] : -g[1],
          speed: Math.hypot(m.vx, m.vy) * 100,
          live,
          trip: tripScore(t),
          running: t.running,
          time: t.time,
          rimHits: t.rimHits,
          worstScore: t.worstScore,
          worstTime: t.worstTime,
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  // Sensor listeners.
  useEffect(() => {
    if (motion !== 'active') return
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity
      if (a?.x == null || a.y == null || a.z == null) return
      const v: Vec3 = [a.x, a.y, a.z]
      rawAccel.current = v
      samples.current?.push(v)
    }
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return
      orientation.current = { beta: e.beta, gamma: e.gamma }
    }
    window.addEventListener('devicemotion', onMotion)
    window.addEventListener('deviceorientation', onOrient)
    return () => {
      window.removeEventListener('devicemotion', onMotion)
      window.removeEventListener('deviceorientation', onOrient)
    }
  }, [motion])

  // Rebuild the frame if the sign override is toggled after calibration.
  useEffect(() => {
    const f = frameRef.current
    if (f) frameRef.current = buildFrame(f.baseline, orientation.current, invert)
  }, [invert])

  const enableMotion = useCallback(async () => {
    try {
      // iOS 13+: both must be requested from a user gesture.
      for (const Ctor of [window.DeviceMotionEvent, window.DeviceOrientationEvent] as PermissionCtor[]) {
        if (Ctor && typeof Ctor.requestPermission === 'function') {
          if ((await Ctor.requestPermission()) !== 'granted') {
            setMotion('denied')
            return
          }
        }
      }
      setMotion('active')
    } catch {
      setMotion('denied')
    }
  }, [])

  const resetMarble = () => {
    marble.current = createMarble()
    target.current = { x: 0, y: 0 }
    tilt.current = { x: 0, y: 0 }
  }

  const setFlat = useCallback(() => {
    samples.current = []
    setCalibrating(true)
    window.setTimeout(() => {
      const s = samples.current ?? []
      samples.current = null
      setCalibrating(false)
      if (s.length < 5) {
        alert('No motion data received. Tap “Enable motion” first (HTTPS required).')
        return
      }
      const mean: Vec3 = [0, 0, 0]
      for (const v of s) for (let i = 0; i < 3; i++) mean[i] += v[i] / s.length
      if (Math.abs(Math.hypot(...mean) - G) > 2) {
        alert('Phone was moving during calibration — hold still and try again.')
        return
      }
      frameRef.current = buildFrame(mean, orientation.current, invert)
      accel.current = [0, 0, 0]
      resetMarble()
      trip.current = createTrip(true)
      setCalibrated(true)
    }, CALIBRATE_MS)
  }, [invert])

  const reset = () => {
    resetMarble()
    trip.current = createTrip(trip.current.running)
  }

  const toggleTrip = () => {
    const t = trip.current
    if (t.running) t.running = false
    else trip.current = createTrip(true)
  }

  // Drag-to-tilt: displacement from the press point maps to tilt.
  const degPerPx = () => {
    const c = canvasRef.current!
    return MAX_TILT_DEG / (Math.min(c.clientWidth, c.clientHeight) * 0.35)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const k = degPerPx()
    // Screen up = dish forward (+y), so dragging down lowers the near side.
    target.current = { x: clampDeg((e.clientX - d.x0) * k), y: clampDeg(-(e.clientY - d.y0) * k) }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    target.current = { x: 0, y: 0 }
  }

  const score = hud?.trip ?? null

  return (
    <main className="app">
      <section className="scoreboard">
        <div className={`grade grade-${score == null ? 'none' : grade(score)}`}>
          {score == null ? '–' : grade(score)}
        </div>
        <div className="score-main">
          <div className="score-value">{score == null ? '––' : score.toFixed(1)}</div>
          <div className="score-label">
            Trip score {hud?.running ? `· ${fmtTime(hud.time)}` : '· stopped'}
          </div>
        </div>
        <dl className="score-stats">
          <dt>Live</dt>
          <dd>{hud ? hud.live.toFixed(0) : '–'}</dd>
          <dt>Rim hits</dt>
          <dd>{hud?.rimHits ?? 0}</dd>
          <dt>Worst</dt>
          <dd>{hud && hud.time > 0 ? `${hud.worstScore.toFixed(0)} @ ${fmtTime(hud.worstTime)}` : '–'}</dd>
        </dl>
      </section>

      <canvas
        ref={canvasRef}
        className="stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      <section className="hud">
        <dl>
          <dt>Tilt x/y</dt>
          <dd>
            {(hud?.tiltX ?? 0).toFixed(1)}° / {(hud?.tiltY ?? 0).toFixed(1)}°
          </dd>
          <dt>Accel x/y</dt>
          <dd>
            {(hud?.accX ?? 0).toFixed(2)} / {(hud?.accY ?? 0).toFixed(2)} m/s²
          </dd>
          <dt>Speed</dt>
          <dd>{(hud?.speed ?? 0).toFixed(1)} cm/s</dd>
        </dl>
      </section>

      <footer className="controls">
        <label className="slider">
          <span>Shallow</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            aria-label="Bowl curvature"
          />
          <span>Deep</span>
        </label>

        <button
          type="button"
          className="big"
          onClick={setFlat}
          disabled={calibrating || motion !== 'active'}
        >
          {calibrating ? 'Hold still…' : calibrated ? 'Re-set flat' : 'Set flat'}
        </button>

        <div className="buttons">
          {motion === 'idle' && (
            <button type="button" className="primary" onClick={enableMotion}>
              Enable motion
            </button>
          )}
          <button type="button" onClick={toggleTrip}>
            {hud?.running ? 'Stop trip' : 'Start trip'}
          </button>
          <button type="button" onClick={reset}>
            Reset
          </button>
          {calibrated && (
            <label className="check">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              Flip sensor sign
            </label>
          )}
        </div>

        <p className="hint">
          {motion === 'denied'
            ? 'Motion permission denied — drag the bowl to tilt it.'
            : motion === 'unsupported'
              ? 'No motion sensors — drag the bowl to tilt it.'
              : calibrated
                ? 'Drive smoothly: keep the marble near the centre. Braking rolls it forward, turns roll it outward.'
                : 'Mount the phone, stop the car, then tap Set flat. Or drag the bowl to try it.'}
        </p>
      </footer>
    </main>
  )
}

export default App
