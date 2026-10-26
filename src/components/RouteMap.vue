<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { mapStyleUrl } from '@/lib/mapStyle'
import type { LngLat, RunSummary } from '@/lib/runSummary'

const props = defineProps<{ route: Pick<RunSummary, 'lines' | 'start' | 'end' | 'bounds'> }>()

/** No tiles, just the route on a plain background: used without a key or when the style fails to load */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1a2027' } }],
}

const el = ref<HTMLDivElement | null>(null)
const styleUrl = mapStyleUrl()
// Why the background map is missing, shown over the map; the route is still drawn
const problem = ref<string | null>(styleUrl ? null : 'Map unavailable: no MapTiler key set')
const hasRoute = computed(() => props.route.start !== null)

let map: MapLibreMap | null = null
let fallbackUsed = styleUrl === null

function routeData() {
  const point = (coordinates: LngLat | null, kind: string) =>
    coordinates
      ? [{ type: 'Feature' as const, properties: { kind }, geometry: { type: 'Point' as const, coordinates } }]
      : []
  return {
    line: {
      type: 'FeatureCollection' as const,
      features: props.route.lines.map((coordinates) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates },
      })),
    },
    ends: {
      type: 'FeatureCollection' as const,
      features: [...point(props.route.start, 'start'), ...point(props.route.end, 'end')],
    },
  }
}

function drawRoute() {
  if (!map || !map.isStyleLoaded() || map.getSource('route')) return
  const { line, ends } = routeData()
  map.addSource('route', { type: 'geojson', data: line })
  map.addSource('route-ends', { type: 'geojson', data: ends })
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#f5c451', 'line-width': 5 },
  })
  map.addLayer({
    id: 'route-ends',
    type: 'circle',
    source: 'route-ends',
    paint: {
      'circle-radius': 8,
      'circle-color': ['match', ['get', 'kind'], 'start', '#1f9d55', '#d64545'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
}

onMounted(async () => {
  if (!el.value || !hasRoute.value) return
  const [maplibregl, worker] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ])
  if (!el.value) return // unmounted while loading
  // The build does not copy MapLibre's worker file on its own; hand it over as an asset
  maplibregl.setWorkerUrl(worker.default)

  const { bounds, start } = props.route
  const instance = new maplibregl.Map({
    container: el.value,
    style: styleUrl ?? BLANK_STYLE,
    // A page that scrolls: one finger scrolls the page, two move the map
    cooperativeGestures: true,
    attributionControl: { compact: true },
    ...(bounds && (bounds[0] !== bounds[2] || bounds[1] !== bounds[3])
      ? { bounds, fitBoundsOptions: { padding: 40, maxZoom: 17 } }
      : { center: start!, zoom: 15 }),
  })
  map = instance

  instance.on('load', drawRoute)
  instance.on('styledata', drawRoute)
  instance.on('error', () => {
    if (!instance.isStyleLoaded() && !fallbackUsed) {
      // The style itself failed (offline, bad key): keep the route on a plain background
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
  <div class="route-map">
    <div v-if="!hasRoute" class="route-map__message">No GPS points recorded</div>
    <template v-else>
      <div ref="el" class="route-map__canvas" />
      <p v-if="problem" class="route-map__problem" role="status">{{ problem }}</p>
    </template>
  </div>
</template>

<style scoped>
.route-map {
  position: relative;
  height: 45dvh;
  min-height: 16rem;
  background: #1a2027;
}

.route-map__canvas {
  position: absolute;
  inset: 0;
}

.route-map__message {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9aa5b1;
  font: 1rem system-ui, sans-serif;
}

.route-map__problem {
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
