// Writes a large backup file of made-up runs around Utrecht, for testing Restore and the
// all-routes map on the phone (#23, #21). Utrecht is far from the home area on purpose, so the
// dummies never sit on top of real runs. Run names start with "Dummy" so they are easy to spot.
// Same seed, same file: re-running gives the same routes (new run ids).
// Usage: node scripts/make-test-backup.mjs <out.json> [runs=300] [pointsPerRun=2000] [--demo]
// Then: adb push <out.json> /sdcard/Download/ and pick it with Settings > Restore from backup.
// Restore adds to the runs already on the phone; it never replaces them.
//
// --demo writes the seed file of the web demo (#162), src/demo/demo-backup.json:
//   node scripts/make-test-backup.mjs src/demo/demo-backup.json 12 400 --demo
// Its runs have no name (like real ones), a fix every 5 s to keep the file small, lengths that
// vary per run, and fixed ids and times so regenerating gives the same file. It also holds one
// sample training program. The demo moves all times to just before today when it loads.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const demo = args.includes('--demo')
const [out, runsArg = '300', pointsArg = '2000'] = args.filter((a) => a !== '--demo')
if (!out) {
  console.error('Usage: node scripts/make-test-backup.mjs <out.json> [runs] [pointsPerRun] [--demo]')
  process.exit(1)
}
const runCount = Number(runsArg)
const pointCount = Number(pointsArg)
if (!Number.isInteger(runCount) || runCount < 1 || !Number.isInteger(pointCount) || pointCount < 20) {
  console.error('runs must be a whole number >= 1 and pointsPerRun a whole number >= 20')
  process.exit(1)
}

// The demo file is fixed in time (the app shifts it); a test file is made for today
const now = demo ? Date.UTC(2026, 0, 1, 7) : Date.now()
const FIX_MS = demo ? 5000 : 1000
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
// A UUID from the seeded generator, so the demo file is the same every time
const seededId = () =>
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(random() * 16).toString(16))
const newId = () => (demo ? seededId() : randomUUID())

// Where people start: the first ones get most runs, like a real habit
const STARTS = [
  { name: 'Griftpark', lat: 52.0975, lon: 5.1215, weight: 4 },
  { name: 'Wilhelminapark', lat: 52.087, lon: 5.1335, weight: 3 },
  { name: 'Amelisweerd', lat: 52.079, lon: 5.156, weight: 2 },
  { name: 'De Haar', lat: 52.121, lon: 4.987, weight: 1 },
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
  // Demo runs differ in length, from a short loop to a long run
  const fixes = demo ? Math.round(pointCount * between(0.6, 1.8)) : pointCount
  const seconds = (fixes * FIX_MS) / 1000
  // The loop is scaled to the distance this many seconds at this speed covers
  const scale = (seconds * speed) / unitLength(loop)
  // Where on the loop it starts and a small shift of the whole route, as if run a little wider
  const offset = between(0, 2 * Math.PI)
  const shiftX = gauss() * 12
  const shiftY = gauss() * 12
  // Demo runs are a few days apart in the morning or evening (Dutch time), like a real habit
  const startedAt = demo
    ? Date.UTC(2025, 11, 31) - Math.round(i * 2.3 + between(0, 1)) * DAY +
      (pick([6, 7, 17, 18]) * 60 + Math.floor(between(0, 60))) * 60_000
    : now - (i + 1) * DAY * between(0.8, 1.2) + Math.floor(random() * 4) * 3_600_000
  const pauseAt = Math.floor(fixes * between(0.3, 0.7))

  const points = []
  let gapMs = 0
  for (let p = 0; p < fixes; p++) {
    if (p === pauseAt) gapMs = 45_000 // a stop at a traffic light: a new segment after a gap
    const [ux, uy] = loopPoint(loop, offset + (p / fixes) * 2 * Math.PI)
    const east = ux * scale + shiftX + gauss() * 2
    const north = uy * scale + shiftY + gauss() * 2
    const bad = random() < 0.02 // now and then a poor fix, which the app leaves out
    points.push({
      segment: p < pauseAt ? 0 : 1,
      timestamp: Math.round(startedAt + p * FIX_MS + gapMs),
      lat: round(start.lat + north / M_PER_DEG_LAT, 6),
      lon: round(start.lon + east / (M_PER_DEG_LAT * Math.cos((start.lat * Math.PI) / 180)), 6),
      accuracy: round(bad ? between(40, 80) : between(3, 8), 1),
      altitude: 3.2,
      speed: round(speed, 2),
    })
  }
  const movingMs = fixes * FIX_MS
  const elapsedMs = movingMs + gapMs
  runs.push({
    run: {
      id: newId(),
      name: demo ? null : `Dummy ${String(i + 1).padStart(3, '0')}`,
      status: 'finished',
      startedAt: Math.round(startedAt),
      finishedAt: Math.round(startedAt + elapsedMs),
      elapsedMs,
      segment: 1,
      segmentStartedAt: null,
      movingMs,
      distanceM: Math.round((movingMs / 1000) * speed),
    },
    points,
  })
}

/** One small sample program for the demo: four weeks of an easy run, intervals and a long run */
function demoProgram() {
  const program = {
    id: newId(),
    name: '5K builder',
    goal: 'Run 5 km without stopping',
    weeks: 4,
    // Two weeks before `now`; the app moves it along with the runs
    startDate: new Date(now - 14 * DAY).toISOString().slice(0, 10),
    createdAt: now - 15 * DAY,
    updatedAt: now - 15 * DAY,
  }
  const sessions = []
  const steps = []
  const step = (sessionId, position, fields) =>
    steps.push({
      id: newId(),
      sessionId,
      position,
      targetKind: 'none',
      targetValue: null,
      paceMin: null,
      paceMax: null,
      repetitions: null,
      span: null,
      ...fields,
    })
  for (let week = 1; week <= program.weeks; week++) {
    const easy = { id: newId(), programId: program.id, week, position: 0, type: 'easy', title: 'Easy run', notes: null }
    step(easy.id, 0, { kind: 'run', targetKind: 'duration', targetValue: (20 + week * 5) * 60, paceMin: 330, paceMax: 370 })

    const reps = 3 + week
    const intervals = {
      id: newId(),
      programId: program.id,
      week,
      position: 1,
      type: 'intervals',
      title: `${reps} x 400 m`,
      notes: 'Recover at walking pace between the fast parts.',
    }
    step(intervals.id, 0, { kind: 'warmup', targetKind: 'duration', targetValue: 600 })
    step(intervals.id, 1, { kind: 'repeat', repetitions: reps, span: 2 })
    step(intervals.id, 2, { kind: 'run', targetKind: 'distance', targetValue: 400, paceMin: 270, paceMax: 290 })
    step(intervals.id, 3, { kind: 'recovery', targetKind: 'duration', targetValue: 90 })
    step(intervals.id, 4, { kind: 'cooldown', targetKind: 'duration', targetValue: 600 })

    const long = { id: newId(), programId: program.id, week, position: 2, type: 'long', title: 'Long run', notes: null }
    step(long.id, 0, { kind: 'run', targetKind: 'distance', targetValue: (5 + week) * 1000, paceMin: 340, paceMax: 390 })

    sessions.push(easy, intervals, long)
  }
  return { program, sessions, steps }
}

const text = demo
  ? JSON.stringify({ format: 'run-tracker-backup', version: 2, exportedAt: now, runs, programs: [demoProgram()] })
  : JSON.stringify({ format: 'run-tracker-backup', version: 1, exportedAt: now, runs })
writeFileSync(out, text)
const kb = (text.length / 1e3).toFixed(0)
console.log(`${runCount} runs x ~${pointCount} points${demo ? ' + 1 program' : ''}, ${kb} kB -> ${out}`)
