import * as THREE from 'three'
import { snakeCase } from 'change-case'
import entityModelsIndex from 'mc-assets/dist/entityModelsIndex.json'
import {
  composeEntityArmor,
  composeEntityLook,
  ENTITY_EQUIPMENT_SLOTS,
  paintingVariant,
  type PaintingsData,
  type PaintingVariant,
  entityModelsExportFor,
  entityTextureFolder,
  EntityModelsStore,
  type EntityBlockEntry,
  type EntityCustomEntry,
  type EntityDefinition,
  type EntityItemEntry,
  type EntityLookEntry,
  type EntityLookInput,
  type EntityModelCube,
  type EntityModelEntry,
  type EntityModelLayer,
  type EntityModelPart,
  type EntityModelsData,
  type EntityModelsIndex
} from 'mc-assets/dist/entityModels'
import { createCanvas } from '../../lib/utils'
import { loadThreeJsTextureFromUrlSync } from '../threeJsUtils'

/**
 * Entity models exported from the game (mc-assets' dist/entityModels.json, made by minecraft-model-generator): the
 * game's model layers as part trees and, per entity, what its renderer draws for the entity's metadata and equipment.
 *
 * A model entry becomes a SkinnedMesh whose bones are the model's parts, so the parts can still be posed (head look,
 * walking) after the mesh is built: vertices are baked in the layer's initial pose, then the renderer's pose for the
 * look (setupAnim of the game, at rest) is applied to the bones. Everything is in the game's model space (pixels, y
 * down) under the entry's transform, which already holds the renderer's scale(-1, -1, 1) and 1.501 translation.
 */

/** The exported versions and the older texture copies (mc-assets' dist/entityModelsIndex.json, bundled: a few KB). */
const index = entityModelsIndex as unknown as EntityModelsIndex

/** The exported versions, oldest first. */
export const entityModelsVersions = () => index.versions

/**
 * Where the exports are loaded from: mc-assets' dist/entityModels/<version>.json, served next to the textures as
 * entity-models/<version>.json (relative to the page, or the worker script, like textures/).
 */
let loadExport: (exportVersion: string) => Promise<EntityModelsData> = async exportVersion => {
  const response = await fetch(`${entityModelsBaseUrl}${exportVersion}.json`)
  if (!response.ok) throw new Error(`entity models ${exportVersion}: HTTP ${response.status}`)
  return response.json()
}
let entityModelsBaseUrl = 'entity-models/'

/** Where to load the exports from: a base url, or a loader of an export's data (tests read the files). */
export const setEntityModelsSource = (source: { baseUrl?: string; load?: (exportVersion: string) => Promise<EntityModelsData> }) => {
  if (source.baseUrl !== undefined) entityModelsBaseUrl = source.baseUrl
  if (source.load) loadExport = source.load
}

const stores = new Map<string, EntityModelsStore>()
const loading = new Map<string, Promise<EntityModelsStore | undefined>>()
const loadedListeners = new Set<(exportVersion: string) => void>()

/** Called when an export is loaded: entities drawn by the older models meanwhile can be built again. */
export const onEntityModelsLoaded = (listener: (exportVersion: string) => void) => {
  loadedListeners.add(listener)
  return () => loadedListeners.delete(listener)
}

/** Loads the export a world version reads (once); resolves to undefined when the version is not covered or it fails. */
export const loadEntityModels = (version: string): Promise<EntityModelsStore | undefined> => {
  if (!isEntityModelsVersionCovered(version)) return Promise.resolve(undefined)
  const exportVersion = entityModelsExportFor(index.versions, version)!
  let promise = loading.get(exportVersion)
  if (!promise) {
    promise = loadExport(exportVersion).then(
      data => {
        const store = new EntityModelsStore(data)
        stores.set(exportVersion, store)
        for (const listener of loadedListeners) listener(exportVersion)
        return store
      },
      err => {
        console.error('[entity models] failed to load', exportVersion, err)
        return undefined
      }
    )
    loading.set(exportVersion, promise)
  }
  return promise
}

/**
 * The loaded export a world version reads; undefined (and loading starts) while it is not loaded yet: until then
 * entities are drawn by the renderer's older models.
 */
export const getEntityModelsStore = (version: string): EntityModelsStore | undefined => {
  if (!isEntityModelsVersionCovered(version)) return undefined
  const store = stores.get(entityModelsExportFor(index.versions, version)!)
  if (!store) void loadEntityModels(version)
  return store
}

const versionToNumber = (version: string) => {
  const [x, y = '0', z = '0'] = version.split('.')
  return +`${x.padStart(2, '0')}${y.padStart(2, '0')}${z.padStart(2, '0')}`
}

/**
 * Versions the exports cover: from the major version of the oldest export on (1.17 when the oldest is 1.17.1; older
 * versions keep the renderer's own models). A version between two exports uses the older one.
 */
export const isEntityModelsVersionCovered = (version: string) => {
  const versions = index.versions
  if (!versions.length || !version) return false
  const [major, minor] = versions[0].split('.')
  return versionToNumber(version) >= versionToNumber(minor === undefined ? major : `${major}.${minor}`)
}

/**
 * Names minecraft-data gives objects (spawned with the spawn object packet before 1.14) that are not the names the game
 * registers them by: the exported names to try, in order.
 */
const OBJECT_NAMES: Record<string, string[]> = {
  item_stack: ['item'],
  'area_effect cloud': ['area_effect_cloud'],
  activated_tnt: ['tnt', 'primed_tnt'],
  endercrystal: ['end_crystal', 'ender_crystal'],
  tipped_arrow: ['arrow'],
  firecharge: ['small_fireball'],
  thrown_enderpearl: ['ender_pearl'],
  falling_objects: ['falling_block'],
  item_frames: ['item_frame'],
  'eye_of ender': ['eye_of_ender', 'eye_of_ender_signal'],
  thrown_potion: ['potion'],
  'thrown_exp bottle': ['experience_bottle', 'xp_bottle'],
  armorstand: ['armor_stand'],
  fishing_hook: ['fishing_bobber'],
  fireworks_rocket: ['firework_rocket'],
  commandblock_minecart: ['command_block_minecart'],
  'iron_golem}': ['iron_golem']
}

/** The name the exports have the entity under: its own, or the registered name of an object minecraft-data names otherwise. */
export const resolveExportedEntityName = (version: string, name: string) => {
  const own = isEntityModelsVersionCovered(version) ? entityModelsExportFor(index.versions, version) : undefined
  const candidates = [name, ...(OBJECT_NAMES[name] ?? [])]
  // the version's own export first (1.12 names fireworks_rocket what 1.13 calls firework_rocket), then any
  return candidates.find(candidate => own && index.entityExports[candidate]?.includes(own)) ?? candidates.find(candidate => index.entityExports[candidate]) ?? name
}

/**
 * The export a world version draws an entity from: the one it reads, or, for an entity behind a feature flag the
 * exporting client did not enable (a camel in 1.19.4, a breeze in 1.20.5), the next export that has it.
 */
export const entityExportVersionFor = (version: string, name: string): string | undefined => {
  if (!isEntityModelsVersionCovered(version)) return undefined
  const own = entityModelsExportFor(index.versions, version)!
  const exports = index.entityExports[resolveExportedEntityName(version, name)]
  if (!exports?.length) return undefined
  if (exports.includes(own)) return own
  return exports.find(exported => versionToNumber(exported) > versionToNumber(own))
}

/** The loaded store an entity is drawn from (see {@link entityExportVersionFor}); undefined while it loads. */
export const getEntityModelsStoreFor = (version: string, name: string): EntityModelsStore | undefined => {
  const exportVersion = entityExportVersionFor(version, name)
  return exportVersion ? getEntityModelsStore(exportVersion) : undefined
}

export const getExportedEntity = (version: string, name: string): EntityDefinition | undefined => {
  return getEntityModelsStoreFor(version, name)?.getEntity(version, resolveExportedEntityName(version, name))
}

/** The metadata and equipment of a prismarine entity, as the look conditions read them. */
export const lookInputFromEntity = (entity: { metadata?: unknown; equipment?: Array<{ name?: string } | null | undefined> }): EntityLookInput => {
  const equipment: Record<string, string | undefined> = {}
  const equipmentColors: Record<string, number | undefined> = {}
  for (const [index, slot] of ENTITY_EQUIPMENT_SLOTS.entries()) {
    const item = entity.equipment?.[index]
    if (item?.name) equipment[slot] = item.name
    const color = item ? itemDyeColor(item) : undefined
    if (color !== undefined) equipmentColors[slot] = color
  }
  return { metadata: (entity.metadata ?? undefined) as EntityLookInput['metadata'], equipment, equipmentColors }
}

/**
 * A dyed item's color (RGB): the dyed_color component (1.20.5+, prismarine-item components) or the display.color tag
 * before.
 */
export const itemDyeColor = (item: unknown): number | undefined => {
  const value = item as {
    components?: Array<{ type?: string; data?: unknown }>
    componentMap?: Map<string, { data?: unknown }>
    nbt?: { value?: { display?: { value?: { color?: { value?: number } } } } }
  }
  const fromData = (data: unknown) => {
    if (typeof data === 'number') return data
    const object = data as { color?: number; rgb?: number } | undefined
    return typeof object?.color === 'number' ? object.color : typeof object?.rgb === 'number' ? object.rgb : undefined
  }
  const component = value.componentMap?.get?.('dyed_color')?.data ?? value.components?.find(c => c.type === 'dyed_color')?.data
  const color = component !== undefined ? fromData(component) : value.nbt?.value?.display?.value?.color?.value
  return typeof color === 'number' ? color & 0xff_ff_ff : undefined
}

/** Everything an exported entity draws for its metadata and equipment: its look, then the armor it wears. */
export const exportedEntityLook = (entity: EntityDefinition, input: EntityLookInput = {}) => [
  ...composeEntityLook(entity, input),
  ...composeEntityArmor(entity, input.equipment, input.equipmentColors)
]

/** Identifies a look: rebuild the mesh when it changes. */
export const lookSignature = (look: Array<{ key: string; entry: EntityLookEntry }>) =>
  JSON.stringify(look.map(({ key, entry }) => [key, (entry as EntityModelEntry).texture, (entry as EntityModelEntry).tint, (entry as EntityBlockEntry).block]))

/**
 * The name entities are looked up by: minecraft-data's name, in snake case where it is not (1.8 to 1.10 name entities
 * like PigZombie: pig_zombie). The exports of those versions keep the names the game registered.
 */
export const entityModelName = (name: string) => (name.charAt(0) === name.charAt(0).toUpperCase() ? snakeCase(name) : name).toLowerCase()

/** minecraft:entity/zombie/zombie -> textures/entity/zombie/zombie.png */
export const entityTextureUrl = (texture: string) => `textures/${texture.replace(/^minecraft:/, '')}.png`

/**
 * Where a version's texture is served: an older copy under textures/<version>/ (mc-assets' other-textures/<version>,
 * when the texture changed since), then the latest one under textures/.
 */
export const entityTextureUrls = (texture: string, version?: string) => {
  const latest = entityTextureUrl(texture)
  const folder = version ? entityTextureFolder(index, texture, version) : 'latest'
  return folder === 'latest' ? [latest] : [`textures/${folder}/${texture.replace(/^minecraft:/, '')}.png`, latest]
}

const entityTextures = new Map<string, Promise<THREE.Texture>>()

/** The first of the urls that loads. */
const loadFirst = async (urls: string[]) => {
  let error: unknown
  for (const url of urls) {
    try {
      return await loadThreeJsTextureFromUrlSync(url).promise
    } catch (err) {
      error = err
    }
  }
  throw error
}

/**
 * An entity texture for the version, cached; several layers (a 1.15 horse's coat, markings and armor) are drawn into
 * one, like the game's LayeredTexture.
 */
export const loadEntityTexture = (texture: string, layers: string[] | undefined, version?: string): Promise<THREE.Texture> => {
  const all = layers?.length ? layers : [texture]
  const key = `${version ?? ''}|${all.join('|')}`
  let loaded = entityTextures.get(key)
  if (!loaded) {
    loaded = (async () => {
      const textures = await Promise.all(all.map(async layer => loadFirst(entityTextureUrls(layer, version))))
      let result = textures[0]
      if (textures.length > 1) {
        const base = textures[0].image as { width: number; height: number }
        const canvas = createCanvas(base.width, base.height)
        const context = canvas.getContext('2d')!
        for (const layer of textures) context.drawImage(layer.image as CanvasImageSource, 0, 0, base.width, base.height)
        result = new THREE.Texture(canvas as unknown as HTMLCanvasElement)
      }
      result.magFilter = THREE.NearestFilter
      result.minFilter = THREE.NearestFilter
      result.flipY = false
      result.wrapS = THREE.RepeatWrapping
      result.wrapT = THREE.RepeatWrapping
      result.needsUpdate = true
      return result
    })()
    entityTextures.set(key, loaded)
    loaded.catch(err => console.error('[entity texture] failed to load', texture, err))
  }
  return loaded
}

// ---- cubes ---------------------------------------------------------------------------------------------------------

type Vertex = [number, number, number, number, number]
export type CubePolygon = { normal: [number, number, number]; vertices: Vertex[] }

const FACES = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  west: [-1, 0, 0],
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1]
} as const

/** The polygons of the game's ModelPart.Cube for these constructor arguments: positions in pixels, uvs 0 to 1. */
export function cubePolygons(cube: EntityModelCube, textureSize: [number, number]): CubePolygon[] {
  const [texWidth, texHeight] = cube.textureSize ?? textureSize
  const [x, y, z] = cube.origin
  const [width, height, depth] = cube.size
  const [growX, growY, growZ] = typeof cube.inflate === 'number' ? [cube.inflate, cube.inflate, cube.inflate] : (cube.inflate ?? [0, 0, 0])
  const mirror = !!cube.mirror
  let minX = x - growX
  let maxX = x + width + growX
  const minY = y - growY
  const maxY = y + height + growY
  const minZ = z - growZ
  const maxZ = z + depth + growZ
  if (mirror) [minX, maxX] = [maxX, minX]
  const t0 = [minX, minY, minZ]
  const t1 = [maxX, minY, minZ]
  const t2 = [maxX, maxY, minZ]
  const t3 = [minX, maxY, minZ]
  const l0 = [minX, minY, maxZ]
  const l1 = [maxX, minY, maxZ]
  const l2 = [maxX, maxY, maxZ]
  const l3 = [minX, maxY, maxZ]
  const [u, v] = cube.uv
  const u0 = u
  const u1 = u + depth
  const u2 = u + depth + width
  const u22 = u + depth + width + width
  const u3 = u + depth + width + depth
  const u4 = u + depth + width + depth + width
  const v0 = v
  const v1 = v + depth
  const v2 = v + depth + height
  const visible = new Set(cube.faces ?? Object.keys(FACES))
  const faces: Array<[keyof typeof FACES, number[][], number, number, number, number]> = [
    ['down', [l1, l0, t0, t1], u1, v0, u2, v1],
    ['up', [t2, t3, l3, l2], u2, v1, u22, v0],
    ['west', [t0, l0, l3, t3], u0, v1, u1, v2],
    ['north', [t1, t0, t3, t2], u1, v1, u2, v2],
    ['east', [l1, t1, t2, l2], u2, v1, u3, v2],
    ['south', [l0, l1, l2, l3], u3, v1, u4, v2]
  ]
  const polygons: CubePolygon[] = []
  for (const [facing, corners, fu0, fv0, fu1, fv1] of faces) {
    if (!visible.has(facing)) continue
    // ModelPart.Polygon: corners get (u1, v0), (u0, v0), (u0, v1), (u1, v1); a mirrored cube reverses them and its x faces point the other way
    const uvs = [
      [fu1 / texWidth, fv0 / texHeight],
      [fu0 / texWidth, fv0 / texHeight],
      [fu0 / texWidth, fv1 / texHeight],
      [fu1 / texWidth, fv1 / texHeight]
    ]
    let vertices = corners.map((corner, i) => [corner[0], corner[1], corner[2], uvs[i][0], uvs[i][1]] as Vertex)
    if (mirror) vertices = vertices.reverse()
    const direction = FACES[mirror && (facing === 'west' || facing === 'east') ? (facing === 'west' ? 'east' : 'west') : facing]
    polygons.push({ normal: [direction[0], direction[1], direction[2]], vertices })
  }
  return polygons
}

// ---- model entries -------------------------------------------------------------------------------------------------

/** A posable part: its bone and the pose the renderer left it in (setupAnim at rest). */
export type ExportedPart = {
  bone: THREE.Bone
  cubes?: THREE.Bone
  rest: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }
}

export type ExportedEntityRig = {
  name: string
  signature: string
  /** parts of every model entry by part name, in tree order */
  parts: Map<string, ExportedPart[]>
  /** the export draws the armor the entity wears */
  armor?: boolean
}

export const EXPORTED_ENTITY_USER_DATA_KEY = '_exportedEntityRig'

const descend = (part: EntityModelPart, path: string) => {
  let current = part
  for (const name of path.split('/').filter(Boolean)) current = current.children![name]
  return current
}

const setPose = (bone: THREE.Bone, pose?: number[], scale?: number[]) => {
  const [x = 0, y = 0, z = 0, xRot = 0, yRot = 0, zRot = 0] = pose ?? []
  bone.position.set(x, y, z)
  bone.rotation.set(xRot, yRot, zRot, 'ZYX') // ModelPart rotates rotationZYX(zRot, yRot, xRot)
  bone.scale.set(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1)
}

const argbColor = (argb: number) => {
  const value = argb >>> 0
  return { color: new THREE.Color(((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255), alpha: ((value >>> 24) & 0xff) / 255 }
}

/** The game's render types as three.js materials: cutout, translucent, and the unlit eyes and emissive layers. */
export function materialForEntry(entry: Pick<EntityModelEntry, 'renderType' | 'tint'>): THREE.Material {
  const type = entry.renderType
  const translucent = /translucent|breeze_wind|energy_swirl/.test(type)
  const emissive = type === 'eyes' || type.includes('emissive') || type === 'energy_swirl' || type.startsWith('breeze')
  const params = {
    transparent: translucent || emissive,
    alphaTest: translucent || emissive ? 0.01 : 0.1,
    side: THREE.DoubleSide,
    depthWrite: !(type === 'eyes' || type === 'energy_swirl')
  }
  const material = emissive
    ? new THREE.MeshBasicMaterial({ ...params, blending: type === 'eyes' || type === 'energy_swirl' ? THREE.AdditiveBlending : THREE.NormalBlending })
    : new THREE.MeshLambertMaterial(params)
  if (entry.tint !== undefined) {
    const { color, alpha } = argbColor(entry.tint)
    material.color = color
    if (alpha < 1) {
      material.opacity = alpha
      material.transparent = true
    }
  }
  return material
}

/** One model entry as a SkinnedMesh under a group carrying the entry's transform. */
export function buildModelEntry(entry: EntityModelEntry, layer: EntityModelLayer, parts: Map<string, ExportedPart[]>, version?: string): THREE.Group {
  const holder = new THREE.Group()
  holder.name = `exported_${entry.model}${entry.part ?? ''}`
  holder.matrixAutoUpdate = false
  holder.matrix.fromArray(entry.transform).multiply(new THREE.Matrix4().makeScale(1 / 16, 1 / 16, 1 / 16))

  const bones: THREE.Bone[] = []
  const byPath = new Map<string, ExportedPart>()
  const cubesToBake: Array<{ bone: THREE.Bone; index: number; cubes: EntityModelCube[] }> = []
  const build = (part: EntityModelPart, name: string, path: string, parent?: THREE.Bone) => {
    const bone = new THREE.Bone()
    bone.name = name
    setPose(bone, part.pose, part.scale)
    bones.push(bone)
    parent?.add(bone)
    const exported: ExportedPart = { bone, rest: { position: new THREE.Vector3(), rotation: new THREE.Euler(), scale: new THREE.Vector3() } }
    if (part.cubes?.length) {
      // the part's own cubes hang from a bone of their own, so skipDraw can hide them and not the children
      const cubes = new THREE.Bone()
      cubes.name = `${name}#cubes`
      bone.add(cubes)
      cubesToBake.push({ bone: cubes, index: bones.length, cubes: part.cubes })
      bones.push(cubes)
      exported.cubes = cubes
    }
    byPath.set(path, exported)
    if (!parts.has(name)) parts.set(name, [])
    parts.get(name)!.push(exported)
    for (const [childName, child] of Object.entries(part.children ?? {})) build(child, childName, `${path}/${childName}`, bone)
    return bone
  }
  const rootPart = entry.part ? descend(layer.root, entry.part) : layer.root
  const rootName = entry.part ? entry.part.split('/').pop()! : 'root'
  const rootBone = build(rootPart, rootName, '')
  rootBone.updateMatrixWorld(true)

  // vertices in the initial pose, in model space
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const skinIndices: number[] = []
  const skinWeights: number[] = []
  const indices: number[] = []
  const vertex = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (const { bone, index, cubes } of cubesToBake) {
    for (const cube of cubes) {
      for (const polygon of cubePolygons(cube, layer.textureSize)) {
        const start = positions.length / 3
        normal.set(...polygon.normal).transformDirection(bone.matrixWorld)
        for (const [x, y, z, u, v] of polygon.vertices) {
          vertex.set(x, y, z).applyMatrix4(bone.matrixWorld)
          positions.push(vertex.x, vertex.y, vertex.z)
          normals.push(normal.x, normal.y, normal.z)
          uvs.push(u, v)
          skinIndices.push(index, 0, 0, 0)
          skinWeights.push(1, 0, 0, 0)
        }
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))
  geometry.setIndex(indices)

  const material = materialForEntry(entry)
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.name = `geometry_${entry.model}${entry.part ?? ''}`
  mesh.add(rootBone)
  mesh.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(bones))
  // the bounds move with the bones; skip culling rather than recompute them each frame
  mesh.frustumCulled = false

  // the renderer's pose for this look
  for (const [path, rest] of Object.entries(entry.pose ?? {})) {
    const part = byPath.get(path)
    if (!part) continue
    if (rest.pose) setPose(part.bone, rest.pose, rest.scale)
    if (rest.visible === false) part.bone.scale.set(0, 0, 0)
    if (rest.skipDraw && part.cubes) part.cubes.scale.set(0, 0, 0)
  }
  for (const part of byPath.values()) {
    part.rest.position.copy(part.bone.position)
    part.rest.rotation.copy(part.bone.rotation)
    part.rest.scale.copy(part.bone.scale)
  }

  if (entry.texture) {
    // uvs are 0 to 1 over the whole texture, as the game draws them: the version's own texture (or a resource pack's of
    // any resolution) fits
    void loadEntityTexture(entry.texture, (entry as { textureLayers?: string[] }).textureLayers, version)
      .then(texture => {
        ;(material as THREE.MeshLambertMaterial).map = texture
        material.needsUpdate = true
      })
      .catch(() => {})
  }
  holder.add(mesh)
  return holder
}

export type ExportedEntityBuild = {
  object: THREE.Group
  rig: ExportedEntityRig
  blocks: EntityBlockEntry[]
  items: EntityItemEntry[]
  custom: EntityCustomEntry[]
}

/**
 * The entity as the game draws it for this metadata and equipment, or undefined when the version has no export for
 * it or its look draws no model (items, displays and the like are drawn elsewhere).
 */
export function buildExportedEntity(version: string, name: string, input: EntityLookInput = {}): ExportedEntityBuild | undefined {
  const entity = getExportedEntity(version, name)
  if (!entity) return undefined
  const look = exportedEntityLook(entity, input)
  if (!look.length) return undefined
  const store = getEntityModelsStoreFor(version, name)!
  const object = new THREE.Group()
  object.name = `exported_entity_${name}`
  const rig: ExportedEntityRig = { name, signature: lookSignature(look), parts: new Map(), armor: !!entity.armor }
  const result: ExportedEntityBuild = { object, rig, blocks: [], items: [], custom: [] }
  for (const { entry } of look) {
    if (entry.type === 'model') {
      if (entry.renderType === 'water_mask') continue // the boat's water patch: the renderer masks water itself
      const layer = store.getModel(version, entry.model)
      if (!layer) continue
      object.add(buildModelEntry(entry, layer, rig.parts, version))
    } else if (entry.type === 'block') {
      result.blocks.push(entry)
    } else if (entry.type === 'item') {
      result.items.push(entry)
    } else {
      result.custom.push(entry)
    }
  }
  // only blocks, items or custom geometry (tnt, falling blocks, thrown items, experience orbs): drawn elsewhere
  if (!object.children.length) return undefined
  object.userData[EXPORTED_ENTITY_USER_DATA_KEY] = rig
  return result
}

// ---- paintings -----------------------------------------------------------------------------------------------------

/** The painting variants a server sent (1.21+ registry data), by network id: a datapack's own variants. */
let serverPaintingVariants: PaintingVariant[] | undefined

/**
 * The painting_variant registry the server sent (registry_data, 1.21+): entries in its order, each with the variant's
 * asset_id, width and height (blocks). Vanilla servers send the vanilla registry, the exported one.
 */
export const setServerPaintingVariants = (entries: Array<{ id: string; assetId?: string; asset_id?: string; width: number; height: number }> | undefined) => {
  serverPaintingVariants = entries?.map(entry => {
    const asset = (entry.assetId ?? entry.asset_id ?? entry.id).replace(/^minecraft:/, '')
    const [namespace, path] = asset.includes(':') ? asset.split(':') : ['minecraft', asset]
    return { id: entry.id, width: entry.width, height: entry.height, texture: `${namespace}:painting/${path}` }
  })
}

/** A painting: its variant (registry id or index, id or title, or the variant's data sent inline) and facing. */
export type PaintingInput = {
  variant: number | string | { asset_id?: string; assetId?: string; width: number; height: number } | undefined
  /** 0 south, 1 west, 2 north, 3 east (the game's 2D direction values) */
  direction: number
}

const DIRECTION_3D_TO_2D: Record<number, number> = { 2: 2, 3: 0, 4: 1, 5: 3 }

/**
 * A painting's variant and facing from what the client knows: metadata (painting_variant; direction from 1.21.11), the
 * spawn packet's data (direction as a 3D value, 1.19 to 1.21.10), or what a client set from the 1.8 to 1.18 painting
 * spawn packet (paintingVariant: the title or motive id, paintingDirection: 2D).
 */
export const paintingInputFromEntity = (
  entity: { metadata?: unknown; objectData?: unknown; paintingVariant?: unknown; paintingDirection?: unknown; yaw?: number },
  metadataKeys: string[] | undefined
): PaintingInput => {
  const metadata = entity.metadata as Record<number, unknown> | unknown[] | undefined
  const read = (key: string) => {
    const index = metadataKeys?.indexOf(key) ?? -1
    return index >= 0 ? (metadata as Record<number, unknown> | undefined)?.[index] : undefined
  }
  let variant: PaintingInput['variant'] = entity.paintingVariant as PaintingInput['variant']
  const fromMetadata = read('painting_variant') as unknown
  if (variant === undefined && fromMetadata !== undefined) {
    const holder = fromMetadata as { variantId?: number; variantData?: { asset_id?: string; assetId?: string; width: number; height: number } }
    variant = typeof fromMetadata === 'number' ? fromMetadata : holder.variantId ?? holder.variantData
  }
  let direction = typeof entity.paintingDirection === 'number' ? entity.paintingDirection : undefined
  const fromDirection = read('direction')
  if (direction === undefined && typeof fromDirection === 'number') direction = DIRECTION_3D_TO_2D[fromDirection]
  if (direction === undefined && typeof entity.objectData === 'number') direction = DIRECTION_3D_TO_2D[entity.objectData]
  return { variant, direction: direction ?? 0 }
}

/** The variant drawn: inline data, the server's registry (1.21+), else the exported list; null when unknown. */
const resolvePaintingVariant = (paintings: PaintingsData, variant: PaintingInput['variant']): PaintingVariant | undefined => {
  if (variant && typeof variant === 'object') {
    const asset = (variant.assetId ?? variant.asset_id ?? '').replace(/^minecraft:/, '')
    return { id: asset, width: variant.width, height: variant.height, texture: `minecraft:painting/${asset}` }
  }
  if (typeof variant === 'number' && serverPaintingVariants) return serverPaintingVariants[variant]
  return paintingVariant(paintings, variant)
}

/**
 * The quads of a size the export has no template for (a datapack's painting): PaintingRenderer of 1.21, front and back
 * per block and the edges around.
 */
const paintingQuads = (width: number, height: number): PaintingsData['templates'][string] => {
  const quads: PaintingsData['templates'][string] = []
  const offsetX = -width / 2
  const offsetY = -height / 2
  const d = 0.031_25
  for (let segmentX = 0; segmentX < width; segmentX++) {
    for (let segmentY = 0; segmentY < height; segmentY++) {
      const x0 = offsetX + segmentX + 1
      const x1 = offsetX + segmentX
      const y0 = offsetY + segmentY + 1
      const y1 = offsetY + segmentY
      const u0 = (width - segmentX) / width
      const u1 = (width - segmentX - 1) / width
      const v0 = (height - segmentY) / height
      const v1 = (height - segmentY - 1) / height
      quads.push({ face: 'front', vertices: [[x0, y1, -d, u1, v0], [x1, y1, -d, u0, v0], [x1, y0, -d, u0, v1], [x0, y0, -d, u1, v1]] })
      quads.push({ face: 'back', vertices: [[x0, y0, d, 1, 0], [x1, y0, d, 0, 0], [x1, y1, d, 0, 1], [x0, y1, d, 1, 1]] })
      if (segmentY === height - 1) quads.push({ face: 'back', vertices: [[x0, y0, -d, 0, 0], [x1, y0, -d, 1, 0], [x1, y0, d, 1, 0.0625], [x0, y0, d, 0, 0.0625]] })
      if (segmentY === 0) quads.push({ face: 'back', vertices: [[x0, y1, d, 0, 0], [x1, y1, d, 1, 0], [x1, y1, -d, 1, 0.0625], [x0, y1, -d, 0, 0.0625]] })
      if (segmentX === width - 1) quads.push({ face: 'back', vertices: [[x0, y0, d, 0.0625, 0], [x0, y1, d, 0.0625, 1], [x0, y1, -d, 0, 1], [x0, y0, -d, 0, 0]] })
      if (segmentX === 0) quads.push({ face: 'back', vertices: [[x1, y0, -d, 0.0625, 0], [x1, y1, -d, 0.0625, 1], [x1, y1, d, 0, 1], [x1, y0, d, 0, 0]] })
    }
  }
  return quads
}

const STEPS_2D: Array<[number, number]> = [
  [0, 1], // south
  [-1, 0], // west
  [0, -1], // north
  [1, 0] // east
]

/**
 * Where the painting is drawn from its block (what the spawn packet sends): HangingEntity's center, half a pixel off the
 * wall, shifted half a block along and up for even sizes.
 */
export const paintingOffset = (width: number, height: number, direction: number): [number, number, number] => {
  const [stepX, stepZ] = STEPS_2D[direction & 3]!
  // counterclockwise: south -> east, west -> south, north -> west, east -> north
  const [ccwX, ccwZ] = STEPS_2D[(direction + 3) & 3]!
  const along = width % 2 === 0 ? 0.5 : 0
  const up = height % 2 === 0 ? 0.5 : 0
  return [0.5 - stepX * 0.468_75 + ccwX * along, 0.5 + up, 0.5 - stepZ * 0.468_75 + ccwZ * along]
}

/**
 * A painting as PaintingRenderer draws it, relative to its block: the size's quads from the export (or the 1.21 renderer's
 * for a size it has none of), the front from the variant's texture, the back and edges from the back texture.
 */
export function buildExportedPainting(version: string, input: PaintingInput): THREE.Group | undefined {
  // the version's own export: every export has its paintings
  const store = getEntityModelsStore(version)
  const paintings = store?.getPaintings(version)
  if (!paintings) return undefined
  const variant = resolvePaintingVariant(paintings, input.variant)
  if (!variant) return undefined
  const quads = paintings.templates[`${variant.width}x${variant.height}`] ?? paintingQuads(variant.width, variant.height)
  const group = new THREE.Group()
  group.name = `exported_painting_${variant.id}`
  const turned = new THREE.Group()
  turned.rotation.y = THREE.MathUtils.degToRad(180 - 90 * input.direction)
  turned.position.set(...paintingOffset(variant.width, variant.height, input.direction))
  group.add(turned)
  for (const face of ['front', 'back'] as const) {
    const [u0, v0, u1, v1] = (face === 'front' ? variant.rect : paintings.back.rect) ?? [0, 0, 1, 1]
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    for (const quad of quads) {
      if (quad.face !== face) continue
      const start = positions.length / 3
      for (const [x, y, z, u, v] of quad.vertices) {
        positions.push(x, y, z)
        uvs.push(u0 + u * (u1 - u0), v0 + v * (v1 - v0))
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, alphaTest: 0.1 })
    const texture = face === 'front' ? variant.texture : paintings.back.texture
    void loadEntityTexture(texture, undefined, version)
      .then(map => {
        material.map = map
        material.needsUpdate = true
      })
      .catch(() => {})
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `painting_${face}`
    turned.add(mesh)
  }
  group.userData[PAINTING_SIGNATURE_USER_DATA_KEY] = paintingSignature(input)
  return group
}

export const PAINTING_SIGNATURE_USER_DATA_KEY = '_exportedPaintingSignature'
export const paintingSignature = (input: PaintingInput) => JSON.stringify(input)

/** Does the entity draw a model of its own (not only items, blocks or custom geometry)? */
export const exportedEntityHasModel = (version: string, name: string) => {
  const entity = getExportedEntity(version, name)
  if (!entity) return false
  return composeEntityLook(entity).some(({ entry }) => entry.type === 'model')
}

// ---- animation -----------------------------------------------------------------------------------------------------

export type ExportedEntityPoseInput = {
  /** the head's yaw relative to the body, radians, the game's sign (netHeadYaw) */
  netHeadYaw: number
  /** radians, positive looks down (the game's headPitch) */
  headPitch: number
  /** walk animation position and speed (WalkAnimationState) */
  limbSwing: number
  limbSwingAmount: number
}

const HUMANOID_LIMBS: Array<[string, number, number]> = [
  // part, phase, amplitude: HumanoidModel.setupAnim
  ['right_arm', Math.PI, 1],
  ['left_arm', 0, 1],
  ['right_leg', 0, 1.4],
  ['left_leg', Math.PI, 1.4]
]
const QUADRUPED_LIMBS: Array<[string, number, number]> = [
  // QuadrupedModel.setupAnim
  ['right_hind_leg', 0, 1.4],
  ['left_hind_leg', Math.PI, 1.4],
  ['right_front_leg', Math.PI, 1.4],
  ['left_front_leg', 0, 1.4]
]

/**
 * Head look and walking on top of the rest pose: the head (or an equine's head_parts) turns by the head's yaw and
 * pitch, legs and arms swing like HumanoidModel and QuadrupedModel swing them.
 */
export function applyExportedEntityPose(rig: ExportedEntityRig, input: ExportedEntityPoseInput) {
  for (const parts of rig.parts.values()) {
    for (const part of parts) part.bone.rotation.copy(part.rest.rotation)
  }
  const head = rig.parts.get('head') ?? rig.parts.get('head_parts')
  if (head) {
    const equine = !rig.parts.has('head') && rig.parts.has('head_parts')
    const yawLimit = equine ? THREE.MathUtils.degToRad(20) : THREE.MathUtils.degToRad(85)
    const yaw = THREE.MathUtils.clamp(input.netHeadYaw, -yawLimit, yawLimit)
    for (const part of head) {
      part.bone.rotation.x = part.rest.rotation.x + input.headPitch
      part.bone.rotation.y = part.rest.rotation.y + yaw
    }
  }
  const speed = Math.min(1, Math.max(0, input.limbSwingAmount))
  if (speed > 0) {
    for (const [name, phase, amplitude] of [...HUMANOID_LIMBS, ...QUADRUPED_LIMBS]) {
      for (const part of rig.parts.get(name) ?? []) {
        part.bone.rotation.x = part.rest.rotation.x + Math.cos(input.limbSwing * 0.6662 + phase) * amplitude * speed
      }
    }
  }
}

/** The game's netHeadYaw and headPitch from prismarine angles (yaw: radians, 0 north, counterclockwise; pitch: radians, positive up). */
export function prismarineToGameHeadAngles(bodyYaw: number, headYaw: number, pitch: number) {
  const tau = Math.PI * 2
  let net = (((bodyYaw - headYaw + Math.PI) % tau) + tau) % tau - Math.PI
  if (net === -Math.PI) net = Math.PI
  return { netHeadYaw: net, headPitch: -pitch }
}
