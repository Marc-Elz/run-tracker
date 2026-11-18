/**
 * The one place that names the tile providers: MapTiler (free tier) on the phone and in dev, and
 * a keyless map of its own in the web demo (#165). To move to another provider, for example a
 * self-hosted tile server (#58), change this file only.
 */
const STYLE_ID = 'streets-v2-dark'

/** MapTiler key from `.env.local` (`VITE_MAPTILER_KEY`); not a secret, it ships inside the app. */
export function mapKey(): string | null {
  const key = import.meta.env.VITE_MAPTILER_KEY
  return typeof key === 'string' && key.trim() !== '' ? key.trim() : null
}

/**
 * Style URL for MapLibre, or null when no key is configured. The web demo uses its own map
 * instead: OpenStreetMap tiles of just the demo's two areas, made by `scripts/make-demo-map.mjs`
 * and served by the GitHub Pages site of the run-tracker-demo-map repo, with no key. The flag is
 * replaced at build time, so other builds leave that URL out.
 */
export function mapStyleUrl(key: string | null = mapKey()): string | null {
  if (import.meta.env.VITE_DEMO === 'true') {
    return 'https://marc-elz.github.io/run-tracker-demo-map/style.json'
  }
  return key
    ? `https://api.maptiler.com/maps/${STYLE_ID}/style.json?key=${encodeURIComponent(key)}`
    : null
}
