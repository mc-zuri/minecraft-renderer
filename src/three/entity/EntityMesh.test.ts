import { describe, expect, it, vi } from 'vitest'

vi.mock('../threeJsUtils', () => ({
  loadNearestFilterTexture: vi.fn(),
  loadTexture: vi.fn(),
}))
vi.mock('./objModels', () => ({ externalModels: {} }))

import * as THREE from 'three'
import { EntityMesh, getMesh } from './EntityMesh'

describe('Bedrock per-face entity UVs', () => {
  it('creates finite UVs and only emits declared faces', () => {
    const mesh = getMesh(undefined, 'data:image/png;base64,', {
      texturewidth: 24,
      textureheight: 3,
      bones: [{
        name: 'body',
        cubes: [{
          origin: [-1.5, -1.5, -1.5],
          size: [3, 3, 3],
          uv: {
            north: { uv: [9, 0], uv_size: [-3, 3] },
          },
        }],
      }],
    })

    const uv = [...mesh.geometry.getAttribute('uv').array]
    expect(uv).toHaveLength(8)
    expect(uv.every(Number.isFinite)).toBe(true)
    expect(mesh.geometry.index?.count).toBe(6)
  })

  it('uses face dimensions when uv_size is omitted', () => {
    const mesh = getMesh(undefined, 'data:image/png;base64,', {
      texturewidth: 24,
      textureheight: 3,
      bones: [{
        name: 'line',
        cubes: [{
          origin: [0, -4.5, -0.5],
          size: [0, 3, 3],
          uv: { east: { uv: [18, 0] } },
        }],
      }],
    })

    const uv = [...mesh.geometry.getAttribute('uv').array]
    expect(uv.every(Number.isFinite)).toBe(true)
    expect(Math.max(...uv) - Math.min(...uv)).toBeGreaterThan(0)
  })

  it('builds finite, bounded geometry for the bundled fishing bobber', () => {
    const entity = new EntityMesh('1.16.4', 'fishing_bobber')
    const geometries: THREE.BufferGeometry[] = []
    entity.mesh.traverse(child => {
      if (child instanceof THREE.Mesh) geometries.push(child.geometry)
    })

    expect(geometries.length).toBeGreaterThan(0)
    for (const geometry of geometries) {
      const positions = [...geometry.getAttribute('position').array]
      const uv = [...geometry.getAttribute('uv').array]
      expect(positions.every(Number.isFinite)).toBe(true)
      expect(uv.every(Number.isFinite)).toBe(true)
      expect(Math.max(...positions.map(Math.abs))).toBeLessThanOrEqual(5)
    }
  })
})
