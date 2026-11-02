// Writes a large backup file for testing Restore and Back up on the phone (#23).
// Usage: node scripts/make-test-backup.mjs <out.json> [runs=300] [pointsPerRun=2000]
// Then: adb push <out.json> /sdcard/Download/ and pick it with Settings > Restore from backup.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const [out, runsArg = '300', pointsArg = '2000'] = process.argv.slice(2)
if (!out) {
  console.error('Usage: node scripts/make-test-backup.mjs <out.json> [runs] [pointsPerRun]')
  process.exit(1)
}
const runCount = Number(runsArg)
const pointCount = Number(pointsArg)
const now = Date.now()
const DAY = 86_400_000

const runs = []
for (let i = 0; i < runCount; i++) {
  const startedAt = now - (i + 1) * DAY
  const points = []
  for (let p = 0; p < pointCount; p++) {
    const angle = (p / pointCount) * 2 * Math.PI
    points.push({
      segment: p < pointCount / 2 ? 0 : 1,
      timestamp: startedAt + p * 1000,
      lat: 53.17 + 0.004 * Math.sin(angle),
      lon: 6.6 + 0.006 * Math.cos(angle),
      accuracy: 4.5,
      altitude: 3.2,
      speed: 2.8,
    })
  }
  runs.push({
    run: {
      id: randomUUID(),
      name: `Test run ${i + 1}`,
      status: 'finished',
      startedAt,
      finishedAt: startedAt + pointCount * 1000,
      elapsedMs: pointCount * 1000,
      segment: 1,
      segmentStartedAt: null,
      movingMs: pointCount * 1000,
      distanceM: pointCount * 2.8,
    },
    points,
  })
}
const text = JSON.stringify({ format: 'run-tracker-backup', version: 1, exportedAt: now, runs })
writeFileSync(out, text)
console.log(`${runCount} runs x ${pointCount} points, ${(text.length / 1e6).toFixed(1)} MB -> ${out}`)
