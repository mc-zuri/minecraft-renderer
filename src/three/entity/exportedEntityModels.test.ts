import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import * as THREE from 'three'
import { describe, expect, test, vi } from 'vitest'
import { composeEntityLook, type EntityModelEntry } from 'mc-assets/dist/entityModels'
import {
  applyExportedEntityPose,
  buildExportedEntity,
  buildModelEntry,
  cubePolygons,
  entityTextureUrl,
  getEntityModelsStore,
  getExportedEntity,
  isEntityModelsVersionCovered,
  lookInputFromEntity,
  prismarineToGameHeadAngles,
  type ExportedPart
} from './exportedEntityModels'
import reference from './fixtures/entityReferenceQuads-26.3.json'

// textures are fetched in the browser; the meshes are checked without them
vi.mock('../threeJsUtils', () => ({ loadTexture: async () => {} }))

const require = createRequire(import.meta.url)
const mcAssetsDist = path.dirname(require.resolve('mc-assets/dist/entityModels.json'))
const VERSION = '26.3'

/** Entities drawn by other code than the exported models, by how. */
const DRAWN_ELSEWHERE: Record<string, string> = {
  player: 'skinview3d player model',
  mannequin: 'skinview3d player model',
  item: 'item mesh',
  item_frame: 'item frame mesh',
  glow_item_frame: 'item frame mesh',
  text_display: 'nametag text',
  falling_block: 'block mesh',
  tnt: 'block mesh',
  // custom geometry (billboards), drawn by the older bedrock models
  experience_orb: 'bedrock model',
  dragon_fireball: 'bedrock model',
  fishing_bobber: 'bedrock model',
  // only visible while biting: the older bedrock model
  evoker_fangs: 'bedrock model'
}

/** Entities that draw nothing, or nothing this renderer draws. */
const NOT_DRAWN: Record<string, string> = {
  marker: 'no renderer output (NoopRenderer)',
  interaction: 'no renderer output (NoopRenderer)',
  area_effect_cloud: 'no renderer output (NoopRenderer), particles only',
  lightning_bolt: 'custom geometry, not drawn',
  painting: 'custom geometry from the paintings atlas, not drawn',
  ominous_item_spawner: 'draws only the item it is about to drop',
  block_display: 'display entity, drawn by its block',
  item_display: 'display entity, drawn by its item'
}

const allEntities = (): string[] => {
  const mcData = require('minecraft-data')(VERSION)
  return mcData.entitiesArray.map((e: { name: string }) => e.name)
}

const textureFile = (texture: string) => path.join(mcAssetsDist, 'other-textures/latest', entityTextureUrl(texture).replace(/^textures\//, ''))

describe('exported entity models (26.3)', () => {
  test('every entity draws an exported model, an item, or is drawn elsewhere or not at all, on purpose', () => {
    const uncovered: string[] = []
    for (const name of allEntities()) {
      if (DRAWN_ELSEWHERE[name] || NOT_DRAWN[name]) continue
      const exported = getExportedEntity(VERSION, name)
      if (!exported) {
        uncovered.push(`${name}: not exported`)
        continue
      }
      const look = composeEntityLook(exported)
      const drawsModel = look.some(({ entry }) => entry.type === 'model' && entry.renderType !== 'water_mask')
      const drawsItem = !!exported.item && look.length === 1 && look[0].entry.type === 'item'
      if (!drawsModel && !drawsItem) uncovered.push(`${name}: draws ${look.map(({ entry }) => entry.type).join(', ') || 'nothing'}`)
    }
    expect(uncovered).toEqual([])
  })

  test('the entities of the lists exist', () => {
    const names = new Set(allEntities())
    expect(Object.keys({ ...DRAWN_ELSEWHERE, ...NOT_DRAWN }).filter(name => !names.has(name))).toEqual([])
  })

  test('every texture of every look exists in mc-assets', () => {
    const missing = new Set<string>()
    for (const name of allEntities()) {
      const exported = getExportedEntity(VERSION, name)
      for (const state of exported?.states ?? []) {
        for (const entry of Object.values(state.look ?? state.patch ?? {})) {
          const texture = entry?.texture as string | undefined
          if (texture && !texture.includes(':atlas/') && !fs.existsSync(textureFile(texture))) missing.add(`${name}: ${texture}`)
        }
      }
    }
    expect([...missing]).toEqual([])
  })

  test('the entities the bedrock models did not have build meshes', () => {
    for (const name of ['happy_ghast', 'copper_golem', 'nautilus', 'zombie_nautilus', 'camel_husk', 'parched', 'sulfur_cube', 'armadillo', 'bogged', 'breeze', 'creaking', 'end_crystal', 'giant', 'illusioner', 'wind_charge']) {
      const build = buildExportedEntity(VERSION, name)
      expect(build, name).toBeTruthy()
      let meshes = 0
      build!.object.traverse(child => {
        if (child instanceof THREE.SkinnedMesh) meshes++
      })
      expect(meshes, name).toBeGreaterThan(0)
    }
  })

  test('versions before the oldest export keep the older models', () => {
    expect(isEntityModelsVersionCovered(VERSION)).toBe(true)
    expect(getEntityModelsStore().versions[0]).toBeTruthy()
    expect(isEntityModelsVersionCovered('1.8.8')).toBe(getEntityModelsStore().versions[0] === '1.8.8')
  })
})

/** The quads a built model entry draws, in entity space, skipping parts the pose hides (as ModelPart.render skips them). */
function drawnQuads(entry: EntityModelEntry) {
  const layer = getEntityModelsStore().getModel(VERSION, entry.model)!
  const parts = new Map<string, ExportedPart[]>()
  const holder = buildModelEntry(entry, layer, parts)
  holder.updateMatrixWorld(true)
  const mesh = holder.children[0] as THREE.SkinnedMesh
  const hidden = (bone: THREE.Object3D) => {
    for (let current: THREE.Object3D | null = bone; current && current !== mesh; current = current.parent) {
      if (current.scale.x === 0 && current.scale.y === 0 && current.scale.z === 0) return true
    }
    return false
  }
  const position = mesh.geometry.getAttribute('position')
  const uv = mesh.geometry.getAttribute('uv')
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const quads: number[][][] = []
  for (let start = 0; start < position.count; start += 4) {
    if (hidden(mesh.skeleton.bones[skinIndex.getX(start)])) continue
    const quad: number[][] = []
    for (let i = start; i < start + 4; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(position, i)
      mesh.applyBoneTransform(i, vertex)
      vertex.applyMatrix4(mesh.matrixWorld)
      quad.push([vertex.x, vertex.y, vertex.z, uv.getX(i), uv.getY(i)])
    }
    quads.push(quad)
  }
  return quads
}

describe('built meshes draw what the game draws', () => {
  for (const [name, entries] of Object.entries(reference as Record<string, Record<string, number[][][]> | string>)) {
    if (typeof entries === 'string') continue
    test(name, () => {
      const look = composeEntityLook(getExportedEntity(VERSION, name)!)
      for (const [key, expected] of Object.entries(entries)) {
        const entry = look.find(l => l.key === key)?.entry as EntityModelEntry
        expect(entry, key).toBeTruthy()
        const actual = drawnQuads(entry)
        expect(actual.length, key).toBe(expected.length)
        for (const [q, quad] of expected.entries()) {
          for (const [v, vertex] of quad.entries()) {
            for (let c = 0; c < 5; c++) {
              const tolerance = c < 3 ? 1e-4 : 1e-5
              if (Math.abs(actual[q][v][c] - vertex[c]) > tolerance) {
                throw new Error(`${key} quad ${q} vertex ${v}: ${actual[q][v].join(', ')}, the game draws ${vertex.join(', ')}`)
              }
            }
          }
        }
      }
    })
  }
})

describe('cubes like ModelPart.Cube', () => {
  test('a mirrored cube swaps its x faces and reverses their corners', () => {
    const plain = cubePolygons({ origin: [0, 0, 0], size: [4, 12, 4], uv: [40, 16] }, [64, 64])
    const mirrored = cubePolygons({ origin: [0, 0, 0], size: [4, 12, 4], uv: [40, 16], mirror: true }, [64, 64])
    expect(plain[2].normal).toEqual([-1, 0, 0]) // west
    expect(mirrored[2].normal).toEqual([1, 0, 0])
    expect(mirrored[2].vertices.map(v => v.slice(3))).toEqual([...plain[2].vertices.map(v => v.slice(3))].reverse())
  })

  test('only the visible faces, and a cube texture scale', () => {
    const polygons = cubePolygons({ origin: [-12, -2, 0], size: [16, 4, 0], uv: [0, 0], faces: ['north', 'south'], textureSize: [32, 25.6] }, [32, 32])
    expect(polygons.map(p => p.normal)).toEqual([
      [0, 0, -1],
      [0, 0, 1]
    ])
    expect(polygons[0].vertices[2][4]).toBeCloseTo(4 / 25.6)
  })
})

describe('posing', () => {
  test('the head turns by the head yaw relative to the body and the pitch', () => {
    const build = buildExportedEntity(VERSION, 'zombie')!
    const head = build.rig.parts.get('head')![0]
    applyExportedEntityPose(build.rig, { netHeadYaw: 0.5, headPitch: -0.25, limbSwing: 0, limbSwingAmount: 0 })
    expect(head.bone.rotation.y).toBeCloseTo(head.rest.rotation.y + 0.5)
    expect(head.bone.rotation.x).toBeCloseTo(head.rest.rotation.x - 0.25)
  })

  test('walking swings the legs from their rest pose', () => {
    const build = buildExportedEntity(VERSION, 'cow')!
    const leg = build.rig.parts.get('right_hind_leg')![0]
    applyExportedEntityPose(build.rig, { netHeadYaw: 0, headPitch: 0, limbSwing: 0, limbSwingAmount: 1 })
    expect(leg.bone.rotation.x).toBeCloseTo(leg.rest.rotation.x + 1.4)
    applyExportedEntityPose(build.rig, { netHeadYaw: 0, headPitch: 0, limbSwing: 0, limbSwingAmount: 0 })
    expect(leg.bone.rotation.x).toBeCloseTo(leg.rest.rotation.x)
  })

  test('prismarine angles to the game: body and head yaw are counterclockwise radians, pitch is positive up', () => {
    expect(prismarineToGameHeadAngles(1, 1.5, 0.2).netHeadYaw).toBeCloseTo(-0.5)
    expect(prismarineToGameHeadAngles(0, 0, 0.2).headPitch).toBeCloseTo(-0.2)
    expect(prismarineToGameHeadAngles(0.1, Math.PI * 2 - 0.1, 0).netHeadYaw).toBeCloseTo(0.2)
  })
})

describe('looks from entity state', () => {
  test('equipment by protocol slot, metadata as given', () => {
    const input = lookInputFromEntity({ metadata: [0, 1], equipment: [null, null, null, null, null, null, { name: 'wolf_armor' }, { name: 'saddle' }] })
    expect(input.equipment).toEqual({ body: 'wolf_armor', saddle: 'saddle' })
    expect(input.metadata).toEqual([0, 1])
  })

  test('a saddled pig draws the saddle layer', () => {
    const build = buildExportedEntity(VERSION, 'pig', { equipment: { saddle: 'saddle' } })!
    const names: string[] = []
    build.object.traverse(child => names.push(child.name))
    expect(names).toContain('geometry_minecraft:pig#saddle')
  })
})
