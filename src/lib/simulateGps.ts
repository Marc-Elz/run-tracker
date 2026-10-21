import type { TrackPoint } from '@/lib/geo'

/**
 * Dev-only fake GPS: runs in a circle at roughly 5:30 min/km, one fix per second.
 * Lets the live run screen be exercised in a browser, where there is no real GPS.
 */
export function startGpsSimulation(onPoint: (p: TrackPoint) => void): () => void {
  const centerLat = 52.37
  const centerLon = 4.9
  const radiusDeg = 0.0015 // ~170 m
  const speedMs = 1000 / 330 // 5:30 per km
  const radiusM = radiusDeg * 111_320
  const angularSpeed = speedMs / radiusM // rad per second
  let angle = 0

  const id = setInterval(() => {
    angle += angularSpeed
    onPoint({
      lat: centerLat + radiusDeg * Math.sin(angle),
      lon: centerLon + (radiusDeg * Math.cos(angle)) / Math.cos((centerLat * Math.PI) / 180),
      timestamp: Date.now(),
      accuracy: 5,
    })
  }, 1000)

  return () => clearInterval(id)
}
