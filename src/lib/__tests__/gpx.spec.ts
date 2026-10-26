import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../geo'
import { buildGpx, gpxFileName } from '../gpx'
import { summarizeTrack } from '../runStats'
import { distanceMeters } from '../geo'

// ~0.001 degrees of latitude is ~111 m
const at = (t: number, latOffset: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({
  lat: 52 + latOffset,
  lon: 4,
  timestamp: t,
  ...extra,
})

const START = Date.UTC(2026, 9, 26, 7, 5, 0)

/** Track points of the file, per segment */
function parse(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  return [...doc.getElementsByTagName('trkseg')].map((seg) =>
    [...seg.getElementsByTagName('trkpt')].map((pt) => ({
      lat: Number(pt.getAttribute('lat')),
      lon: Number(pt.getAttribute('lon')),
      ele: pt.getElementsByTagName('ele')[0]?.textContent ?? null,
      time: pt.getElementsByTagName('time')[0]!.textContent!,
    })),
  )
}

describe('buildGpx', () => {
  it('writes GPX 1.1 with UTC times and elevation where known', () => {
    const xml = buildGpx(START, [
      [at(START, 0, { accuracy: 5, altitude: 12.34 }), at(START + 30_000, 0.001, { accuracy: 5 })],
    ])
    expect(xml).toContain('<gpx version="1.1" creator="Run Tracker"')
    expect(xml).toContain('xmlns="http://www.topografix.com/GPX/1/1"')
    expect(xml).toContain('<metadata><time>2026-10-26T07:05:00.000Z</time></metadata>')
    const [segment] = parse(xml)
    expect(segment).toHaveLength(2)
    expect(segment![0]).toMatchObject({ lat: 52, lon: 4, ele: '12.3', time: '2026-10-26T07:05:00.000Z' })
    expect(segment![1]!.ele).toBeNull()
    expect(segment![1]!.time).toBe('2026-10-26T07:05:30.000Z')
  })

  it('writes one segment per start/resume and leaves out empty ones', () => {
    const xml = buildGpx(START, [
      [at(START, 0), at(START + 30_000, 0.001)],
      [],
      [at(START + 600_000, 0.01), at(START + 630_000, 0.011)],
    ])
    expect(parse(xml).map((s) => s.length)).toEqual([2, 2])
  })

  it('only writes the points the run maths counts, so the file matches the app distance', () => {
    const segment = [
      at(START, 0, { accuracy: 5 }),
      at(START + 10_000, 0.0005, { accuracy: 80 }), // inaccurate
      at(START + 20_000, 0.001, { accuracy: 5 }),
      at(START + 21_000, 0.05, { accuracy: 5 }), // a jump
      at(START + 22_000, 0.001, { accuracy: 5 }), // jitter on the last used point
      at(START + 50_000, 0.002, { accuracy: 5 }),
    ]
    const [written] = parse(buildGpx(START, [segment]))
    expect(written).toHaveLength(3)

    let meters = 0
    for (let i = 1; i < written!.length; i++) {
      meters += distanceMeters(
        { lat: written![i - 1]!.lat, lon: written![i - 1]!.lon, timestamp: 0 },
        { lat: written![i]!.lat, lon: written![i]!.lon, timestamp: 0 },
      )
    }
    expect(meters).toBeCloseTo(summarizeTrack([segment]).distanceM, 0)
  })

  it('is still valid XML for a run without points', () => {
    expect(parse(buildGpx(START, []))).toEqual([])
    expect(parse(buildGpx(START, [[at(START, 0, { accuracy: 90 })]]))).toEqual([])
  })
})

describe('gpxFileName', () => {
  it('uses the local start time', () => {
    const local = new Date(2026, 9, 26, 7, 5).getTime()
    expect(gpxFileName(local)).toBe('run-2026-10-26-0705.gpx')
  })
})
