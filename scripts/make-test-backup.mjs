// Writes a large backup file of made-up runs around Groningen, for testing Restore and the
// all-routes map on the phone (#23, #21). Run names start with "Dummy" so they are easy to find and
// delete in History. Same seed, same file: re-running gives the same routes (new run ids).
// Usage: node scripts/make-test-backup.mjs <out.json> [runs=300] [pointsPerRun=2000]
// Then: adb push <out.json> /sdcard/Download/ and pick it with Settings > Restore from backup.
// Restore adds to the runs already on the phone; it never replaces them.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const [out, runsArg = '300', pointsArg = '2000'] = process.argv.slice(2)
if (!out) {
  console.error('Usage: node scripts/make-test-backup.mjs <out.json> [runs] [pointsPerRun]')
  process.exit(1)
}
const runCount = Number(runsArg)
const pointCount = Number(pointsArg)
if (!Number.isInteger(runCount) || runCount < 1 || !Number.isInteger(pointCount) || pointCount < 20) {
  console.error('runs must be a whole number >= 1 and pointsPerRun a whole number >= 20')
  process.exit(1)
}

const now = Date.now()
const DAY = 86_400_000
const SPEED_MPS = 2.8
const M_PER_DEG_LAT = 111_320

// Small seeded random generator (mulberry32), so the routes are the same every time
let seed = 21
function random() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (min, max) => min + random() * (max - min)
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits
const pick = (list) => list[Math.floor(random() * list.length)]
// Roughly normal, for GPS noise
const gauss = () => (random() + random() + random() + random() - 2) / 0.58

// Where people start: the first ones get most runs, like a real habit
const STARTS = [
  { name: 'Noorderplantsoen', lat: 53.2145, lon: 6.559, weight: 4 },
  { name: 'Stadspark', lat: 53.206, lon: 6.54, weight: 3 },
  { name: 'Haren', lat: 53.173, lon: 6.607, weight: 2 },
  { name: 'Paterswolde', lat: 53.1535, lon: 6.5755, weight: 1 },
]
const startPool = STARTS.flatMap((s) => Array(s.weight).fill(s))

// A few fixed loops per start that get repeated, so they overlap and stack on the map.
// A loop is an ellipse with a rotation and a wobble; `scale` is fixed per run from its length.
const loopsFor = new Map(
  STARTS.map((s) => [
    s.name,
    Array.from({ length: 4 }, () => ({
      aspect: between(0.45, 1),
      rotation: between(0, Math.PI),
      wobbleAmp: between(0.04, 0.15),
      wobbleFreq: Math.floor(between(2, 6)),
      wobblePhase: between(0, 2 * Math.PI),
    })),
  ]),
)

/** Unit loop point at angle `a`, in metres before scaling */
function loopPoint(loop, a) {
  const wobble = 1 + loop.wobbleAmp * Math.sin(loop.wobbleFreq * a + loop.wobblePhase)
  const x = Math.cos(a) * wobble
  const y = Math.sin(a) * loop.aspect * wobble
  return [
    x * Math.cos(loop.rotation) - y * Math.sin(loop.rotation),
    x * Math.sin(loop.rotation) + y * Math.cos(loop.rotation),
  ]
}

/** Metres of loop length per unit of scale, measured by sampling */
function unitLength(loop) {
  let length = 0
  let prev = loopPoint(loop, 0)
  for (let i = 1; i <= 720; i++) {
    const next = loopPoint(loop, (i / 720) * 2 * Math.PI)
    length += Math.hypot(next[0] - prev[0], next[1] - prev[1])
    prev = next
  }
  return length
}

const runs = []
for (let i = 0; i < runCount; i++) {
  const start = pick(startPool)
  const loop = pick(loopsFor.get(start.name))
  const speed = SPEED_MPS * between(0.85, 1.15)
  // The loop is scaled to the distance this many seconds at this speed covers
  const scale = (pointCount * speed) / unitLength(loop)
  // Where on the loop it starts and a small shift of the whole route, as if run a little wider
  const offset = between(0, 2 * Math.PI)
  const shiftX = gauss() * 12
  const shiftY = gauss() * 12
  const startedAt = now - (i + 1) * DAY * between(0.8, 1.2) + Math.floor(random() * 4) * 3_600_000
  const pauseAt = Math.floor(pointCount * between(0.3, 0.7))

  const points = []
  let gapMs = 0
  for (let p = 0; p < pointCount; p++) {
    if (p === pauseAt) gapMs = 45_000 // a stop at a traffic light: a new segment after a gap
    const [ux, uy] = loopPoint(loop, offset + (p / pointCount) * 2 * Math.PI)
    const east = ux * scale + shiftX + gauss() * 2
    const north = uy * scale + shiftY + gauss() * 2
    const bad = random() < 0.02 // now and then a poor fix, which the app leaves out
    points.push({
      segment: p < pauseAt ? 0 : 1,
      timestamp: Math.round(startedAt + p * 1000 + gapMs),
      lat: round(start.lat + north / M_PER_DEG_LAT, 6),
      lon: round(start.lon + east / (M_PER_DEG_LAT * Math.cos((start.lat * Math.PI) / 180)), 6),
      accuracy: round(bad ? between(40, 80) : between(3, 8), 1),
      altitude: 3.2,
      speed: round(speed, 2),
    })
  }
  const elapsedMs = pointCount * 1000 + gapMs
  runs.push({
    run: {
      id: randomUUID(),
      name: `Dummy ${String(i + 1).padStart(3, '0')}`,
      status: 'finished',
      startedAt: Math.round(startedAt),
      finishedAt: Math.round(startedAt + elapsedMs),
      elapsedMs,
      segment: 1,
      segmentStartedAt: null,
      movingMs: pointCount * 1000,
      distanceM: pointCount * speed,
    },
    points,
  })
}

const text = JSON.stringify({ format: 'run-tracker-backup', version: 1, exportedAt: now, runs })
writeFileSync(out, text)
console.log(`${runCount} runs x ${pointCount} points, ${(text.length / 1e6).toFixed(1)} MB -> ${out}`)
