import * as THREE from 'three'
import entityModelsJson from 'mc-assets/dist/entityModels.json'
import {
  composeEntityLook,
  ENTITY_EQUIPMENT_SLOTS,
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
  type EntityModelsData
} from 'mc-assets/dist/entityModels'
import { loadTexture } from '../threeJsUtils'

/**
 * Entity models exported from the game (mc-assets' dist/entityModels.json, made by minecraft-model-generator): the
 * game's model layers as part trees and, per entity, what its renderer draws for the entity's metadata and equipment.
 *
 * A model entry becomes a SkinnedMesh whose bones are the model's parts, so the parts can still be posed (head look,
 * walking) after the mesh is built: vertices are baked in the layer's initial pose, then the renderer's pose for the
 * look (setupAnim of the game, at rest) is applied to the bones. Everything is in the game's model space (pixels, y
 * down) under the entry's transform, which already holds the renderer's scale(-1, -1, 1) and 1.501 translation.
 */

let store: EntityModelsStore | undefined
export const getEntityModelsStore = () => (store ??= new EntityModelsStore(entityModelsJson as unknown as EntityModelsData))

const versionToNumber = (version: string) => {
  const [x, y = '0', z = '0'] = version.split('.')
  return +`${x.padStart(2, '0')}${y.padStart(2, '0')}${z.padStart(2, '0')}`
}

/**
 * Versions the exports cover: from the major version of the oldest export on (1.17 when the oldest is 1.17.1; older
 * versions keep the renderer's own models). A version between two exports uses the older one.
 */
export const isEntityModelsVersionCovered = (version: string) => {
  const versions = getEntityModelsStore().versions
  if (!versions.length || !version) return false
  const [major, minor] = versions[0].split('.')
  return versionToNumber(version) >= versionToNumber(minor === undefined ? major : `${major}.${minor}`)
}

export const getExportedEntity = (version: string, name: string): EntityDefinition | undefined => {
  if (!isEntityModelsVersionCovered(version)) return undefined
  return getEntityModelsStore().getEntity(version, name)
}

/** The metadata and equipment of a prismarine entity, as the look conditions read them. */
export const lookInputFromEntity = (entity: { metadata?: unknown; equipment?: Array<{ name?: string } | null | undefined> }): EntityLookInput => {
  const equipment: Record<string, string | undefined> = {}
  for (const [index, slot] of ENTITY_EQUIPMENT_SLOTS.entries()) {
    const item = entity.equipment?.[index]
    if (item?.name) equipment[slot] = item.name
  }
  return { metadata: (entity.metadata ?? undefined) as EntityLookInput['metadata'], equipment }
}

/** Identifies a look: rebuild the mesh when it changes. */
export const lookSignature = (look: Array<{ key: string; entry: EntityLookEntry }>) =>
  JSON.stringify(look.map(({ key, entry }) => [key, (entry as EntityModelEntry).texture, (entry as EntityModelEntry).tint, (entry as EntityBlockEntry).block]))

/** minecraft:entity/zombie/zombie -> textures/entity/zombie/zombie.png */
export const entityTextureUrl = (texture: string) => `textures/${texture.replace(/^minecraft:/, '')}.png`

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
export function buildModelEntry(entry: EntityModelEntry, layer: EntityModelLayer, parts: Map<string, ExportedPart[]>): THREE.Group {
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
    const [textureWidth, textureHeight] = layer.textureSize
    void loadTexture(
      entityTextureUrl(entry.texture),
      texture => {
        texture.magFilter = THREE.NearestFilter
        texture.minFilter = THREE.NearestFilter
        texture.flipY = false
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.RepeatWrapping
        ;(material as THREE.MeshLambertMaterial).map = texture
        material.needsUpdate = true
      },
      () => {
        // a texture of another size than the model's (an older model with a newer, taller texture): keep pixel uvs
        const map = (material as THREE.MeshLambertMaterial).map as THREE.Texture<HTMLImageElement | ImageBitmap> | null
        const image = map?.image
        if (!map || !image?.width || !textureWidth || !textureHeight) return
        if (image.width !== textureWidth || image.height !== textureHeight) {
          const repeat = new THREE.Vector2(textureWidth / image.width, textureHeight / image.height)
          if (repeat.x !== map.repeat.x || repeat.y !== map.repeat.y) {
            // shared textures are cached by url: give this material its own copy
            const own = map.clone()
            own.repeat.copy(repeat)
            own.needsUpdate = true
            ;(material as THREE.MeshLambertMaterial).map = own
          }
        }
        material.needsUpdate = true
      }
    )
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
  const look = composeEntityLook(entity, input)
  if (!look.length) return undefined
  const store = getEntityModelsStore()
  const object = new THREE.Group()
  object.name = `exported_entity_${name}`
  const rig: ExportedEntityRig = { name, signature: lookSignature(look), parts: new Map() }
  const result: ExportedEntityBuild = { object, rig, blocks: [], items: [], custom: [] }
  for (const { entry } of look) {
    if (entry.type === 'model') {
      if (entry.renderType === 'water_mask') continue // the boat's water patch: the renderer masks water itself
      const layer = store.getModel(version, entry.model)
      if (!layer) continue
      object.add(buildModelEntry(entry, layer, rig.parts))
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
