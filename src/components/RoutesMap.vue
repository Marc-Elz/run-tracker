<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { mapStyleUrl } from '@/lib/mapStyle'
import { BLANK_STYLE, loadMapLibre } from '@/lib/mapSetup'
import type { RouteOverview } from '@/lib/routeOverview'

const props = defineProps<{
  overviews: RouteOverview[]
  /** The run to highlight, null for none */
  selectedId: string | null
}>()
const emit = defineEmits<{
  /** Runs whose line is under the tap, in no particular order; empty when the tap hit nothing */
  tap: [runIds: string[]]
}>()

/** Width of the invisible line that catches taps, so a thumb can hit a thin route */
const HIT_WIDTH_PX = 24

const el = ref<HTMLDivElement | null>(null)
const styleUrl = mapStyleUrl()
// Why the background map is missing, shown over the map; the routes are still drawn
const problem = ref<string | null>(styleUrl ? null : 'Map unavailable: no MapTiler key set')

let map: MapLibreMap | null = null
let fallbackUsed = styleUrl === null

function routesData() {
  return {
    type: 'FeatureCollection' as const,
    features: props.overviews.flatMap((o) =>
      o.lines.map((coordinates) => ({
        type: 'Feature' as const,
        properties: { runId: o.runId },
        geometry: { type: 'LineString' as const, coordinates },
      })),
    ),
  }
}

function allBounds(): [number, number, number, number] | null {
  let all: [number, number, number, number] | null = null
  for (const { bounds } of props.overviews) {
    if (!bounds) continue
    all = all
      ? [
          Math.min(all[0], bounds[0]),
          Math.min(all[1], bounds[1]),
          Math.max(all[2], bounds[2]),
          Math.max(all[3], bounds[3]),
        ]
      : [...bounds]
  }
  return all
}

function drawRoutes() {
  if (!map || !map.isStyleLoaded() || map.getSource('routes')) return
  map.addSource('routes', { type: 'geojson', data: routesData() })
  const line = { 'line-cap': 'round', 'line-join': 'round' } as const
  map.addLayer({
    id: 'routes-line',
    type: 'line',
    source: 'routes',
    layout: line,
    paint: { 'line-color': '#f5c451', 'line-width': 3, 'line-opacity': 0.3 },
  })
  map.addLayer({
    id: 'routes-hit',
    type: 'line',
    source: 'routes',
    layout: line,
    paint: { 'line-color': '#000000', 'line-width': HIT_WIDTH_PX, 'line-opacity': 0 },
  })
  map.addLayer({
    id: 'routes-selected',
    type: 'line',
    source: 'routes',
    layout: line,
    filter: ['==', ['get', 'runId'], props.selectedId ?? ''],
    paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 1 },
  })
}

function onClick(event: { point: { x: number; y: number } }) {
  if (!map) return
  const r = HIT_WIDTH_PX / 2
  const { x, y } = event.point
  const features = map.queryRenderedFeatures(
    [
      [x - r, y - r],
      [x + r, y + r],
    ],
    { layers: ['routes-hit'] },
  )
  emit('tap', [...new Set(features.map((f) => String(f.properties.runId)))])
}

watch(
  () => props.selectedId,
  (id) => {
    if (map?.getLayer('routes-selected')) {
      map.setFilter('routes-selected', ['==', ['get', 'runId'], id ?? ''])
    }
  },
)

onMounted(async () => {
  if (!el.value) return
  const maplibregl = await loadMapLibre()
  if (!el.value) return // unmounted while loading

  const bounds = allBounds()
  const instance = new maplibregl.Map({
    container: el.value,
    style: styleUrl ?? BLANK_STYLE,
    attributionControl: { compact: true },
    ...(bounds
      ? { bounds, fitBoundsOptions: { padding: 40, maxZoom: 15 } }
      : { center: [0, 0] as [number, number], zoom: 1 }),
  })
  map = instance

  instance.on('load', drawRoutes)
  instance.on('styledata', drawRoutes)
  instance.on('click', onClick)
  instance.on('error', () => {
    if (!instance.isStyleLoaded() && !fallbackUsed) {
      // The style itself failed (offline, bad key): keep the routes on a plain background
      fallbackUsed = true
      problem.value = 'Map unavailable: could not load the map'
      instance.setStyle(BLANK_STYLE)
    } else if (!problem.value) {
      problem.value = 'Some map tiles could not load'
    }
  })
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<template>
  <div class="routes-map">
    <div ref="el" class="routes-map__canvas" />
    <p v-if="problem" class="routes-map__problem" role="status">{{ problem }}</p>
  </div>
</template>

<style scoped>
.routes-map {
  position: absolute;
  inset: 0;
  background: #1a2027;
}

.routes-map__canvas {
  position: absolute;
  inset: 0;
}

.routes-map__problem {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  right: 0.5rem;
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgb(92 58 18 / 0.92);
  color: #ffe2b8;
  font: 0.9rem system-ui, sans-serif;
  pointer-events: none;
}
</style>
