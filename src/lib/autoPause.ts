/**
 * Auto-pause (#154): decides from GPS fixes, and from the phone's motion level when there is
 * one, when the runner has stopped and when they move on again. Pure functions, no Vue, like
 * `paceCoach.ts`; the run store does the pausing and `useAutoPause` the speaking.
 *
 * Hold times are measured on one clock: `at`, the phone's `Date.now()` when an input arrived.
 * The fix's own `timestamp` (the GPS clock) is only used for speeds between fixes and for
 * `fromTimestamp`, the start of the movement handed to the store on a resume.
 */
import { distanceMeters, type TrackPoint } from './geo'
import { MAX_ACCURACY_M, MIN_MOVING_SPEED_MPS } from './runStats'

/** Starting values, to tune on real runs */
export const AUTO_PAUSE_CONFIG = {
  /** Slower than this (m/s) counts as standing */
  stopSpeedMps: 0.5,
  /** Standing (or a still phone) for this long pauses the run; short, so the cue is not late */
  stopHoldS: 4,
  /** At least this fast (m/s) counts as moving on */
  resumeSpeedMps: MIN_MOVING_SPEED_MPS,
  /** A resume needs the latest fix this far from where the run stopped, or its accuracy if larger */
  resumeMinM: 10,
  /** Moving on for this long resumes the run */
  resumeHoldS: 3,
  /** Speed from positions is measured over about this long */
  speedWindowS: 3,
  /** No usable fix for this long is "don't know": a hold in progress starts over */
  gapS: 5,
  /** Motion level (m/s², spread of the acceleration) under this is a still phone */
  stillMotion: 0.3,
  /**
   * Motion level over this is a phone carried by someone walking or running. Set low: too high
   * would veto a real resume and keep the run paused, too low only falls back to GPS alone
   */
  movingMotion: 0.5,
  /** A motion level older than this is no signal: GPS decides alone */
  motionStaleS: 3,
}
export type AutoPauseConfig = typeof AUTO_PAUSE_CONFIG

/** Fixed lines with stable keys, so a recorded voice can stand in for them later (#139) */
export const AUTO_PAUSE_PHRASES = {
  stopped: 'Stop detected',
  resumed: 'Resumed',
} as const
export type AutoPausePhrase = keyof typeof AUTO_PAUSE_PHRASES

interface Fix {
  /** Phone clock when it arrived */
  at: number
  point: TrackPoint
}

export interface AutoPauseState {
  /** The detector has paused the run and waits for the movement that resumes it */
  paused: boolean
  /**
   * Moving was seen since the start or the last manual resume. Until then nothing auto-pauses,
   * so standing at the start line or just after Resume never does.
   */
  armed: boolean
  /** Usable fixes of the last few seconds, oldest first */
  fixes: Fix[]
  /** Standing (GPS) since this time */
  slowSince: number | null
  /** The phone has been still since this time */
  stillSince: number | null
  /** Latest motion level and when it came */
  motion: { at: number; level: number } | null
  /** Last usable fix when the run paused: a resume must get away from it */
  stopSpot: TrackPoint | null
  /** Moving on since this time, and the GPS time of the first moving fix */
  moving: { since: number; fromTimestamp: number } | null
}

export type AutoPauseInput =
  { kind: 'fix'; at: number; point: TrackPoint } | { kind: 'motion'; at: number; level: number }

export type AutoPauseEvent = { kind: 'stop' } | { kind: 'resume'; fromTimestamp: number }

export function initAutoPauseState(): AutoPauseState {
  return {
    paused: false,
    armed: false,
    fixes: [],
    slowSince: null,
    stillSince: null,
    motion: null,
    stopSpot: null,
    moving: null,
  }
}

/** Speed from positions: straight line from the oldest fix in the window to the newest */
function positionSpeed(fixes: readonly Fix[], windowS: number): number | null {
  const last = fixes[fixes.length - 1]
  if (!last) return null
  const cutoff = last.point.timestamp - windowS * 1000
  const first = fixes.find((f) => f.point.timestamp >= cutoff)
  if (!first || first === last) return null
  const seconds = (last.point.timestamp - first.point.timestamp) / 1000
  // Too short a span reads any noise as a sprint
  if (seconds < windowS / 2) return null
  return distanceMeters(first.point, last.point) / seconds
}

/** How fast the runner goes now, for stopping: the GPS's own speed when it has one */
function stopSpeed(fixes: readonly Fix[], config: AutoPauseConfig): number | null {
  const doppler = fixes[fixes.length - 1]?.point.speed
  return doppler ?? positionSpeed(fixes, config.speedWindowS)
}

/**
 * How fast the runner goes now, for moving on. The GPS's own speed decides moving or not, as it
 * hardly drifts; positions may only raise it, since it can read slow (#171) and would otherwise
 * hold back a resume at walking speed. Without it, positions decide alone.
 */
function moveSpeed(fixes: readonly Fix[], config: AutoPauseConfig): number | null {
  const doppler = fixes[fixes.length - 1]?.point.speed
  const fromPositions = positionSpeed(fixes, config.speedWindowS)
  if (doppler === undefined) return fromPositions
  if (doppler < config.stopSpeedMps) return doppler
  return Math.max(doppler, fromPositions ?? 0)
}

/**
 * A recent fix whose GPS speed reading says running: a still phone alone does not stop the run
 * then (a phone on a mount or in a pushchair). The reading, not positions, as it hardly drifts.
 * Without that guard the still phone would also veto every resume, and the rest of the run's
 * fixes would be held back.
 */
function gpsSaysMoving(state: AutoPauseState, at: number, config: AutoPauseConfig): boolean {
  const last = state.fixes[state.fixes.length - 1]
  if (!last || at - last.at > config.gapS * 1000) return false
  return (last.point.speed ?? 0) >= config.resumeSpeedMps
}

/** The motion level when it is recent enough to count, else null (no sensor, or it went quiet) */
function freshMotion(state: AutoPauseState, at: number, config: AutoPauseConfig): number | null {
  if (!state.motion || at - state.motion.at > config.motionStaleS * 1000) return null
  return state.motion.level
}

function addFix(fixes: readonly Fix[], next: Fix, config: AutoPauseConfig): Fix[] {
  const keepMs = Math.max(config.speedWindowS, config.stopHoldS) * 1000 * 2
  return [...fixes, next].filter((f) => f.point.timestamp >= next.point.timestamp - keepMs)
}

const usable = (p: TrackPoint) => p.accuracy === undefined || p.accuracy <= MAX_ACCURACY_M

/**
 * Feed one input (a fix or a motion level); returns the next state and `stop`, `resume` or null.
 * Stop: standing (GPS), or a still phone while the GPS speed reading is not at running pace, for
 * `stopHoldS`. Resume: moving (GPS), away from where
 * the run stopped, and the phone not still, for `resumeHoldS`.
 */
export function nextAutoPause(
  prev: AutoPauseState,
  input: AutoPauseInput,
  config: AutoPauseConfig = AUTO_PAUSE_CONFIG,
): { state: AutoPauseState; event: AutoPauseEvent | null } {
  const at = input.at
  let state = prev
  if (input.kind === 'motion') {
    state = { ...state, motion: { at, level: input.level } }
  } else if (usable(input.point)) {
    const last = state.fixes[state.fixes.length - 1]
    // After a gap (a tunnel) the holds start over: no fix is "don't know", never "stopped"
    const gap = last !== undefined && at - last.at > config.gapS * 1000
    state = {
      ...state,
      fixes: addFix(gap ? [] : state.fixes, { at, point: input.point }, config),
      ...(gap ? { slowSince: null, moving: null } : {}),
    }
  } else {
    return { state, event: null }
  }
  return state.paused ? whilePaused(state, input, config) : whileRunning(state, input, config)
}

const num = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? '-' : v.toFixed(digits)

/**
 * One line per fix for `adb logcat`, to tune the thresholds on real runs (#154, #171): what the
 * detector saw (`prev` is the state before the fix, `next` after) and what it decided.
 * `gps` is the GPS speed reading, `pos` the speed from positions, `move` the one a resume uses.
 */
export function describeFix(
  prev: AutoPauseState,
  point: TrackPoint,
  at: number,
  next: AutoPauseState,
  event: AutoPauseEvent | null,
  config: AutoPauseConfig = AUTO_PAUSE_CONFIG,
): string {
  const parts = [
    '[autopause]',
    prev.paused ? 'paused' : 'running',
    `acc=${num(point.accuracy, 0)}`,
    `gps=${num(point.speed)}`,
  ]
  if (!usable(point)) return [...parts, 'poor fix, ignored'].join(' ')
  parts.push(
    `pos=${num(positionSpeed(next.fixes, config.speedWindowS))}`,
    `move=${num(moveSpeed(next.fixes, config))}`,
  )
  if (prev.paused && prev.stopSpot) {
    parts.push(`fromStop=${num(distanceMeters(prev.stopSpot, point), 1)}m`)
  }
  parts.push(`motion=${num(freshMotion(next, at, config))}`, next.armed ? 'armed' : 'unarmed')
  if (event) parts.push(`-> ${event.kind}`)
  return parts.join(' ')
}

function whileRunning(
  state: AutoPauseState,
  input: AutoPauseInput,
  config: AutoPauseConfig,
): { state: AutoPauseState; event: AutoPauseEvent | null } {
  const at = input.at
  const motion = freshMotion(state, at, config)
  // The still hold only counts while the GPS speed reading is not at running pace
  const still = motion !== null && motion < config.stillMotion && !gpsSaysMoving(state, at, config)
  const stillSince = still ? (state.stillSince ?? at) : null
  let { slowSince, armed } = state
  if (input.kind === 'fix') {
    const speed = stopSpeed(state.fixes, config)
    slowSince = speed !== null && speed < config.stopSpeedMps ? (slowSince ?? at) : null
    const moving = moveSpeed(state.fixes, config)
    if (moving !== null && moving >= config.resumeSpeedMps) armed = true
  }
  const next = { ...state, slowSince, stillSince, armed }
  const holdMs = config.stopHoldS * 1000
  const stop =
    armed &&
    ((slowSince !== null && at - slowSince >= holdMs) ||
      (stillSince !== null && at - stillSince >= holdMs))
  if (!stop) return { state: next, event: null }
  return {
    state: {
      ...next,
      paused: true,
      slowSince: null,
      stillSince: null,
      moving: null,
      stopSpot: state.fixes[state.fixes.length - 1]?.point ?? null,
    },
    event: { kind: 'stop' },
  }
}

function whilePaused(
  state: AutoPauseState,
  input: AutoPauseInput,
  config: AutoPauseConfig,
): { state: AutoPauseState; event: AutoPauseEvent | null } {
  const at = input.at
  const motion = freshMotion(state, at, config)
  // A phone that is not shaking vetoes a resume (drift, or the phone handled while standing)
  const phoneMoves = motion === null || motion > config.movingMotion
  if (!phoneMoves) return { state: { ...state, moving: null }, event: null }
  if (input.kind !== 'fix') return { state, event: null }

  const speed = moveSpeed(state.fixes, config)
  if (speed === null || speed < config.resumeSpeedMps) {
    return { state: { ...state, moving: null }, event: null }
  }
  const moving = state.moving ?? { since: at, fromTimestamp: input.point.timestamp }
  const away =
    state.stopSpot === null ||
    distanceMeters(state.stopSpot, input.point) >
      Math.max(config.resumeMinM, input.point.accuracy ?? 0)
  if (!away || at - moving.since < config.resumeHoldS * 1000) {
    return { state: { ...state, moving }, event: null }
  }
  return {
    state: { ...state, paused: false, armed: true, moving: null, stopSpot: null, slowSince: null },
    event: { kind: 'resume', fromTimestamp: moving.fromTimestamp },
  }
}
