import { describe, expect, it } from 'vitest'
import { distanceMeters } from '../geo'

const pt = (lat: number, lon: number) => ({ lat, lon, timestamp: 0 })

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters(pt(52.37, 4.9), pt(52.37, 4.9))).toBe(0)
  })

  it('measures one degree of latitude as ~111.2 km', () => {
    expect(distanceMeters(pt(0, 0), pt(1, 0))).toBeCloseTo(111_195, -2)
  })

  it('is symmetric', () => {
    const a = pt(52.37, 4.9)
    const b = pt(52.38, 4.92)
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6)
  })
})
