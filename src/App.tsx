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
import { TARGET_RING_R, draw } from './marble/render'
import { createTrip, grade, tripScore, updateTrip } from './marble/score'
import { buildFrame, vehicleAccel, type Frame } from './marble/sensors'
import { createStopDetector, feedMotion, isStopped } from './marble/stop'
import { playClang, playDing, ringCrossed, unlockAudio, type RingState } from './marble/sound'
import {
  loadActiveBaseline,
  loadBaselines,
  loadCompare,
  newId,
  recordFromTrip,
  saveActiveBaseline,
  saveBaselines,
  saveCompare,
  storagePersistent,
  type Baseline,
  type DriveRecord,
} from './marble/baseline'
import { HISTORY_MIN_TIME, addDrive, loadHistory, saveHistory } from './marble/history'
import './App.css'

const MAX_TILT_DEG = 25
const DEG = Math.PI / 180
const FOLLOW_TAU = 0.05 // s, how quickly the dish follows a drag
const RETURN_TAU = 0.35 // s, easing back to level after a drag is released
const ACCEL_TAU = 0.15 // s, low-pass on the projected vehicle acceleration
const CALIBRATE_MS = 1000

type PermissionCtor = { requestPermission?: () => Promise<'granted' | 'denied'> }
type MotionStatus = 'unsupported' | 'insecure' | 'idle' | 'active' | 'denied'

const clampDeg = (d: number) => Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, d))
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const fmtDate = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
const fmtDiff = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0')
const fmtWorst = (d: DriveRecord) => `${d.worstScore.toFixed(0)} @ ${fmtTime(d.worstTime)}`
const fmtDepth = (depth: number) => `${Math.round(depth * 100)}%`

function initialMotionStatus(): MotionStatus {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'unsupported'
  if (!window.isSecureContext) return 'insecure'
  return 'idle'
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
  stopped: boolean
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
  const stopDet = useRef(createStopDetector())
  const ring = useRef<RingState>({ inside: null })

  const [motion, setMotion] = useState<MotionStatus>(initialMotionStatus)
  const [calibrating, setCalibrating] = useState(false)
  const [calibrated, setCalibrated] = useState(false)
  const [invert, setInvert] = useState(false)
  const [depth, setDepth] = useState(0.5)
  const depthRef = useRef(depth)
  useEffect(() => {
    depthRef.current = depth
  }, [depth])
  const [soundOn, setSoundOn] = useState(true)
  const soundRef = useRef(soundOn)
  useEffect(() => {
    soundRef.current = soundOn
  }, [soundOn])
  const [hud, setHud] = useState<Hud | null>(null)

  const [lastDrive, setLastDrive] = useState<DriveRecord | null>(null)
  const [baselines, setBaselines] = useState<Baseline[]>(loadBaselines)
  const [activeId, setActiveId] = useState<string | null>(loadActiveBaseline)
  const [compare, setCompare] = useState<boolean>(loadCompare)
  const [history, setHistory] = useState<DriveRecord[]>(loadHistory)
  const [picked, setPicked] = useState<string[]>([])
  const activeBaseline = baselines.find((b) => b.id === activeId) ?? null

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

      // Drag/test mode: dragging = moving, not dragging = stopped.
      const stopped = drag.current ? false : f ? isStopped(stopDet.current, now) : true

      const bowlRadius = bowlRadiusFor(depthRef.current)
      const m = marble.current
      const { hits, impact } = step(m, g, dt, bowlRadius)
      const r = Math.hypot(m.x, m.y)
      const d = Math.min(1, r / MAX_R)
      const live = updateTrip(trip.current, d, hits, dt, stopped)

      const crossed = ringCrossed(ring.current, r, TARGET_RING_R)
      // Sounds follow the marble regardless of stopped state; only the score freezes.
      if (soundRef.current) {
        if (hits > 0) playClang(impact)
        if (crossed) playDing()
      }

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
          stopped,
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
      const rr = e.rotationRate
      const gyro =
        rr?.alpha != null && rr.beta != null && rr.gamma != null ? Math.hypot(rr.alpha, rr.beta, rr.gamma) : null
      feedMotion(stopDet.current, performance.now(), v, gyro)
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

  // Persist saved drives.
  useEffect(() => saveBaselines(baselines), [baselines])
  useEffect(() => saveActiveBaseline(activeId), [activeId])
  useEffect(() => saveCompare(compare), [compare])
  useEffect(() => saveHistory(history), [history])

  // Sensor permission. Must start synchronously inside a user gesture: both iOS
  // requestPermission() calls are issued before any await.
  const motionAsked = useRef(false)
  const enableMotion = useCallback(() => {
    unlockAudio()
    motionAsked.current = true
    if (!('DeviceMotionEvent' in window)) return setMotion('unsupported')
    if (!window.isSecureContext) return setMotion('insecure')
    const ctors = [window.DeviceMotionEvent, window.DeviceOrientationEvent] as PermissionCtor[]
    const asks = ctors.filter((C) => C && typeof C.requestPermission === 'function').map((C) => C.requestPermission!())
    if (asks.length) {
      // iOS Safari: shows the Allow/Deny dialog.
      Promise.all(asks)
        .then((r) => setMotion(r.every((x) => x === 'granted') ? 'active' : 'denied'))
        .catch(() => setMotion('denied'))
      return
    }
    // Android / desktop: no prompt API; check the Permissions API if present.
    const perms = navigator.permissions
    if (perms?.query) {
      Promise.all(
        (['accelerometer', 'gyroscope'] as const).map((n) =>
          perms.query({ name: n as PermissionName }).then((r) => r.state, () => 'granted'),
        ),
      ).then((st) => setMotion(st.includes('denied') ? 'denied' : 'active'))
      return
    }
    setMotion('active')
  }, [])

  // First tap/click anywhere on the page asks once (and unlocks audio).
  useEffect(() => {
    const first = () => {
      unlockAudio()
      if (!motionAsked.current) enableMotion()
    }
    window.addEventListener('pointerdown', first, { once: true, capture: true })
    return () => window.removeEventListener('pointerdown', first, { capture: true })
  }, [enableMotion])

  const resetMarble = () => {
    marble.current = createMarble()
    target.current = { x: 0, y: 0 }
    tilt.current = { x: 0, y: 0 }
    ring.current = { inside: null }
  }

  const setFlat = useCallback(() => {
    unlockAudio()
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
      setLastDrive(null)
      setCalibrated(true)
    }, CALIBRATE_MS)
  }, [invert])

  const reset = () => {
    resetMarble()
    trip.current = createTrip(trip.current.running)
  }

  const toggleTrip = () => {
    unlockAudio()
    const t = trip.current
    if (t.running) {
      t.running = false
      const rec = recordFromTrip(t, depthRef.current)
      setLastDrive(rec)
      if (rec && rec.activeTime > HISTORY_MIN_TIME) setHistory((h) => addDrive(h, rec))
    } else {
      trip.current = createTrip(true)
      setLastDrive(null)
    }
  }

  const toggleSound = (on: boolean) => {
    if (on) unlockAudio()
    setSoundOn(on)
  }

  // Baselines.
  const addBaseline = (rec: DriveRecord) => {
    const name = prompt('Baseline name', `Drive ${fmtDate(rec.date)}`)?.trim()
    if (!name) return
    const b: Baseline = { ...rec, id: newId(), name }
    setBaselines((list) => [...list, b])
    setActiveId(b.id)
  }

  const renameBaseline = () => {
    if (!activeBaseline) return
    const name = prompt('Rename baseline', activeBaseline.name)?.trim()
    if (!name) return
    setBaselines((list) => list.map((b) => (b.id === activeBaseline.id ? { ...b, name } : b)))
  }

  const deleteBaseline = () => {
    if (!activeBaseline || !confirm(`Delete baseline “${activeBaseline.name}”?`)) return
    const rest = baselines.filter((b) => b.id !== activeBaseline.id)
    setBaselines(rest)
    setActiveId(rest[0]?.id ?? null)
  }

  // History.
  const deleteDrive = (id: string) => {
    setHistory((h) => h.filter((d) => d.id !== id))
    setPicked((p) => p.filter((x) => x !== id))
  }

  const togglePick = (id: string, on: boolean) =>
    setPicked((p) => (on ? [...p.filter((x) => x !== id), id].slice(-2) : p.filter((x) => x !== id)))

  const clearHistory = () => {
    if (!confirm('Clear all drive history?')) return
    setHistory([])
    setPicked([])
  }

  // Drag-to-tilt: displacement from the press point maps to tilt.
  const degPerPx = () => {
    const c = canvasRef.current!
    return MAX_TILT_DEG / (Math.min(c.clientWidth, c.clientHeight) * 0.35)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current) return
    unlockAudio()
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
  const pickedDrives = history.filter((d) => picked.includes(d.id)).sort((a, b) => a.date - b.date)

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
            {hud?.running && hud.stopped && <span className="held">Stopped, score held</span>}
          </div>
          {compare && activeBaseline && score != null && hud && (
            <div className="compare">
              {hud.running ? 'Trip' : 'Final'} {Math.round(score)} vs Baseline {Math.round(activeBaseline.score)} (
              {fmtDiff(Math.round(score) - Math.round(activeBaseline.score))}) · Rim hits {hud.rimHits} vs{' '}
              {activeBaseline.rimHits} ({fmtDiff(hud.rimHits - activeBaseline.rimHits)})
              {Math.abs(activeBaseline.depth - depth) > 0.005 && (
                <div className="warn">
                  ⚠ Baseline curvature {fmtDepth(activeBaseline.depth)} ≠ current {fmtDepth(depth)}
                </div>
              )}
            </div>
          )}
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
          {(motion === 'idle' || motion === 'denied') && (
            <button type="button" className="primary" onClick={enableMotion}>
              {motion === 'denied' ? 'Retry motion' : 'Enable motion'}
            </button>
          )}
          <button type="button" onClick={toggleTrip}>
            {hud?.running ? 'Stop trip' : 'Start trip'}
          </button>
          <button type="button" onClick={reset}>
            Reset
          </button>
          {lastDrive && !hud?.running && (
            <button type="button" onClick={() => addBaseline(lastDrive)}>
              Save as baseline
            </button>
          )}
          <label className="check">
            <input type="checkbox" checked={soundOn} onChange={(e) => toggleSound(e.target.checked)} />
            Sound
          </label>
          {calibrated && (
            <label className="check">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              Flip sensor sign
            </label>
          )}
        </div>

        <p className="hint motion-status">
          {motion === 'active'
            ? 'Motion: allowed'
            : motion === 'denied'
              ? 'Motion: denied, enable it in browser settings'
              : motion === 'insecure'
                ? 'Motion: needs HTTPS'
                : motion === 'unsupported'
                  ? 'Motion: not available on this device'
                  : 'Motion: tap anywhere to allow'}
        </p>
        <p className="hint">
          {motion === 'denied'
            ? 'Motion permission denied — drag the bowl to tilt it.'
            : motion === 'unsupported' || motion === 'insecure'
              ? 'No motion sensors — drag the bowl to tilt it.'
              : calibrated
                ? 'Drive smoothly: keep the marble near the centre. Braking rolls it forward, turns roll it outward.'
                : 'Mount the phone, stop the car, then tap Set flat. Or drag the bowl to try it.'}
        </p>

        <details className="drives">
          <summary>Baselines &amp; history</summary>
          {!storagePersistent() && <p className="note">Storage unavailable — drives are kept until the page closes.</p>}

          <div className="row">
            <select
              value={activeBaseline?.id ?? ''}
              onChange={(e) => setActiveId(e.target.value || null)}
              aria-label="Active baseline"
            >
              {baselines.length === 0 && <option value="">No baselines</option>}
              {baselines.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — {b.score.toFixed(0)} {b.grade}
                </option>
              ))}
            </select>
            <button type="button" onClick={renameBaseline} disabled={!activeBaseline}>
              Rename
            </button>
            <button type="button" onClick={deleteBaseline} disabled={!activeBaseline}>
              Delete
            </button>
            <label className="check">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              Compare to baseline
            </label>
          </div>

          <div className="row">
            <strong>History</strong>
            <button type="button" onClick={clearHistory} disabled={history.length === 0}>
              Clear history
            </button>
          </div>

          {pickedDrives.length === 2 && (
            <table className="side">
              <thead>
                <tr>
                  <th />
                  <th>{fmtDate(pickedDrives[0].date)}</th>
                  <th>{fmtDate(pickedDrives[1].date)}</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Score</th>
                  <td>{pickedDrives[0].score.toFixed(0)}</td>
                  <td>{pickedDrives[1].score.toFixed(0)}</td>
                  <td>{fmtDiff(Math.round(pickedDrives[1].score) - Math.round(pickedDrives[0].score))}</td>
                </tr>
                <tr>
                  <th>Rim hits</th>
                  <td>{pickedDrives[0].rimHits}</td>
                  <td>{pickedDrives[1].rimHits}</td>
                  <td>{fmtDiff(pickedDrives[1].rimHits - pickedDrives[0].rimHits)}</td>
                </tr>
                <tr>
                  <th>Worst</th>
                  <td>{fmtWorst(pickedDrives[0])}</td>
                  <td>{fmtWorst(pickedDrives[1])}</td>
                  <td>
                    {fmtDiff(Math.round(pickedDrives[1].worstScore) - Math.round(pickedDrives[0].worstScore))}
                  </td>
                </tr>
                <tr>
                  <th>Time</th>
                  <td>{fmtTime(pickedDrives[0].activeTime)}</td>
                  <td>{fmtTime(pickedDrives[1].activeTime)}</td>
                  <td>{fmtDiff(Math.round(pickedDrives[1].activeTime - pickedDrives[0].activeTime))} s</td>
                </tr>
              </tbody>
            </table>
          )}

          <ul className="history">
            {history.length === 0 && <li className="note">No drives yet (trips over {HISTORY_MIN_TIME} s are saved).</li>}
            {history.map((d) => (
              <li key={d.id}>
                <input
                  type="checkbox"
                  checked={picked.includes(d.id)}
                  onChange={(e) => togglePick(d.id, e.target.checked)}
                  aria-label="Pick for comparison"
                />
                <span className="when">{fmtDate(d.date)}</span>
                <span className="num">{d.score.toFixed(0)}</span>
                <span className={`chip grade-${d.grade}`}>{d.grade}</span>
                <button type="button" onClick={() => addBaseline(d)}>
                  Make baseline
                </button>
                <button type="button" onClick={() => deleteDrive(d.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </details>
      </footer>
    </main>
  )
}

export default App
