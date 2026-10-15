import { describe, expect, test } from 'vitest'
import { cubeMobScale, cubeMobSize, cubeMobSquish } from './cubeMobs'
import { EntityAnimTracker, type EntityAnimInput } from './entityAnimState'
import './drivers'

describe('slimes and magma cubes', () => {
  test("the renderer's scale: the size on every axis at rest, landing squashes, leaving the ground stretches", () => {
    expect(cubeMobScale(1, 0)).toEqual([1, 1, 1])
    expect(cubeMobScale(4, 0)).toEqual([4, 4, 4])
    // squish -0.5 on a size 2 slime: h = -0.25, i = 4/3: wider and lower
    const [x, y, z] = cubeMobScale(2, -0.5)
    expect(x).toBeCloseTo(8 / 3, 5)
    expect(y).toBeCloseTo(1.5, 5)
    expect(z).toBeCloseTo(8 / 3, 5)
    const [sx, sy] = cubeMobScale(1, 1)
    expect(sx).toBeLessThan(1)
    expect(sy).toBeGreaterThan(1)
  })

  test("the size from the version's synched data: 1.8's index 16, 1.9's 11, 12 until 1.14, then by name", () => {
    const input = (version: string, data: Record<number, unknown>, meta: Record<string, unknown> = {}) => ({ version, data, meta })
    expect(cubeMobSize(input('1.8.8', { 16: 4 }), {})).toBe(4)
    expect(cubeMobSize(input('1.9.4', { 11: 2 }), {})).toBe(2)
    expect(cubeMobSize(input('1.12.2', { 12: 4 }), {})).toBe(4)
    expect(cubeMobSize(input('1.16.5', { 15: 2 }), { 15: 'id_size' })).toBe(2)
    expect(cubeMobSize(input('26.3', {}, { size: 4 }), {})).toBe(4)
    expect(cubeMobSize(input('26.3', {}), {})).toBe(1)
  })

  test('a slime leaving the ground stretches, landing squashes (the squish the scale reads)', () => {
    for (const [version, exportVersion] of [['26.3', '26.3'], ['1.12.2', '1.12.2'], ['1.8.8', '1.8.9']]) {
      const name = version === '1.8.8' ? 'lava_slime' : 'slime'
      const tracker = new EntityAnimTracker(name, version)
      const input = { name, version, meta: {}, data: {}, bodyYaw: 0, headYaw: 0, pitch: 0, position: { x: 0, y: 64, z: 0 }, onGround: true, equipment: {}, entityId: 1, renderHints: {} } as EntityAnimInput
      tracker.setInput(input)
      // settled on the ground (the first tick on it is a landing)
      for (let i = 0; i < 20; i++) tracker.tick()
      input.onGround = false
      tracker.setInput(input)
      // (26.3's frame interpolates: at partial tick 0 it is a tick behind)
      for (let i = 0; i < 3; i++) tracker.tick()
      expect(cubeMobSquish(tracker, exportVersion), `${version} in the air`).toBeGreaterThan(0)
      input.onGround = true
      tracker.setInput(input)
      for (let i = 0; i < 4; i++) tracker.tick()
      expect(cubeMobSquish(tracker, exportVersion), `${version} landed`).toBeLessThan(0)
    }
  })
})
