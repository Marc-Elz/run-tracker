export interface TrackPoint {
  lat: number
  lon: number
  /** Unix epoch milliseconds */
  timestamp: number
  /** Horizontal accuracy in metres, when known */
  accuracy?: number
  /** Metres above the WGS84 ellipsoid, when known */
  altitude?: number
  /** Metres per second as reported by the GPS, when known */
  speed?: number
}

const EARTH_RADIUS_M = 6371008.8

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in metres between two points (haversine). */
export function distanceMeters(a: TrackPoint, b: TrackPoint): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}
