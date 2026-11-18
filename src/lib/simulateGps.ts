import { ref } from 'vue'
import type { TrackPoint } from '@/lib/geo'
import type { MotionReading } from '@/lib/runPower'

/**
 * "Stand still" on the run screen while GPS is simulated (#154): the runner stops where they
 * are, with the drift a real GPS shows when standing, so auto-pause can be tried in a browser.
 */
export const simulatedStandStill = ref(false)

/** Drift while standing, in metres (north, east): a few metres around the spot */
const DRIFT_M = [
  [0, 0],
  [2, -1],
  [3, 2],
  [-1, 3],
  [-3, -2],
  [1, -3],
]

/**
 * Fake GPS for the browser (dev, and the web demo): runs in a circle at roughly 5:30 min/km,
 * one fix per second, or stands still while `simulatedStandStill` is on.
 */
export function startGpsSimulation(onPoint: (p: TrackPoint) => void): () => void {
  const centerLat = 52.37
  const centerLon = 4.9
  const radiusDeg = 0.0015 // ~170 m
  const speedMs = 1000 / 330 // 5:30 per km
  const radiusM = radiusDeg * 111_320
  const angularSpeed = speedMs / radiusM // rad per second
  const lonScale = Math.cos((centerLat * Math.PI) / 180)
  let angle = 0
  let tick = 0

  const id = setInterval(() => {
    tick++
    const standing = simulatedStandStill.value
    if (!standing) angle += angularSpeed
    const [north, east] = standing ? DRIFT_M[tick % DRIFT_M.length]! : [0, 0]
    onPoint({
      lat: centerLat + radiusDeg * Math.sin(angle) + north! / 111_320,
      lon: centerLon + (radiusDeg * Math.cos(angle)) / lonScale + east! / (111_320 * lonScale),
      timestamp: Date.now(),
      accuracy: standing ? 15 + (tick % 6) : 5,
      speed: standing ? 0 : speedMs,
    })
  }, 1000)

  return () => clearInterval(id)
}

/**
 * The motion level to go with the fake GPS (#154): a phone carried by a runner, or one held still
 * while "Stand still" is on. One reading a second, like the phone's.
 */
export function watchSimulatedMotion(onReading: (reading: MotionReading) => void): () => void {
  let tick = 0
  const id = setInterval(() => {
    tick++
    const level = simulatedStandStill.value ? 0.05 + (tick % 3) * 0.02 : 3 + (tick % 4) * 0.5
    onReading({ at: Date.now(), level, samples: 50 })
  }, 1000)
  return () => clearInterval(id)
}
