import { describe, expect, it } from 'vitest'
import { simplifyLine } from '../simplifyTrack'
import type { LngLat } from '../runSummary'

// 0.00001 degrees of latitude is about 1.1 m
const line = (...points: LngLat[]) => points

describe('simplifyLine', () => {
  it('keeps lines of up to two points as they are', () => {
    expect(simplifyLine(line(), 5)).toEqual([])
    expect(simplifyLine(line([4, 52]), 5)).toEqual([[4, 52]])
    expect(simplifyLine(line([4, 52], [4.1, 52.1]), 5)).toEqual([
      [4, 52],
      [4.1, 52.1],
    ])
  })

  it('drops points that lie on the straight line between their neighbours', () => {
    const straight = Array.from({ length: 50 }, (_, i): LngLat => [4, 52 + i * 0.0001])
    expect(simplifyLine(straight, 5)).toEqual([straight[0], straight[49]])
  })

  it('drops a wobble below the tolerance but keeps a real corner', () => {
    // A ~1 m sideways wobble on the way north, then a turn east
    const corner = line([4, 52], [4.000014, 52.0005], [4, 52.001], [4.0015, 52.001])
    expect(simplifyLine(corner, 5)).toEqual([
      [4, 52],
      [4, 52.001],
      [4.0015, 52.001],
    ])
  })

  it('keeps first and last point and the order of a zigzag wider than the tolerance', () => {
    const zigzag = Array.from(
      { length: 20 },
      (_, i): LngLat => [4 + (i % 2) * 0.001, 52 + i * 0.001],
    )
    const out = simplifyLine(zigzag, 5)
    expect(out[0]).toEqual(zigzag[0])
    expect(out[out.length - 1]).toEqual(zigzag[19])
    expect(out).toEqual(zigzag)
  })

  it('handles a loop that returns to its start', () => {
    const loop = line([4, 52], [4.01, 52], [4.01, 52.01], [4, 52.01], [4, 52])
    expect(simplifyLine(loop, 5)).toEqual(loop)
  })

  it('handles a very long track without overflowing the stack', () => {
    const long = Array.from(
      { length: 100_000 },
      (_, i): LngLat => [4 + i * 1e-6, 52 + Math.sin(i / 50) * 0.001],
    )
    expect(simplifyLine(long, 5).length).toBeLessThan(long.length)
  })
})
