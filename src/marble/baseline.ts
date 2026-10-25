// Saved drives: named "perfect drive" baselines, plus the localStorage helpers
// shared with history.ts. Falls back to memory when storage is blocked
// (e.g. file:// in some browsers).

import { grade, tripScore, type Trip } from './score'

export interface DriveRecord {
  id: string
  /** Epoch ms. */
  date: number
  score: number
  grade: string
  rimHits: number
  worstScore: number
  worstTime: number
  /** Seconds of active (non-stopped) driving. */
  activeTime: number
  /** Curvature slider position, 0 (shallow) .. 1 (deep). */
  depth: number
}

export interface Baseline extends DriveRecord {
  name: string
}

let persistent = (() => {
  try {
    const k = '__marble_test__'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
})()
const memory = new Map<string, string>()

export const storagePersistent = () => persistent

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = persistent ? localStorage.getItem(key) : (memory.get(key) ?? null)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function saveJSON(key: string, value: unknown): void {
  const raw = JSON.stringify(value)
  memory.set(key, raw)
  if (!persistent) return
  try {
    localStorage.setItem(key, raw)
  } catch {
    persistent = false
  }
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function recordFromTrip(t: Trip, depth: number): DriveRecord | null {
  const score = tripScore(t)
  if (score == null) return null
  return {
    id: newId(),
    date: Date.now(),
    score,
    grade: grade(score),
    rimHits: t.rimHits,
    worstScore: t.worstScore,
    worstTime: t.worstTime,
    activeTime: t.time,
    depth,
  }
}

const BASELINES_KEY = 'marble.baselines'
const ACTIVE_KEY = 'marble.activeBaseline'
const COMPARE_KEY = 'marble.compareBaseline'

export const loadBaselines = () => loadJSON<Baseline[]>(BASELINES_KEY, [])
export const saveBaselines = (b: Baseline[]) => saveJSON(BASELINES_KEY, b)
export const loadActiveBaseline = () => loadJSON<string | null>(ACTIVE_KEY, null)
export const saveActiveBaseline = (id: string | null) => saveJSON(ACTIVE_KEY, id)
export const loadCompare = () => loadJSON<boolean>(COMPARE_KEY, false)
export const saveCompare = (on: boolean) => saveJSON(COMPARE_KEY, on)
