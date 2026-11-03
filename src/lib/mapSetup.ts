import type { StyleSpecification } from 'maplibre-gl'

/** No tiles, just the routes on a plain background: used without a key or when the style fails to load */
export const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1a2027' } }],
}

/** Loads MapLibre (and its CSS) on demand and hands it the worker file the build does not copy itself. */
export async function loadMapLibre() {
  const [maplibregl, worker] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ])
  maplibregl.setWorkerUrl(worker.default)
  return maplibregl
}
