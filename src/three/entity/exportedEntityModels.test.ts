import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import * as THREE from 'three'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { composeEntityLook, type EntityModelEntry } from 'mc-assets/dist/entityModels'
import {
  applyExportedEntityPose,
  buildExportedEntity,
  buildModelEntry,
  cubePolygons,
  entityTextureUrl,
  entityTextureUrls,
  entityModelName,
  buildExportedPainting,
  exportedEntityLook,
  paintingInputFromEntity,
  paintingOffset,
  setServerPaintingVariants,
  entityExportVersionFor,
  resolveExportedEntityName,
  entityModelsVersions,
  getEntityModelsStore,
  loadEntityModels,
  setEntityModelsSource,
  getExportedEntity,
  isEntityModelsVersionCovered,
  lookInputFromEntity,
  prismarineToGameHeadAngles,
  type ExportedPart
} from './exportedEntityModels'
import { isBoatEntityName } from './boatModelRotation'
import reference26 from './fixtures/entityReferenceQuads-26.3.json'
import reference1214 from './fixtures/entityReferenceQuads-1.21.4.json'
import reference1204 from './fixtures/entityReferenceQuads-1.20.4.json'
import reference1144 from './fixtures/entityReferenceQuads-1.14.4.json'
import reference189 from './fixtures/entityReferenceQuads-1.8.9.json'

// textures are fetched in the browser; the meshes are checked without them
vi.mock('../threeJsUtils', () => ({ loadThreeJsTextureFromUrlSync: () => ({ promise: new Promise(() => {}) }) }))

const require = createRequire(import.meta.url)
const mcAssetsDist = path.dirname(require.resolve('mc-assets/dist/entityModels.json'))
const VERSION = '26.3'

// the exports the browser fetches (entity-models/<version>.json), read from mc-assets
setEntityModelsSource({ load: async exportVersion => JSON.parse(fs.readFileSync(path.join(mcAssetsDist, 'entityModels', `${exportVersion}.json`), 'utf8')) })
beforeAll(async () => {
  for (const version of entityModelsVersions()) await loadEntityModels(version)
})

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
  ominous_item_spawner: 'draws only the item it is about to drop',
  block_display: 'display entity, drawn by its block',
  item_display: 'display entity, drawn by its item'
}

/** Abstract entries of minecraft-data's 1.8 to 1.10 lists, no entity of the game. */
const NOT_ENTITIES = new Set(['mob', 'monster'])

/**
 * GL-era versions (1.8 to 1.14): what their renderers draw with the tessellator or as blocks, drawn by the older models
 * or as items and blocks, under the names those versions have.
 */
const DRAWN_ELSEWHERE_BEFORE_1_15: Record<string, string> = {
  fishing_float: 'bedrock model',
  fishing_hook: 'bedrock model',
  xp_orb: 'bedrock model',
  fireball: 'drawn as an item (ITEM_ENTITY_ITEMS)',
  small_fireball: 'drawn as an item (ITEM_ENTITY_ITEMS)',
  primed_tnt: 'block mesh',
  falling_sand: 'block mesh',
  tipped_arrow: 'custom geometry, OBJ model',
  evocation_fangs: 'bedrock model'
}

/** Older versions: what their renderers draw as custom geometry, drawn by the older models. */
const DRAWN_ELSEWHERE_BEFORE_1_21_2: Record<string, string> = {
  arrow: 'custom geometry, OBJ model',
  spectral_arrow: 'custom geometry, OBJ model'
}

/** minecraft-data's entity names as entities.ts looks them up (PigZombie: pig_zombie). */
const allEntities = (version = VERSION): string[] => {
  const mcData = require('minecraft-data')(version)
  const names = mcData.entitiesArray.map((e: { name: string }) => resolveExportedEntityName(version, entityModelName(e.name)))
  return [...new Set<string>(names)].filter(name => !NOT_ENTITIES.has(name))
}

/** Exported versions minecraft-data has entities of (it reads 1.21.2 as 1.21). */
const dataVersions = () => entityModelsVersions().filter(version => require('minecraft-data')(version)?.version.minecraftVersion === version)

const versionNumber = (version: string) => {
  const [x, y = '0', z = '0'] = version.split('.')
  return +`${x.padStart(2, '0')}${y.padStart(2, '0')}${z.padStart(2, '0')}`
}

/** The file the version reads first: its own older copy when mc-assets keeps one, else the latest. */
const textureFile = (texture: string, version: string) => {
  const url = entityTextureUrls(texture, version)[0]
  const versioned = url.match(/^textures\/(\d[\d.]*)\/(.*)$/)
  return versioned ? path.join(mcAssetsDist, 'other-textures', versioned[1], versioned[2]) : path.join(mcAssetsDist, 'other-textures/latest', url.replace(/^textures\//, ''))
}

describe('exported entity models', () => {
  test.each(dataVersions())('%s: every entity draws an exported model, an item, or is drawn elsewhere or not at all, on purpose', version => {
    const uncovered: string[] = []
    const elsewhere = {
      ...DRAWN_ELSEWHERE,
      ...(versionNumber(version) < versionNumber('1.21.2') ? DRAWN_ELSEWHERE_BEFORE_1_21_2 : {}),
      ...(versionNumber(version) < versionNumber('1.15') ? DRAWN_ELSEWHERE_BEFORE_1_15 : {})
    }
    for (const name of allEntities(version)) {
      // boats keep the OBJ model their paddle, water patch and passenger rigs are made for
      if (elsewhere[name] || NOT_DRAWN[name] || isBoatEntityName(name)) continue
      // paintings: PaintingRenderer's quads from the export, every variant
      if (name === 'painting') {
        const paintings = getEntityModelsStore(version)?.getPaintings(version)
        if (!paintings?.variants.length) uncovered.push('painting: no paintings exported')
        for (const [index, variant] of paintings?.variants.entries() ?? []) {
          if (!buildExportedPainting(version, { variant: index, direction: 0 })) uncovered.push(`painting ${variant.id}: not drawn`)
        }
        continue
      }
      const exported = getExportedEntity(version, name)
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

  test.each(dataVersions())('%s: every texture of every look exists in mc-assets', version => {
    const missing = new Set<string>()
    for (const name of allEntities(version)) {
      const exported = getExportedEntity(version, name)
      for (const state of exported?.states ?? []) {
        for (const entry of Object.values(state.look ?? state.patch ?? {})) {
          const texture = entry?.texture as string | undefined
          if (texture && !texture.includes(':atlas/') && !fs.existsSync(textureFile(texture, version))) missing.add(`${name}: ${texture}`)
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
    expect(entityModelsVersions()[0]).toBeTruthy()
    expect(isEntityModelsVersionCovered('1.8.8')).toBe(entityModelsVersions()[0].startsWith('1.8'))
    expect(isEntityModelsVersionCovered('1.17')).toBe(true)
  })

  test('GL-era worlds read their own export, not 1.15.2', () => {
    const own = (version: string, name: string) => JSON.stringify(getExportedEntity(version, name))
    // mineflayer's 1.8.8 reads the 1.8.9 export, under 1.8 names
    expect(isEntityModelsVersionCovered('1.8.8')).toBe(true)
    expect(entityModelName('PigZombie')).toBe('pig_zombie')
    for (const name of ['pig_zombie', 'entity_horse', 'villager_golem', 'ozelot', 'snow_man', 'lava_slime', 'mushroom_cow']) {
      expect(buildExportedEntity('1.8.8', name), name).toBeTruthy()
    }
    for (const version of ['1.8.8', '1.9.4', '1.10.2', '1.11.2', '1.12.2', '1.13.2', '1.14.4']) {
      expect(own(version, 'zombie'), version).not.toBe(own('1.15.2', 'zombie'))
    }
    expect(buildExportedEntity('1.13.2', 'drowned')).toBeTruthy()
    expect(buildExportedEntity('1.12.2', 'parrot')).toBeTruthy()
    // a 1.8 zombie's texture is the 1.8 one mc-assets keeps
    const texture = (composeEntityLook(getExportedEntity('1.8.8', 'zombie')!)[0].entry as EntityModelEntry).texture!
    expect(entityTextureUrls(texture, '1.8.8')[0]).toMatch(/^textures\/1\.\d+\/entity\/zombie\/zombie\.png$/)
  })
})

/** The quads a built model entry draws, in entity space, skipping parts the pose hides (as ModelPart.render skips them). */
function drawnQuads(version: string, entry: EntityModelEntry) {
  const layer = getEntityModelsStore(version)!.getModel(version, entry.model)!
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

// the game's quads for a few entities, written by the exporter: 26.3 (submit node collectors), 1.21.4 (render states,
// buffers) and 1.20.4 (entities drawn part by part)
describe.each([reference26, reference1214, reference1204, reference1144, reference189] as unknown as Array<Record<string, Record<string, number[][][]> | string>>)('built meshes draw what $version draws', reference => {
  const version = reference.version as string
  for (const [name, entries] of Object.entries(reference)) {
    if (typeof entries === 'string' || name === 'paintings') continue
    test(name, () => {
      const look = composeEntityLook(getExportedEntity(version, name)!)
      for (const [key, expected] of Object.entries(entries)) {
        const entry = look.find(l => l.key === key)?.entry as EntityModelEntry
        expect(entry, key).toBeTruthy()
        const actual = drawnQuads(version, entry)
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

describe('textures by version', () => {
  test('a version loads the copy of a texture it had, then the latest one', () => {
    expect(entityTextureUrls('minecraft:entity/iron_golem/iron_golem', '1.15.2')).toEqual([
      'textures/1.19/entity/iron_golem/iron_golem.png',
      'textures/entity/iron_golem/iron_golem.png'
    ])
    expect(entityTextureUrls('minecraft:entity/iron_golem/iron_golem', '26.3')).toEqual(['textures/entity/iron_golem/iron_golem.png'])
  })
})

describe('exports loaded per version', () => {
  test('a world version loads the export it reads, once', async () => {
    expect(loadEntityModels('1.12')).toBe(loadEntityModels('1.11.2'))
    expect(await loadEntityModels('1.7.10')).toBeUndefined()
    expect(getEntityModelsStore('1.21.3')).toBe(getEntityModelsStore('1.21.2'))
    expect(getEntityModelsStore('1.21.3')).not.toBe(getEntityModelsStore('1.21.4'))
  })

  test('an entity behind a feature flag in its release is drawn from the next export that has it', () => {
    expect(entityExportVersionFor('1.19.4', 'camel')).toBe('1.20.1')
    expect(entityExportVersionFor('1.20.5', 'breeze')).toBe('1.21.1')
    expect(entityExportVersionFor('1.19.4', 'cow')).toBe('1.19.4')
    expect(buildExportedEntity('1.19.4', 'camel')).toBeTruthy()
  })
})

type PaintingReference = { variant: string; frontRect: number[]; backRect: number[]; north: number[][][]; east: number[][][] }

/** The quads of a built painting relative to the painting entity (the block offset taken away), by face, uvs within the face's texture. */
function paintingQuads(painting: THREE.Group) {
  const turned = painting.children[0]!
  const offset = turned.position.clone()
  turned.updateMatrix()
  const byFace: Record<string, number[][][]> = {}
  for (const mesh of turned.children as THREE.Mesh[]) {
    const position = mesh.geometry.getAttribute('position')
    const uv = mesh.geometry.getAttribute('uv')
    const quads: number[][][] = []
    for (let start = 0; start < position.count; start += 4) {
      const quad: number[][] = []
      for (let i = start; i < start + 4; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(turned.matrix).sub(offset)
        quad.push([vertex.x, vertex.y, vertex.z, uv.getX(i), uv.getY(i)])
      }
      quads.push(quad)
    }
    byFace[mesh.name.replace('painting_', '')] = quads
  }
  return byFace
}

describe.each([reference26, reference1214, reference1204, reference1144, reference189] as Array<Record<string, unknown>>)('paintings draw what $version draws', reference => {
  const version = reference.version as string
  for (const [size, painting] of Object.entries((reference.paintings ?? {}) as Record<string, PaintingReference>)) {
    test(size, () => {
      for (const [facing, direction] of [['north', 2], ['east', 3]] as const) {
        const built = paintingQuads(buildExportedPainting(version, { variant: painting.variant, direction })!)
        const inside = (quad: number[][], rect: number[]) => quad.every(([, , , u, v]) => u! >= rect[0]! - 1e-6 && u! <= rect[2]! + 1e-6 && v! >= rect[1]! - 1e-6 && v! <= rect[3]! + 1e-6)
        for (const face of ['front', 'back'] as const) {
          const rect = face === 'front' ? painting.frontRect : painting.backRect
          // the game's quads of the face, uvs within its sprite
          const expected = painting[facing].filter(quad => inside(quad, rect) && (face === 'back' || !inside(quad, painting.backRect)))
          const actual = built[face]!
          expect(actual.length, `${size} ${facing} ${face}`).toBe(expected.length)
          for (const [q, quad] of expected.entries()) {
            for (const [v, vertex] of quad.entries()) {
              // the game's uv within the sprite it samples, read in the reader's texture rectangle (all of a painting's
              // texture since 1.14, the painting's part of the 1.8 paintings texture before)
              const paintings = getEntityModelsStore(version)!.getPaintings(version)!
              const reader = (face === 'front' ? paintings.variants.find(v => v.id === painting.variant)!.rect : paintings.back.rect) ?? [0, 0, 1, 1]
              const nu = (vertex[3]! - rect[0]!) / (rect[2]! - rect[0]!)
              const nv = (vertex[4]! - rect[1]!) / (rect[3]! - rect[1]!)
              const normalized = [vertex[0]!, vertex[1]!, vertex[2]!, reader[0]! + nu * (reader[2]! - reader[0]!), reader[1]! + nv * (reader[3]! - reader[1]!)]
              for (let c = 0; c < 5; c++) {
                if (Math.abs(actual[q]![v]![c]! - normalized[c]!) > 1e-4) throw new Error(`${size} ${facing} ${face} quad ${q} vertex ${v}: ${actual[q]![v]!.join(', ')}, the game draws ${normalized.join(', ')}`)
              }
            }
          }
        }
      }
    })
  }
})

describe('paintings', () => {
  test('a painting hangs from its block as HangingEntity centers it', () => {
    // a 1x1 painting facing south sits half a pixel off the north face of its block's south side
    expect(paintingOffset(1, 1, 0)).toEqual([0.5, 0.5, 0.5 - 0.468_75])
    // a 2x2 painting facing north is shifted half a block west and up
    expect(paintingOffset(2, 2, 2)).toEqual([0, 1, 0.5 + 0.468_75])
  })

  test('the variant and facing come from metadata, spawn data or a client', () => {
    const keys = ['shared_flags', 'air_supply', 'custom_name', 'custom_name_visible', 'silent', 'no_gravity', 'pose', 'ticks_frozen', 'direction', 'painting_variant']
    expect(paintingInputFromEntity({ metadata: { 8: 5, 9: { variantId: 3 } } }, keys)).toEqual({ variant: 3, direction: 3 })
    expect(paintingInputFromEntity({ metadata: { 8: 7 }, objectData: 4 }, keys.slice(0, 8).concat('painting_variant'))).toEqual({ variant: 7, direction: 1 })
    expect(paintingInputFromEntity({ paintingVariant: 'Kebab', paintingDirection: 2 }, undefined)).toEqual({ variant: 'Kebab', direction: 2 })
  })

  test('every variant of the version draws, a datapack size too', () => {
    const paintings = getEntityModelsStore(VERSION)!.getPaintings(VERSION)!
    for (const [index, variant] of paintings.variants.entries()) {
      expect(buildExportedPainting(VERSION, { variant: index, direction: 0 }), variant.id).toBeTruthy()
    }
    setServerPaintingVariants([{ id: 'test:huge', assetId: 'test:huge', width: 5, height: 6 }])
    const huge = paintingQuads(buildExportedPainting(VERSION, { variant: 0, direction: 2 })!)
    // 30 fronts and backs, 5 top and bottom edges, 6 left and right edges
    expect(huge.front!.length).toBe(30)
    expect(huge.back!.length).toBe(30 + 10 + 12)
    setServerPaintingVariants(undefined)
  })
})

describe('armor', () => {
  test('a zombie wears the armor layers the game draws, a dyed piece tinted', () => {
    const zombie = getExportedEntity(VERSION, 'zombie')!
    expect(Object.keys(zombie.armor!).sort()).toEqual(['chest', 'feet', 'head', 'legs'])
    const look = exportedEntityLook(zombie, { equipment: { head: 'iron_helmet', chest: 'leather_chestplate' }, equipmentColors: { chest: 0x33_66_99 } })
    const armor = look.filter(({ key }) => key.startsWith('armor/'))
    expect(armor.some(({ key, entry }) => key.startsWith('armor/head/') && (entry as EntityModelEntry).texture?.includes('iron'))).toBe(true)
    const dyed = armor.filter(({ key }) => key.startsWith('armor/chest/')).map(({ entry }) => (entry as EntityModelEntry).tint)
    expect(dyed).toContain((0xff_33_66_99 | 0) >> 0)
    const build = buildExportedEntity(VERSION, 'zombie', { equipment: { head: 'iron_helmet' } })!
    expect(build.rig.armor).toBe(true)
    expect(build.object.children.length).toBeGreaterThan(buildExportedEntity(VERSION, 'zombie')!.object.children.length)
  })

  test.each(dataVersions())('%s: zombies and skeletons wear the armor the game draws', version => {
    for (const name of ['zombie', 'skeleton']) {
      const armor = getExportedEntity(version, name)!.armor!
      expect(Object.keys(armor).sort(), `${version} ${name}`).toEqual(['chest', 'feet', 'head', 'legs'])
      expect(buildExportedEntity(version, name, { equipment: { chest: 'iron_chestplate', head: 'diamond_helmet' } })!.rig.armor).toBe(true)
    }
  })

  test('armor stands, skeletons and piglins wear armor', () => {
    for (const name of ['armor_stand', 'skeleton', 'piglin', 'drowned', 'husk', 'zombified_piglin']) {
      expect(getExportedEntity(VERSION, name)?.armor?.chest?.diamond_chestplate, name).toBeTruthy()
    }
  })
})
