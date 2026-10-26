import type { TrackPoint } from '@/lib/geo'
import { acceptedPoints } from '@/lib/runStats'

const pad = (n: number) => String(n).padStart(2, '0')

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Local date and time parts: ["2026-10-26", "07", "05"] */
function localParts(ms: number): [string, string, string] {
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return [date, pad(d.getHours()), pad(d.getMinutes())]
}

/** "run-2026-10-26-0705.gpx", local time */
export function gpxFileName(startedAt: number): string {
  const [date, h, m] = localParts(startedAt)
  return `run-${date}-${h}${m}.gpx`
}

/** "Run 2026-10-26 07:05", local time */
function trackName(startedAt: number): string {
  const [date, h, m] = localParts(startedAt)
  return `Run ${date} ${h}:${m}`
}

/**
 * GPX 1.1 for a run: one track with one segment per start/resume, so a pause is a gap and not a
 * straight line. Only the points the run maths counts are written (see `acceptedPoints`), so the
 * file's distance equals the app's; the raw fixes stay in the database.
 */
export function buildGpx(startedAt: number, segments: TrackPoint[][]): string {
  const trkpt = (p: TrackPoint) =>
    `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
    (p.altitude !== undefined ? `<ele>${p.altitude.toFixed(1)}</ele>` : '') +
    `<time>${new Date(p.timestamp).toISOString()}</time></trkpt>`

  const trksegs = segments
    .map(acceptedPoints)
    .filter((points) => points.length > 0)
    .map((points) => `    <trkseg>\n${points.map(trkpt).join('\n')}\n    </trkseg>`)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Run Tracker" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    `  <metadata><time>${new Date(startedAt).toISOString()}</time></metadata>`,
    '  <trk>',
    `    <name>${escapeXml(trackName(startedAt))}</name>`,
    ...trksegs,
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n')
}
