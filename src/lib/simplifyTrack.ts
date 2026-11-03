import type { LngLat } from '@/lib/runSummary'

const M_PER_DEG_LAT = 111_320

/**
 * Douglas-Peucker: drop points that lie within `toleranceM` metres of the line between the points
 * kept around them. Works on a flat local projection (fine at the scale of a run) and keeps the
 * first and last point. Iterative, so a long track cannot overflow the call stack.
 */
export function simplifyLine(line: LngLat[], toleranceM: number): LngLat[] {
  if (line.length <= 2) return line.slice()
  const meanLat = line.reduce((sum, p) => sum + p[1], 0) / line.length
  const kx = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180)
  const pts = line.map(([lng, lat]) => [lng * kx, lat * M_PER_DEG_LAT] as const)

  const keep = Array.from({ length: line.length }, () => false)
  keep[0] = true
  keep[line.length - 1] = true
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let worst = -1
    let worstDist = toleranceM
    const [ax, ay] = pts[first]!
    const [bx, by] = pts[last]!
    const dx = bx - ax
    const dy = by - ay
    const lengthSq = dx * dx + dy * dy
    for (let i = first + 1; i < last; i++) {
      const [px, py] = pts[i]!
      let dist: number
      if (lengthSq === 0) {
        dist = Math.hypot(px - ax, py - ay)
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
        dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      }
      if (dist > worstDist) {
        worstDist = dist
        worst = i
      }
    }
    if (worst !== -1) {
      keep[worst] = true
      stack.push([first, worst], [worst, last])
    }
  }
  return line.filter((_, i) => keep[i])
}
