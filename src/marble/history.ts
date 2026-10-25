// Automatic drive history: every completed trip with enough active driving.

import { loadJSON, saveJSON, type DriveRecord } from './baseline'

export const HISTORY_MAX = 100
export const HISTORY_MIN_TIME = 5 // s of active driving for a trip to be recorded

const HISTORY_KEY = 'marble.history'

export const loadHistory = () => loadJSON<DriveRecord[]>(HISTORY_KEY, [])
export const saveHistory = (h: DriveRecord[]) => saveJSON(HISTORY_KEY, h)

/** Newest first, capped at HISTORY_MAX (oldest dropped). */
export function addDrive(h: DriveRecord[], d: DriveRecord): DriveRecord[] {
  return [d, ...h].slice(0, HISTORY_MAX)
}
