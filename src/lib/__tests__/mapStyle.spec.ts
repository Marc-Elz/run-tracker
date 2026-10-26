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

  it('reads the key from the environment and ignores a blank one', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', '  ')
    expect(mapKey()).toBeNull()
    vi.stubEnv('VITE_MAPTILER_KEY', ' k ')
    expect(mapKey()).toBe('k')
  })
})
