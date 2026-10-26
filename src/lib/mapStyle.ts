/**
 * The one place that names the tile provider (MapTiler free tier). To move to another provider,
 * for example a self-hosted tile server (#58), change this file only.
 */
const STYLE_ID = 'streets-v2-dark'

/** MapTiler key from `.env.local` (`VITE_MAPTILER_KEY`); not a secret, it ships inside the app. */
export function mapKey(): string | null {
  const key = import.meta.env.VITE_MAPTILER_KEY
  return typeof key === 'string' && key.trim() !== '' ? key.trim() : null
}

/** Style URL for MapLibre, or null when no key is configured. */
export function mapStyleUrl(key: string | null = mapKey()): string | null {
  return key ? `https://api.maptiler.com/maps/${STYLE_ID}/style.json?key=${encodeURIComponent(key)}` : null
}
