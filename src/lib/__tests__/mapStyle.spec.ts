import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapKey, mapStyleUrl } from '../mapStyle'

describe('mapStyle', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('builds the style URL from a key', () => {
    expect(mapStyleUrl('abc 1')).toBe(
      'https://api.maptiler.com/maps/streets-v2-dark/style.json?key=abc%201',
    )
  })

  it('has no style without a key', () => {
    expect(mapStyleUrl(null)).toBeNull()
  })

  it('uses the keyless demo map in the web demo, whatever the key', () => {
    vi.stubEnv('VITE_DEMO', 'true')
    const demo = 'https://marc-elz.github.io/run-tracker-demo-map/style.json'
    expect(mapStyleUrl('abc')).toBe(demo)
    expect(mapStyleUrl(null)).toBe(demo)
  })

  it('uses MapTiler when the demo flag is anything but true', () => {
    vi.stubEnv('VITE_DEMO', 'false')
    expect(mapStyleUrl('abc')).toContain('api.maptiler.com')
  })

  it('reads the key from the environment and ignores a blank one', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', '  ')
    expect(mapKey()).toBeNull()
    vi.stubEnv('VITE_MAPTILER_KEY', ' k ')
    expect(mapKey()).toBe('k')
  })
})
