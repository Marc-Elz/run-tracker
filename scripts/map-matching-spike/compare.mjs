#!/usr/bin/env node
// Map-matching spike (#25): match saved walks with Valhalla and GraphHopper and compare them.
// Usage is in README.md. Prints aggregate numbers only, safe to paste in public. Everything that
// shows a location (results.json, review.html) goes to the gitignored data/ folder.
import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const DATA = new URL('./data/', import.meta.url)
const VALHALLA = 'http://localhost:8002'
const GRAPHHOPPER = 'http://localhost:8989'

const MAX_ACCURACY_M = 25 // same cutoff as MAX_ACCURACY_M in src/lib/runStats.ts
const MIN_RUN_M = 1000 // leaves out the indoor tests and short runs
const GPS_ACCURACY_M = 10 // same setting for both engines, so the comparison is fair
const THIN_EVERY = 3 // walking at 1 fix/s, every 3rd point is roughly the point spacing of a run

/** Great-circle distance in metres between two [lon, lat] pairs. */
function metres([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

/** Valhalla's shape format: a Google polyline with 6 decimals. Returns [lon, lat] pairs. */
function decodePolyline6(encoded) {
  const coords = []
  let index = 0
  let lat = 0
  let lon = 0
  const next = () => {
    let shift = 0
    let value = 0
    let byte
    do {
      byte = encoded.charCodeAt(index++) - 63
      value |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return value & 1 ? ~(value >> 1) : value >> 1
  }
  while (index < encoded.length) {
    lat += next()
    lon += next()
    coords.push([lon / 1e6, lat / 1e6])
  }
  return coords
}

/** Saved walks long enough to compare, each split into its recording segments. */
function loadWalks() {
  const db = new DatabaseSync(new URL('phone.db', DATA), { readOnly: true })
  const runs = db
    .prepare(
      `SELECT id, started_at, distance_m FROM runs
       WHERE status = 'finished' AND distance_m >= ? ORDER BY started_at`,
    )
    .all(MIN_RUN_M)
  const points = db.prepare(
    `SELECT segment, timestamp, lat, lon FROM track_points
     WHERE run_id = ? AND (accuracy IS NULL OR accuracy <= ?) ORDER BY timestamp`,
  )
  const walks = runs.map((run, i) => {
    const segments = new Map()
    for (const p of points.all(run.id, MAX_ACCURACY_M)) {
      if (!segments.has(p.segment)) segments.set(p.segment, [])
      segments.get(p.segment).push(p)
    }
    return {
      label: `walk-${i + 1}`,
      date: new Date(run.started_at).toISOString().slice(0, 10),
      gpsM: run.distance_m,
      segments: [...segments.values()],
    }
  })
  db.close()
  return walks
}

/** Sends one segment to Valhalla. Result shape is shared with `matchGraphhopper`. */
async function matchValhalla(points) {
  const response = await fetch(`${VALHALLA}/trace_attributes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shape: points.map((p) => ({ lat: p.lat, lon: p.lon })),
      costing: 'pedestrian',
      shape_match: 'map_snap',
      // Valhalla's docs suggest 500 for pedestrian traces that jitter back and forth
      trace_options: { gps_accuracy: GPS_ACCURACY_M, turn_penalty_factor: 500 },
      // The percent_along fields used below come back without being listed: naming them here
      // is rejected as an invalid filter attribute, despite being in the docs
      filters: {
        attributes: ['edge.way_id', 'edge.length', 'matched.type', 'shape'],
        action: 'include',
      },
    }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error ?? 'no message'}`)
  return {
    ways: body.edges.map((edge) => ({
      id: edge.way_id,
      metres: edge.length * 1000,
      // Valhalla leaves the percentages out when an edge was walked in full
      partial: edge.source_percent_along !== undefined || edge.target_percent_along !== undefined,
    })),
    line: decodePolyline6(body.shape),
    unmatched: body.matched_points.filter((p) => p.type === 'unmatched').length,
  }
}

/** Sends one segment to GraphHopper as GPX, the only input format of its /match endpoint. */
async function matchGraphhopper(points) {
  const trkpts = points
    .map(
      (p) =>
        `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.timestamp).toISOString()}</time></trkpt>`,
    )
    .join('')
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="spike" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${trkpts}</trkseg></trk></gpx>`
  const params = new URLSearchParams({
    profile: 'foot',
    type: 'json',
    instructions: 'false',
    points_encoded: 'false',
    gps_accuracy: String(GPS_ACCURACY_M),
    details: 'osm_way_id',
  })
  const response = await fetch(`${GRAPHHOPPER}/match?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/gpx+xml' },
    body: gpx,
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.message ?? 'no message'}`)
  const path = body.paths[0]
  const line = path.points.coordinates.map(([lon, lat]) => [lon, lat])
  const ways = path.details.osm_way_id.map(([from, to, id]) => {
    let length = 0
    for (let i = from; i < to; i++) length += metres(line[i], line[i + 1])
    // Each piece has its own geometry, so a partly walked way simply has a shorter length
    return { id, metres: length, partial: null }
  })
  return { ways, line, unmatched: null }
}

/** Runs one engine over all segments of a walk, recording failures instead of stopping. */
async function matchWalk(match, segments) {
  const result = { ways: [], lines: [], unmatched: 0, points: 0, ms: 0, error: null }
  for (const points of segments) {
    const started = performance.now()
    try {
      const matched = await match(points)
      result.ways.push(...matched.ways)
      result.lines.push(matched.line)
      result.unmatched = matched.unmatched === null ? null : result.unmatched + matched.unmatched
    } catch (error) {
      result.error = error.message
    }
    result.ms += performance.now() - started
    result.points += points.length
  }
  return result
}

/** Metres per way id. */
function byWay(ways) {
  const totals = new Map()
  for (const way of ways) totals.set(way.id, (totals.get(way.id) ?? 0) + way.metres)
  return totals
}

const total = (ways) => ways.reduce((sum, way) => sum + way.metres, 0)

/** Length-weighted overlap of two way lists: 1 means the same ways for the same lengths. */
function agreement(waysA, waysB) {
  const a = byWay(waysA)
  const b = byWay(waysB)
  let shared = 0
  let either = 0
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    shared += Math.min(a.get(id) ?? 0, b.get(id) ?? 0)
    either += Math.max(a.get(id) ?? 0, b.get(id) ?? 0)
  }
  return either === 0 ? 0 : shared / either
}

const percent = (fraction) => `${Math.round(fraction * 100)}%`

const table = (headers, rows) =>
  [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`]
    .concat(rows.map((row) => `| ${row.join(' | ')} |`))
    .join('\n')

/** Private map for reviewing matches by eye. Stays in data/, because it shows the routes. */
function reviewPage(walks) {
  const key = process.env.VITE_MAPTILER_KEY ?? ''
  const data = JSON.stringify(walks).replaceAll('</', '<\\/')
  return `<!doctype html><meta charset="utf-8"><title>Map-matching review</title>
<link href="https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.js"></script>
<style>html,body,#map{margin:0;height:100%}#panel{position:absolute;z-index:1;top:8px;left:8px;
background:#fff;padding:8px;font:14px sans-serif;border-radius:4px}label{display:block}</style>
<div id="panel"><select id="walk"></select>
<label><input type="checkbox" id="thin"> every ${THIN_EVERY}rd point</label>
<label style="color:#c00"><input type="checkbox" data-layer="gps" checked> GPS</label>
<label style="color:#06c"><input type="checkbox" data-layer="valhalla" checked> Valhalla</label>
<label style="color:#d80"><input type="checkbox" data-layer="graphhopper" checked> GraphHopper</label></div>
<div id="map"></div><script>
const walks = ${data}, key = ${JSON.stringify(key)};
const map = new maplibregl.Map({ container: 'map',
  style: 'https://api.maptiler.com/maps/streets-v2/style.json?key=' + key });
const select = document.getElementById('walk'), thin = document.getElementById('thin');
walks.forEach((w, i) => select.add(new Option(w.label + ' (' + w.date + ')', i)));
const multi = (lines) => ({ type: 'Feature', properties: {},
  geometry: { type: 'MultiLineString', coordinates: lines } });
function show(fit) {
  const walk = walks[select.value], v = thin.checked ? walk.thin : walk.full;
  map.getSource('gps').setData(multi(walk.gps));
  map.getSource('valhalla').setData(multi(v.valhalla.lines));
  map.getSource('graphhopper').setData(multi(v.graphhopper.lines));
  if (fit) { const b = new maplibregl.LngLatBounds();
    walk.gps.flat().forEach((c) => b.extend(c)); map.fitBounds(b, { padding: 60 }); }
}
map.on('load', () => {
  [['gps', '#c00', 2], ['valhalla', '#06c', 7], ['graphhopper', '#d80', 3]].forEach(([id, color, width]) => {
    map.addSource(id, { type: 'geojson', data: multi([]) });
    map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': color, 'line-width': width, 'line-opacity': 0.8 } });
  });
  show(true);
});
select.onchange = () => show(true); thin.onchange = () => show(false);
document.querySelectorAll('[data-layer]').forEach((box) => { box.onchange = () =>
  map.setLayoutProperty(box.dataset.layer, 'visibility', box.checked ? 'visible' : 'none'); });
</script>`
}

const walks = loadWalks()
const engines = { valhalla: matchValhalla, graphhopper: matchGraphhopper }
const results = []
for (const walk of walks) {
  const thinned = walk.segments.map((points) => points.filter((_, i) => i % THIN_EVERY === 0))
  const entry = {
    label: walk.label,
    date: walk.date,
    gpsM: walk.gpsM,
    gps: walk.segments.map((points) => points.map((p) => [p.lon, p.lat])),
    full: {},
    thin: {},
  }
  for (const [name, match] of Object.entries(engines)) {
    entry.full[name] = await matchWalk(match, walk.segments)
    entry.thin[name] = await matchWalk(match, thinned)
  }
  results.push(entry)
}

writeFileSync(new URL('results.json', DATA), JSON.stringify(results, null, 1))
writeFileSync(new URL('review.html', DATA), reviewPage(results))

const rows = []
for (const walk of results) {
  for (const variant of ['full', 'thin']) {
    for (const name of Object.keys(engines)) {
      const r = walk[variant][name]
      rows.push([
        walk.label,
        variant,
        name,
        r.error ? `FAILED: ${r.error}` : 'ok',
        r.points,
        `${(total(r.ways) / 1000).toFixed(2)} km`,
        percent(total(r.ways) / walk.gpsM),
        byWay(r.ways).size,
        r.ways.some((w) => w.id === null || w.id === undefined) ? 'some missing' : 'yes',
        r.unmatched ?? 'n/a',
        `${Math.round(r.ms)} ms`,
      ])
    }
  }
}
console.log(
  table(
    ['walk', 'points', 'engine', 'status', 'fixes', 'matched', 'of GPS', 'ways', 'way ids', 'unmatched', 'time'],
    rows,
  ),
)

console.log('\nEngines compared, and full vs. thinned, per walk (length-weighted way overlap)\n')
console.log(
  table(
    ['walk', 'valhalla vs graphhopper', 'valhalla full vs thin', 'graphhopper full vs thin'],
    results.map((w) => [
      w.label,
      percent(agreement(w.full.valhalla.ways, w.full.graphhopper.ways)),
      percent(agreement(w.full.valhalla.ways, w.thin.valhalla.ways)),
      percent(agreement(w.full.graphhopper.ways, w.thin.graphhopper.ways)),
    ]),
  ),
)

console.log('\nWalks compared with each other (meaningful only where they follow the same route)\n')
const pairs = []
for (let i = 0; i < results.length; i++) {
  for (let j = i + 1; j < results.length; j++) {
    const [a, b] = [results[i], results[j]]
    pairs.push([
      `${a.label} / ${b.label}`,
      percent(agreement(a.full.valhalla.ways, b.full.valhalla.ways)),
      percent(agreement(a.full.graphhopper.ways, b.full.graphhopper.ways)),
    ])
  }
}
console.log(table(['pair', 'valhalla', 'graphhopper'], pairs))
