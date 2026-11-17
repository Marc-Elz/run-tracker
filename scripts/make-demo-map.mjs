// Builds the map of the web demo (#165): vector tiles, a dark style with labels, fonts and sprites
// for the two places the demo shows, served without an API key from the GitHub Pages site of
// https://github.com/Marc-Elz/run-tracker-demo-map. That repo holds only this script's output,
// under the licences of the data (ODbL, OFL), so this repo stays MIT and free of tile data.
//
// Usage: node scripts/make-demo-map.mjs <output dir> [build date YYYYMMDD]
//   <output dir> is a clone of run-tracker-demo-map; its old map files are replaced, .git is kept.
//   Without a date the newest Protomaps planet build is used.
//
// The tiles come from the Protomaps planet build (OpenStreetMap data), read tile by tile with HTTP
// range requests, so only a few hundred tiles are downloaded, not the whole 140 GB file. They are
// written as plain z/x/y.pbf files, not one .pmtiles file: GitHub Pages gzips range responses when
// the browser accepts gzip, which breaks .pmtiles in Firefox (tested in #165).
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PMTiles } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'
import basemapsPackage from '@protomaps/basemaps/package.json' with { type: 'json' }

/** Where the data repo's Pages site serves the files; the style holds absolute URLs into it */
const SITE = 'https://marc-elz.github.io/run-tracker-demo-map/'
const BUILDS = 'https://build-metadata.protomaps.dev/builds.json'
const ASSETS = 'https://protomaps.github.io/basemaps-assets/'
const MIN_ZOOM = 9
// Up to 14 keeps the output near 10 MB (15 would be ~36 MB); MapLibre enlarges z14 when zoomed in
const MAX_ZOOM = 14

// The only places the demo shows, each from MIN_ZOOM up to its own `maxZoom`. If the code named
// here moves elsewhere, regenerate.
const AREAS = {
  // The sample runs of scripts/make-test-backup.mjs (--demo), with room for their loops
  utrecht: { west: 4.95, south: 52.055, east: 5.19, north: 52.14, maxZoom: MAX_ZOOM },
  // The fixed circle of src/lib/simulateGps.ts (52.37 N, 4.90 E, ~170 m), with ~1 km around it
  amsterdam: { west: 4.885, south: 52.36, east: 4.915, north: 52.38, maxZoom: MAX_ZOOM },
  // Both cities and their surroundings, only at the zooms of the all-routes overview: zoomed out
  // that far the screen reaches well past the areas above, which would show a blank band
  overview: { west: 4.75, south: 51.95, east: 5.35, north: 52.45, maxZoom: 10 },
}
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']
// Latin, Latin Extended and general punctuation (such as ’ and –) cover Dutch and English names
const GLYPH_RANGES = ['0-255', '256-511', '8192-8447']
const SPRITES = ['dark.json', 'dark.png', 'dark@2x.json', 'dark@2x.png']

const [out, dateArg] = process.argv.slice(2)
if (!out) {
  console.error('Usage: node scripts/make-demo-map.mjs <output dir> [build date YYYYMMDD]')
  process.exit(1)
}
if (dateArg !== undefined && !/^\d{8}$/.test(dateArg)) {
  console.error('The build date is written YYYYMMDD, for example 20261117')
  process.exit(1)
}

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Tile column and row of a point at zoom z (Web Mercator) */
const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z)
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

/** Every tile [z, x, y] that touches one of the areas, without duplicates */
function tilesToFetch() {
  const seen = new Set()
  const tiles = []
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    for (const a of Object.values(AREAS)) {
      if (z > a.maxZoom) continue
      for (let x = tileX(a.west, z); x <= tileX(a.east, z); x++) {
        for (let y = tileY(a.north, z); y <= tileY(a.south, z); y++) {
          const key = `${z}/${x}/${y}`
          if (seen.has(key)) continue
          seen.add(key)
          tiles.push([z, x, y])
        }
      }
    }
  }
  return tiles
}

// Keep the clone's .git; everything else is this script's output from an earlier run
await mkdir(out, { recursive: true })
for (const entry of await readdir(out)) {
  if (entry !== '.git') await rm(join(out, entry), { recursive: true, force: true })
}

const builds = JSON.parse((await download(BUILDS)).toString('utf8'))
const build = dateArg ? builds.find((b) => b.key === `${dateArg}.pmtiles`) : builds.at(-1)
if (!build) {
  console.error(`No Protomaps build for ${dateArg}. Recent ones: ${builds.slice(-5).map((b) => b.key).join(', ')}`)
  process.exit(1)
}
const archive = new PMTiles(`https://build.protomaps.com/${build.key}`)
const header = await archive.getHeader()
console.log(`Build ${build.key} (basemap ${build.version}), tiles stored up to z${header.maxZoom}`)

let tileCount = 0
let bytes = 0
const tiles = tilesToFetch()
// A few requests at a time: quick, and gentle on the build server
for (let i = 0; i < tiles.length; i += 8) {
  await Promise.all(
    tiles.slice(i, i + 8).map(async ([z, x, y]) => {
      // getZxy already unpacks the tile (the build stores them gzipped). They are written
      // unpacked: Pages compresses on the way out, and MapLibre expects plain protobuf.
      const tile = await archive.getZxy(z, x, y)
      if (!tile) return // nothing at this place and zoom (open sea, say)
      const data = Buffer.from(tile.data)
      await mkdir(join(out, 'tiles', String(z), String(x)), { recursive: true })
      await writeFile(join(out, 'tiles', String(z), String(x), `${y}.pbf`), data)
      tileCount++
      bytes += data.length
    }),
  )
}

const style = {
  version: 8,
  name: 'Run Tracker demo (Protomaps dark)',
  sources: {
    protomaps: {
      type: 'vector',
      tiles: [`${SITE}tiles/{z}/{x}/{y}.pbf`],
      minzoom: MIN_ZOOM,
      maxzoom: MAX_ZOOM,
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: layers('protomaps', namedFlavor('dark'), { lang: 'en' }),
  glyphs: `${SITE}fonts/{fontstack}/{range}.pbf`,
  sprite: `${SITE}sprites/v4/dark`,
}
await writeFile(join(out, 'style.json'), JSON.stringify(style))

for (const font of FONTS) {
  await mkdir(join(out, 'fonts', font), { recursive: true })
  for (const range of GLYPH_RANGES) {
    const data = await download(`${ASSETS}fonts/${encodeURIComponent(font)}/${range}.pbf`)
    await writeFile(join(out, 'fonts', font, `${range}.pbf`), data)
    bytes += data.length
  }
}
await writeFile(join(out, 'fonts', 'OFL.txt'), await download(`${ASSETS}fonts/OFL.txt`))
await mkdir(join(out, 'sprites', 'v4'), { recursive: true })
for (const file of SPRITES) {
  const data = await download(`${ASSETS}sprites/v4/${file}`)
  await writeFile(join(out, 'sprites', 'v4', file), data)
  bytes += data.length
}

// Pages would otherwise run the files through Jekyll
await writeFile(join(out, '.nojekyll'), '')
await writeFile(
  join(out, 'README.md'),
  `# Run Tracker demo map

Map data for the web demo of [Run Tracker](https://github.com/Marc-Elz/run-tracker) at
https://marc-elz.github.io/run-tracker/. GitHub Pages serves these files at ${SITE}, and the
demo loads \`style.json\` from there. It needs no API key.

Only two small areas are included, the places the demo shows: Utrecht (its sample runs) and a
spot in Amsterdam (its simulated GPS), at zoom levels ${MIN_ZOOM} to ${MAX_ZOOM}, plus the region
around both at zoom ${MIN_ZOOM} to ${AREAS.overview.maxZoom} for the zoomed-out overview.

**Generated, not edited by hand.** Made with \`scripts/make-demo-map.mjs\` in the Run Tracker repo:

    node scripts/make-demo-map.mjs <clone of this repo> ${build.key.replace('.pmtiles', '')}

from Protomaps planet build \`${build.key}\` (basemap ${build.version}) and
\`@protomaps/basemaps\` ${basemapsPackage.version}. Regenerating replaces everything here.

## Licences

The files here are not under the Run Tracker's MIT licence:

- \`tiles/\`: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available
  under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/), in the
  [Protomaps basemap](https://github.com/protomaps/basemaps) schema.
- \`fonts/\`: Noto Sans, under the SIL Open Font License, see \`fonts/OFL.txt\`.
- \`sprites/\`: from [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets),
  derived from the MIT-licensed [tangrams/icons](https://github.com/tangrams/icons).
- \`style.json\`: generated with [@protomaps/basemaps](https://github.com/protomaps/basemaps)
  (BSD-3-Clause).
`,
)

console.log(`${tileCount} tiles of ${tiles.length} places, ${(bytes / 1e6).toFixed(1)} MB in all -> ${out}`)
