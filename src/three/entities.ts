import { UnionToIntersection } from 'type-fest'
import nbt from 'prismarine-nbt'
import * as TWEEN from '@tweenjs/tween.js'
import * as THREE from 'three'
import { PlayerAnimation, PlayerObject } from 'skinview3d'
import { inferModelType, loadCapeToCanvas, loadEarsToCanvasFromSkin } from 'skinview-utils'
// todo replace with url
import { flat, fromFormattedString } from '@xmcl/text-component'
import mojangson from 'mojangson'
import { Item } from 'prismarine-item'
import { isEntityAttackable } from 'mineflayer-mouse/dist/attackableEntity'
import { Team } from 'mineflayer'
import PrismarineChatLoader from 'prismarine-chat'
import { loadSkinFromUsername, loadSkinImage, stevePngUrl } from '../lib/utils/skins'
import { renderComponent } from '../sign-renderer'
import { createCanvas, versionToNumber } from '../lib/utils'
import { configurePlayerSkinMaterials, PlayerObjectType } from '../lib/createPlayerObject'
import { getBlockMeshFromModel } from './holdingBlock'
import { createItemMesh } from './itemMesh'
import * as Entity from './entity/EntityMesh'
import { setupBoatMesh, disposeBoatWaterPatch } from './entity/boatRenderSetup'
import { getBoatMeshYawOffset, isBoatEntityName } from './entity/boatModelRotation'
import { resolveBoatPassengerThirdPersonRotation, shouldApplyBoatPassengerThirdPersonRotation } from './entity/boatPassengerRotation'
import {
  createBoatPaddleAnimationState,
  createBoatPaddlePivotScratch,
  syncBoatPaddleAnimationTargets,
  updateBoatPaddleAnimationState,
  type BoatPaddleAnimationState
} from './entity/boatPaddleAnimation'
import { releaseVehiclePassengerPosition } from './entity/vehiclePassengerRendering'
import { updateVehiclePassengerPositions as applyVehiclePassengerPositions } from './entity/vehiclePassengerUpdate'
import { applyNetworkHeadPitch, storeNetworkHeadPitch, storeNetworkHeadYaw } from './entity/networkHeadPitchRendering'
import { processRemoteBoatPassengerRotations, type RemoteBoatPassengerEntity } from './entity/remoteBoatPassengerRotation'
import {
  ENTITY_TWEEN_DURATION_MS,
  applyLocalHorseCameraYawLock,
  getEntityTweenDurationMs,
  getEntityRotationTweenDurationMs,
  resolveLocalVehicleWorldPosition,
  shouldApplyLocalHorseCameraYawLock,
  type EntityRenderHints,
  type Vec3Like,
  usesCameraSyncedVehiclePosition,
  isRideableMinecartEntityName
} from './entity/interpolationPolicy'
import { getMesh } from './entity/EntityMesh'
import {
  HORSE_HEAD_ANIMATION_USER_DATA_KEY,
  HORSE_HEAD_RIG_USER_DATA_KEY,
  applyHorseHeadPose,
  calculateHorseHeadPose,
  createHorseHeadAnimationState,
  setHorseHeadAnimationPosition,
  updateHorseHeadAnimationFrame,
  type HorseHeadAnimationState,
  type HorseHeadRig
} from './entity/horseHeadAnimation'
import { WalkingGeneralSwing } from './entity/animations'
import {
  EXPORTED_ENTITY_USER_DATA_KEY,
  applyExportedEntityPose,
  getExportedEntity,
  lookInputFromEntity,
  lookSignature,
  prismarineToGameHeadAngles,
  type ExportedEntityBuild,
  type ExportedEntityRig,
  buildExportedPainting,
  exportedEntitySignature,
  setSkinUrlResolver,
  updateExportedHeadAnchor,
  applyExportedSetupAnim,
  applyBoatRock,
  buildHumanoidHeadItem,
  SKINVIEW_HEAD_FRAME,
  headItemDisplayTransform,
  resetExportedPose,
  PAINTING_SIGNATURE_USER_DATA_KEY,
  paintingInputFromEntity,
  paintingSignature,
  entityExportVersionFor,
  entityModelName,
  getEntityModelsStore,
  getEntityModelsStoreFor,
  isEntityModelsVersionCovered,
  loadEntityModels,
  onEntityModelsLoaded
} from './entity/exportedEntityModels'
import { composeEntityLook } from 'mc-assets/dist/entityModels'
import { disposeObject, loadNearestFilterTexture, loadTexture, loadThreeJsTextureFromUrl } from './threeJsUtils'
import { armorModel, armorTextures, elytraTexture } from './entity/armorModels'
import { ExportedEntityAnimator, applyAnimationOffsets, poseName } from './entity/exportedAnimations'
import { EntityAnimTracker, entityAnimState, entityEraState, type EntityAnimInput } from './entity/entityAnimState'
import { thrownItemOf } from './entity/thrownItems'
import './entity/drivers'
import { animContext } from './entity/setupAnim'
import { WorldRendererThree } from './worldRendererThree'
import { IndexedData } from 'minecraft-data'
import { ItemSpecificContextProperties } from '../playerState/types'

export type EntityModelOverridePart = {
  modelPath: string | ArrayBuffer
  modelType: Entity.EntityModelType
  metadata?: any
}

// Type for entity metadata - simplified version
type EntityMetadataVersions = {
  [key: string]: any
}

export const steveTexture = loadThreeJsTextureFromUrl(stevePngUrl)

export const TWEEN_DURATION = ENTITY_TWEEN_DURATION_MS

const degreesToRadians = (degrees: number) => degrees * (Math.PI / 180)

/** The player model's own head parts (skinview3d's), not the parts of what it wears there (a skull's model has a head too). */
function forEachPlayerHead(entity: THREE.Object3D, apply: (head: THREE.Object3D) => void) {
  const visit = (object: THREE.Object3D) => {
    if (object.name === 'player_head_item') return
    if (object.name === 'head') apply(object)
    for (const child of object.children) visit(child)
  }
  visit(entity)
}

function convert2sComplementToHex(complement: number) {
  if (complement < 0) {
    complement = (0xff_ff_ff_ff + complement + 1) >>> 0
  }
  return complement.toString(16)
}

function toRgba(color: string | undefined) {
  if (color === undefined) {
    return undefined
  }
  if (parseInt(color, 10) === 0) {
    return 'rgba(0, 0, 0, 0)'
  }
  const hex = convert2sComplementToHex(parseInt(color, 10))
  if (hex.length === 8) {
    return `#${hex.slice(2, 8)}${hex.slice(0, 2)}`
  } else {
    return `#${hex}`
  }
}

function toQuaternion(quaternion: any, defaultValue?: THREE.Quaternion) {
  if (quaternion === undefined) {
    return defaultValue
  }
  if (quaternion instanceof THREE.Quaternion) {
    return quaternion
  }
  if (Array.isArray(quaternion)) {
    return new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
  }
  return new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
}

function poseToEuler(pose: any, defaultValue?: THREE.Euler) {
  if (pose === undefined) {
    return defaultValue ?? new THREE.Euler()
  }
  if (pose instanceof THREE.Euler) {
    return pose
  }
  if (pose['yaw'] !== undefined && pose['pitch'] !== undefined && pose['roll'] !== undefined) {
    // Convert Minecraft pitch, yaw, roll definitions to our angle system
    return new THREE.Euler(-degreesToRadians(pose.pitch), -degreesToRadians(pose.yaw), degreesToRadians(pose.roll), 'ZYX')
  }
  if (pose['x'] !== undefined && pose['y'] !== undefined && pose['z'] !== undefined) {
    return new THREE.Euler(pose.z, pose.y, pose.x, 'ZYX')
  }
  if (Array.isArray(pose)) {
    return new THREE.Euler(pose[0], pose[1], pose[2])
  }
  return defaultValue ?? new THREE.Euler()
}

const TAU_YAW = Math.PI * 2

/** Prismarine yaw in radians → shortest delta from→to in (-π, π]. */
function shortestYawRadians(fromYawRad: number, toYawRad: number): number {
  const norm = (((toYawRad - fromYawRad) % TAU_YAW) + TAU_YAW) % TAU_YAW
  return norm > Math.PI ? norm - TAU_YAW : norm
}

/** Voice chat presence for a player, drawn as a small speaker glyph before their nametag. */
export type PlayerVoiceState = 'speaking' | 'muted' | 'idle'

/**
 * Draws a small speaker glyph centered at the origin of the current transform.
 * `size` is the glyph's bounding box (both width and height).
 */
function drawVoiceStateIcon(ctx: OffscreenCanvasRenderingContext2D, state: PlayerVoiceState, cx: number, cy: number, size: number) {
  const color = state === 'speaking' ? '#3ddc47' : state === 'muted' ? '#ff5555' : '#cfcfcf'

  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, size * 0.09)
  ctx.lineCap = 'round'

  // Speaker silhouette: a small box with a cone opening to the right
  const boxWidth = size * 0.22
  const boxHeight = size * 0.34
  const coneWidth = size * 0.24
  const left = -size * 0.44

  ctx.beginPath()
  ctx.moveTo(left, -boxHeight / 2)
  ctx.lineTo(left + boxWidth, -boxHeight / 2)
  ctx.lineTo(left + boxWidth + coneWidth, -size * 0.5)
  ctx.lineTo(left + boxWidth + coneWidth, size * 0.5)
  ctx.lineTo(left + boxWidth, boxHeight / 2)
  ctx.lineTo(left, boxHeight / 2)
  ctx.closePath()
  ctx.fill()

  const coneTip = left + boxWidth + coneWidth

  if (state === 'speaking') {
    ctx.beginPath()
    ctx.arc(coneTip + size * 0.06, 0, size * 0.16, -Math.PI * 0.32, Math.PI * 0.32)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(coneTip + size * 0.06, 0, size * 0.28, -Math.PI * 0.28, Math.PI * 0.28)
    ctx.stroke()
  }

  if (state === 'muted') {
    ctx.beginPath()
    ctx.moveTo(-size * 0.46, -size * 0.46)
    ctx.lineTo(size * 0.46, size * 0.46)
    ctx.stroke()
  }

  ctx.restore()
}

function getUsernameTexture(
  { username, nameTagBackgroundColor = 'rgba(0, 0, 0, 0.3)', nameTagTextOpacity = 255, voiceState }: any,
  { fontFamily = 'mojangles' }: any,
  version: string
) {
  const measureCanvas = createCanvas(64, 64)
  const PrismarineChat = PrismarineChatLoader(version)

  const measureCtx = measureCanvas.getContext('2d')
  if (!measureCtx) throw new Error('Could not get 2d context')

  const fontSize = 48
  const padding = 5
  measureCtx.font = `${fontSize}px ${fontFamily}`

  const plainLines = String(typeof username === 'string' ? username : new PrismarineChat(username).toString()).split('\n')
  let textWidth = 0
  for (const line of plainLines) {
    const width = measureCtx.measureText(line).width + padding * 2
    if (width > textWidth) textWidth = width
  }

  const height = (fontSize + padding) * plainLines.length

  // Render the text onto its own transparent canvas so the existing
  // centered-text layout in renderComponent() is unaffected by compositing it
  // alongside the icon. The background plate is painted exactly once, on the
  // final canvas below — painting it here too would double-blend the alpha
  // under the text relative to the icon area, producing a visible seam.
  const textCanvas = createCanvas(textWidth, height)
  const textCtx = textCanvas.getContext('2d')
  if (!textCtx) throw new Error('Could not get 2d context')

  textCtx.globalAlpha = nameTagTextOpacity / 255
  const textRendered = renderComponent(username, PrismarineChat, textCanvas, fontSize, 'white', -padding + fontSize)
  if (!textRendered) return undefined
  textCtx.globalAlpha = 1

  const iconSize = fontSize * 0.85
  const iconAreaWidth = voiceState ? iconSize + padding * 2.5 : 0

  // The nametag sprite is anchored (and thus centered above the player) at the
  // midpoint of this canvas. Mirroring the icon's width as a second, unpainted
  // margin on the right moves that midpoint to align with the *text's* own
  // center instead of the icon+text bounding box's center — otherwise the
  // icon's extra width on the left alone drags the whole sprite's anchor left,
  // which visually reads as the text drifting right of the player.
  const canvas = createCanvas(iconAreaWidth * 2 + textWidth, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2d context')

  ctx.fillStyle = nameTagBackgroundColor
  ctx.fillRect(0, 0, iconAreaWidth + textWidth, canvas.height)
  if (voiceState) {
    drawVoiceStateIcon(ctx, voiceState, iconAreaWidth / 2, canvas.height / 2, iconSize)
  }
  ctx.drawImage(textCanvas, iconAreaWidth, 0)

  return canvas
}

globalThis.getUsernameTexture = getUsernameTexture

const addNametag = (entity, options: { fontFamily: string }, mesh, version: string) => {
  for (const c of mesh.children) {
    if (c.name === 'nametag') {
      c.removeFromParent()
    }
  }
  if (entity.username === undefined || entity.username === null) return

  const plainUsername = typeof entity.username === 'string' ? entity.username : new (PrismarineChatLoader(version))(entity.username).toString()
  if (plainUsername.startsWith('EMPTY')) return

  const canvas = getUsernameTexture(entity, options, version)
  if (!canvas) return
  const tex = new THREE.Texture(canvas)
  tex.needsUpdate = true
  let nameTag: THREE.Object3D
  if (entity.nameTagFixed) {
    const geometry = new THREE.PlaneGeometry()
    const material = new THREE.MeshBasicMaterial({ map: tex })
    material.transparent = true
    nameTag = new THREE.Mesh(geometry, material)
    nameTag.rotation.set(entity.pitch, THREE.MathUtils.degToRad(entity.yaw + 180), 0)
    nameTag.position.y += entity.height + 0.3
  } else {
    const spriteMat = new THREE.SpriteMaterial({ map: tex })
    nameTag = new THREE.Sprite(spriteMat)
    nameTag.position.y += entity.height + 0.6
  }
  nameTag.renderOrder = 1000
  nameTag.scale.set(canvas.width * 0.005, canvas.height * 0.005, 1)
  if (entity.nameTagRotationRight) {
    nameTag.applyQuaternion(entity.nameTagRotationRight)
  }
  if (entity.nameTagScale) {
    nameTag.scale.multiply(entity.nameTagScale)
  }
  if (entity.nameTagRotationLeft) {
    nameTag.applyQuaternion(entity.nameTagRotationLeft)
  }
  if (entity.nameTagTranslation) {
    nameTag.position.add(entity.nameTagTranslation)
  }
  nameTag.name = 'nametag'

  mesh.add(nameTag)
  return nameTag
}

/** Player nametags are placed above the skin model and scaled up; text_display/mob nametags are not. */
function applyPlayerNametagTransform(nametag: THREE.Object3D | undefined, playerObject: { position: THREE.Vector3; scale: THREE.Vector3 }) {
  if (!nametag) return
  nametag.position.y = playerObject.position.y + playerObject.scale.y * 16 + 3
  nametag.scale.multiplyScalar(12)
}

// todo cleanup
const nametags = {}


function metadataAsArray(metadata: unknown): unknown[] | undefined {
  if (metadata == null) return undefined
  if (Array.isArray(metadata)) return metadata
  if (typeof metadata === 'object') {
    const record = metadata as Record<string, unknown>
    const keys = Object.keys(record)
      .filter(k => /^\d+$/.test(k))
      .map(Number)
      .sort((a, b) => a - b)
    if (keys.length && keys[0] === 0 && keys.every((k, i) => k === i)) {
      return keys.map(k => record[String(k)])
    }
  }
  return undefined
}

/** The painting entity's metadata keys (minecraft-data), to read its variant and direction. */
function paintingMetadataKeys(mcData: IndexedData | undefined): string[] | undefined {
  return (mcData as unknown as { entitiesByName?: Record<string, { metadataKeys?: string[] }> } | undefined)?.entitiesByName?.painting?.metadataKeys
}

function getEntityMesh(
  mcData: IndexedData | undefined,
  entity: import('prismarine-entity').Entity & { delete?: any; pos?: any; name?: any },
  world: WorldRendererThree,
  options: { fontFamily: string },
  overrides
) {
  if (entity.name) {
    try {
      // https://github.com/PrismarineJS/prismarine-viewer/pull/410
      const entityName = entityModelName(entity.name)
      // the exports load on demand: until the entity's is loaded, the older model, built again once it is
      void loadEntityModels(world.version)
      if (entityName === 'painting') {
        // PaintingRenderer's quads from the export, relative to the painting's block
        const painting = buildExportedPainting(world.version, paintingInputFromEntity(entity as never, paintingMetadataKeys(mcData)))
        if (painting) return painting
        // the version's export loads: nothing yet, built again once it is
        if (isEntityModelsVersionCovered(world.version) && !getEntityModelsStore(world.version)) {
          const pending = new THREE.Group()
          pending.userData[AWAITING_EXPORT_USER_DATA_KEY] = true
          return pending
        }
      }
      const e = new Entity.EntityMesh(world.version, entityName, world, { ...overrides, lookInput: lookInputFromEntity(entity) })

      if (e.mesh) {
        if (e.exported) e.mesh.userData[EXPORTED_BUILD_USER_DATA_KEY] = e.exported
        else if (entityExportVersionFor(world.version, entityName) && !getEntityModelsStoreFor(world.version, entityName)) e.mesh.userData[AWAITING_EXPORT_USER_DATA_KEY] = true
        addNametag(entity, options, e.mesh, world.version)
        return e.mesh
      }
      // no older model either: nothing until the export loads, then built again
      if (entityExportVersionFor(world.version, entityName) && !getEntityModelsStoreFor(world.version, entityName)) {
        const pending = new THREE.Group()
        pending.userData[AWAITING_EXPORT_USER_DATA_KEY] = true
        return pending
      }
    } catch (err) {
      reportError?.(err)
    }
  }

  if (!mcData || !isEntityAttackable(mcData, entity)) return
  const geometry = new THREE.BoxGeometry(entity.width, entity.height, entity.width)
  geometry.translate(0, entity.height / 2, 0)
  const material = new THREE.MeshBasicMaterial({ color: 0xff_00_ff })
  const cube = new THREE.Mesh(geometry, material)
  const nametagCount = (nametags[entity.name] = (nametags[entity.name] || 0) + 1)
  if (nametagCount < 6) {
    addNametag(
      {
        username: entity.name,
        height: entity.height
      },
      options,
      cube,
      world.version
    )
  }
  return cube
}

/** An entity mesh drawn with the older model while the entity's export loads. */
const AWAITING_EXPORT_USER_DATA_KEY = '_awaitingExportedEntityModels'
/** The overrides an entity was last updated with, to build it again. */
const LAST_OVERRIDES_USER_DATA_KEY = '_lastEntityOverrides'

/** The synched data names the export gives an entity (1.14+), by index. */
const exportedDataNames = (version: string, name: string) => (getExportedEntity(version, name) as { dataNames?: Record<string, string> } | undefined)?.dataNames ?? {}

/** The max_health attribute of a prismarine entity, when the server sent it. */
const maxHealthOf = (entity: unknown) => {
  const attributes = (entity as { attributes?: Record<string, { value?: number }> }).attributes
  const attribute = attributes?.['minecraft:max_health'] ?? attributes?.['minecraft:generic.max_health'] ?? attributes?.['generic.max_health'] ?? attributes?.['generic.maxHealth']
  return typeof attribute?.value === 'number' ? attribute.value : undefined
}

/** The exported model build of an entity mesh: its blocks and items are attached by Entities. */
const EXPORTED_BUILD_USER_DATA_KEY = '_exportedEntityBuild'
const EXPORTED_WALK_USER_DATA_KEY = '_exportedEntityWalk'
/** The keyframe animations an exported entity plays (warden, frog, camel, sniffer...). */
const EXPORTED_ANIMATOR_USER_DATA_KEY = '_exportedEntityAnimator'
/** The client side ticking of an exported entity whose models' setupAnim is ported (see entityAnimState). */
const ANIM_TRACKER_USER_DATA_KEY = '_entityAnimTracker'
/** What the tracker reads of the entity, kept from its updates. */
const ANIM_INPUT_USER_DATA_KEY = '_entityAnimInput'

/** Item-like entities exported as a single item (ThrownItemRenderer): the item and the renderer's scale. */
function exportedItemEntity(version: string, name: string): { item: string; scale: number } | undefined {
  const exported = getExportedEntity(version, name)
  if (!exported?.item) return undefined
  const look = composeEntityLook(exported)
  if (look.length !== 1 || look[0].entry.type !== 'item') return undefined
  const [m0, m1, m2] = look[0].entry.transform
  return { item: exported.item.replace(/^minecraft:/, ''), scale: Math.hypot(m0, m1, m2) || 1 }
}

/** Items the renderer shows for item-like entities that older data draws with missing item textures. */
export type SceneEntity = THREE.Object3D & {
  playerObject?: PlayerObjectType
  username?: string
  uuid?: string
  additionalCleanup?: () => void
  originalEntity: import('prismarine-entity').Entity & { delete?; pos?; name; team?: Team; renderHints?: EntityRenderHints }
}

export class Entities {
  entities = {} as Record<string, SceneEntity>
  playerEntity: SceneEntity | null = null // Special entity for the player in third person
  entitiesOptions = {
    fontFamily: 'mojangles'
  }
  debugMode: string
  onSkinUpdate: () => void
  clock = new THREE.Timer()
  currentlyRendering = true
  cachedMapsImages = {} as Record<number, string>
  itemFrameMaps = {} as Record<number, Array<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>>>
  pendingModelOverrides = new Map<string, { parts: EntityModelOverridePart[] }>()
  private boatPaddleScratch = createBoatPaddlePivotScratch()

  get entitiesByName(): Record<string, SceneEntity[]> {
    const byName: Record<string, SceneEntity[]> = {}
    for (const entity of Object.values(this.entities)) {
      if (!entity['realName']) continue
      byName[entity['realName']] = byName[entity['realName']] || []
      byName[entity['realName']].push(entity)
    }
    return byName
  }

  get entitiesRenderingCount(): number {
    return Object.values(this.entities).filter(entity => entity.visible).length
  }

  getDebugString(): string {
    const totalEntities = Object.keys(this.entities).length
    const visibleEntities = this.entitiesRenderingCount

    const playerEntities = Object.values(this.entities).filter(entity => entity.playerObject)
    const visiblePlayerEntities = playerEntities.filter(entity => entity.visible)

    return `${visibleEntities}/${totalEntities} ${visiblePlayerEntities.length}/${playerEntities.length}`
  }

  constructor(
    public worldRenderer: WorldRendererThree,
    public mcData?: IndexedData
  ) {
    this.debugMode = 'none'
    this.onSkinUpdate = () => {}
    this.watchResourcesUpdates()
    // player heads worn by exported entities load their skin through the client's proxy
    setSkinUrlResolver(url => {
      const { skinTexturesProxy } = this.worldRenderer.worldRendererConfig
      return skinTexturesProxy ? url.replace('http://textures.minecraft.net/', skinTexturesProxy).replace('https://textures.minecraft.net/', skinTexturesProxy) : url
    })
    // entities drawn with the older models while their export loaded: build them from it
    onEntityModelsLoaded(() => {
      for (const e of Object.values(this.entities)) {
        const mesh = e.children.find(child => child.name === 'mesh')
        if (!mesh?.userData[AWAITING_EXPORT_USER_DATA_KEY] || !e.originalEntity) continue
        const overrides = e.userData[LAST_OVERRIDES_USER_DATA_KEY] ?? {}
        // an item-like entity (ThrownItemRenderer) is made its item when it spawns: spawned again
        if (exportedItemEntity(this.worldRenderer.version, entityModelName(e.originalEntity.name ?? ''))) {
          const entity = e.originalEntity
          this.update({ id: entity.id, delete: true } as SceneEntity['originalEntity'], {})
          this.update(entity, overrides)
          continue
        }
        this.update(e.originalEntity, overrides)
      }
      // and the head items players wear
      for (const e of [this.playerEntity, ...Object.values(this.entities)]) {
        if (e?.playerObject && e.originalEntity) this.updatePlayerHeadItem(e, e.originalEntity)
      }
    })
  }

  handlePlayerEntity(playerData: SceneEntity['originalEntity']) {
    if (!this.isRenderingAllowed()) return
    // Create player entity if it doesn't exist
    if (!this.playerEntity) {
      // the version's entity models start loading with the world, before the first entity needs them
      void loadEntityModels(this.worldRenderer.version)
      // Create the player entity similar to how normal entities are created
      const group = new THREE.Group() as unknown as SceneEntity
      group.originalEntity = { ...playerData, name: 'player' } as SceneEntity['originalEntity']

      const wrapper = new THREE.Group()
      const playerObject = this.setupPlayerObject(playerData, wrapper, {})
      group.playerObject = playerObject
      group.add(wrapper)

      group.name = 'player_entity'
      this.playerEntity = group
      this.syncSceneAttachment(group)

      void this.updatePlayerSkin(playerData.id, playerData.username, playerData.uuid ?? undefined, stevePngUrl)
    }
    this.playerEntity.originalEntity = { ...playerData, name: 'player' } as SceneEntity['originalEntity']

    // Update position and rotation
    if (playerData.position) {
      if (!this.worldRenderer.sceneOrigin.getWorldPosition(this.playerEntity)) {
        this.worldRenderer.sceneOrigin.track(this.playerEntity)
      }
      this.playerEntity.position.set(playerData.position.x, playerData.position.y, playerData.position.z)
    }
    if (playerData.yaw !== undefined) {
      this.playerEntity.rotation.y = playerData.yaw
    }

    this.updateEntityEquipment(this.playerEntity, playerData)
  }

  clear() {
    for (const mesh of Object.values(this.entities)) {
      this.worldRenderer.sceneOrigin.removeAndUntrack(mesh)
      disposeObject(mesh)
    }
    this.entities = {}
    this.currentSkinUrls = {}
    this.playerVoiceStates = {}

    // Clean up player entity
    if (this.playerEntity) {
      this.worldRenderer.sceneOrigin.removeAndUntrack(this.playerEntity)
      disposeObject(this.playerEntity)
      this.playerEntity = null
    }
  }

  reloadEntities() {
    for (const entity of Object.values(this.entities)) {
      // update all entities textures like held items, armour, etc
      // todo update entity textures itself
      this.update({ ...entity.originalEntity, delete: true } as SceneEntity['originalEntity'], {})
      this.update(entity.originalEntity, {})
    }
  }

  watchResourcesUpdates() {
    this.worldRenderer.resourcesManager.on('assetsTexturesUpdated', () => this.reloadEntities())
    this.worldRenderer.resourcesManager.on('assetsInventoryReady', () => this.reloadEntities())
  }

  setDebugMode(mode: string, entity: THREE.Object3D | null = null) {
    this.debugMode = mode
    for (const mesh of entity ? [entity] : Object.values(this.entities)) {
      const boxHelper = mesh.children.find(c => c.name === 'debug')!
      boxHelper.visible = false
      if (this.debugMode === 'basic') {
        boxHelper.visible = true
      }
      // todo advanced
    }
  }

  setRendering(rendering: boolean, entity: THREE.Object3D | null = null) {
    this.currentlyRendering = rendering && this.isRenderingAllowed()
    this.setSceneAttached(this.currentlyRendering, entity)
  }

  isRenderingAllowed(): boolean {
    return this.worldRenderer.worldRendererConfig.renderEntities !== false && !this.worldRenderer.reactiveDebugParams.disableEntities
  }

  /** Add or remove entity meshes from the scene (including third-person player). */
  syncSceneAttachment(entity: THREE.Object3D | null = null): void {
    const attached = this.isRenderingAllowed()
    this.currentlyRendering = attached
    this.setSceneAttached(attached, entity)
  }

  private setSceneAttached(attached: boolean, entity: THREE.Object3D | null = null): void {
    const targets = entity ? [entity] : [...Object.values(this.entities), ...(this.playerEntity ? [this.playerEntity] : [])]
    for (const ent of targets) {
      if (attached) {
        if (!this.worldRenderer.scene.children.includes(ent)) this.worldRenderer.scene.add(ent)
      } else {
        this.worldRenderer.scene.remove(ent)
      }
    }
  }

  playEntityModelAnimation(entityId: string, animationName: string, loop = false) {
    const entity = this.entities[entityId]
    if (!entity) return

    entity.traverse(child => {
      if (child instanceof Entity.EntityMesh) {
        child.playAnimation(animationName, loop)
      }
    })
  }

  render() {
    this.syncSceneAttachment()
    if (!this.isRenderingAllowed()) return

    this.clock.update(performance.now())
    const dt = Math.min(this.clock.getDelta(), 1 / 30)
    const botPos = this.worldRenderer.viewerChunkPosition
    const VISIBLE_DISTANCE = 10 * 10

    for (const [entityIdRaw, entity] of [...Object.entries(this.entities), ['player_entity', this.playerEntity] as [string, SceneEntity | null]]) {
      if (!entity) continue

      const isPlayerEntity = entityIdRaw === 'player_entity'

      if (isPlayerEntity) {
        const thirdPerson = this.worldRenderer.playerStateUtils.isThirdPerson()
        entity.visible = thirdPerson

        const isAnchoredPassenger = entity.userData._passengerVehicleId != null || entity.userData._boatPassengerVehicleId != null
        if (thirdPerson && !isAnchoredPassenger) {
          const yOffset = this.worldRenderer.playerStateReactive.eyeHeight
          entity.position.set(this.worldRenderer.cameraWorldPos.x, this.worldRenderer.cameraWorldPos.y - yOffset, this.worldRenderer.cameraWorldPos.z)
        }
      }

      const { playerObject } = entity

      if (playerObject?.animation) {
        playerObject.animation.update(playerObject, dt)
      }

      if (!isPlayerEntity) {
        const renderHints = entity.userData.renderHints as EntityRenderHints | undefined
        if (shouldApplyLocalHorseCameraYawLock(renderHints)) {
          applyLocalHorseCameraYawLock(entity, this.worldRenderer.cameraShake.getBaseRotation().yaw)
        }
      }

      const horseHeadRig = entity.userData[HORSE_HEAD_RIG_USER_DATA_KEY] as HorseHeadRig | undefined
      const horseAnimation = entity.userData[HORSE_HEAD_ANIMATION_USER_DATA_KEY] as HorseHeadAnimationState | undefined
      if (horseHeadRig && horseAnimation) {
        const animation = updateHorseHeadAnimationFrame(horseAnimation, dt)
        const pose = calculateHorseHeadPose({
          entityPitch: entity.userData._horseHeadPitch ?? 0,
          headYaw: entity.userData._horseHeadYaw ?? entity.userData._horseBodyYaw ?? 0,
          bodyYaw: entity.userData._horseBodyYaw ?? 0,
          limbSwing: animation.limbSwing,
          limbSwingAmount: animation.limbSwingAmount
        })
        applyHorseHeadPose(horseHeadRig, pose)
      }

      if (!isPlayerEntity && playerObject) {
        applyNetworkHeadPitch(playerObject, entity.userData)
      }

      const exportedRig = entity.children.find(child => child.name === 'mesh')?.userData[EXPORTED_ENTITY_USER_DATA_KEY] as ExportedEntityRig | undefined
      const exportedWalk = entity.userData[EXPORTED_WALK_USER_DATA_KEY] as HorseHeadAnimationState | undefined
      const animTracker = entity.userData[ANIM_TRACKER_USER_DATA_KEY] as EntityAnimTracker | undefined
      const animInput = entity.userData[ANIM_INPUT_USER_DATA_KEY] as EntityAnimInput | undefined
      if (exportedRig && (exportedRig.anims.length || isBoatEntityName(exportedRig.name)) && animTracker && animInput) {
        // the models' own animation code, from the render state the game would extract
        const now = performance.now()
        const last = (entity.userData._animLastFrame as number | undefined) ?? now
        entity.userData._animLastFrame = now
        animTracker.setInput(animInput)
        animTracker.advance(Math.min((now - last) / 1000, 1))
        const animState = entityAnimState(animTracker, animInput)
        // models before render states (1.21.1 and older exports) read the entity: their own state
        const exportVersion = entityExportVersionFor(this.worldRenderer.version, exportedRig.name) ?? this.worldRenderer.version
        const modelState = versionToNumber(exportVersion) < versionToNumber('1.21.2') ? entityEraState(animTracker, animInput, exportedDataNames(this.worldRenderer.version, exportedRig.name), animState) : animState
        applyExportedSetupAnim(exportedRig, modelState)
        if (isBoatEntityName(animInput.name)) applyBoatRock(exportedRig, animState, animContext(this.worldRenderer.version).sin)
      } else if (exportedRig && exportedWalk && exportedRig.name !== 'armor_stand') {
        const walk = updateHorseHeadAnimationFrame(exportedWalk, dt)
        const angles = prismarineToGameHeadAngles(entity.userData._exportedBodyYaw ?? 0, entity.userData._exportedHeadYaw ?? entity.userData._exportedBodyYaw ?? 0, entity.userData._exportedPitch ?? 0)
        const animator = entity.userData[EXPORTED_ANIMATOR_USER_DATA_KEY] as ExportedEntityAnimator | undefined
        if (animator) resetExportedPose(exportedRig)
        // a model with a keyframe walk walks with it, not the generic limb swing
        applyExportedEntityPose(exportedRig, { ...angles, limbSwing: walk.limbSwing, limbSwingAmount: animator?.walks ? 0 : walk.limbSwingAmount })
        if (animator) applyAnimationOffsets(exportedRig, animator.sample(performance.now(), walk.limbSwing, walk.limbSwingAmount), animator.visibility())
      }
      if (exportedRig) updateExportedHeadAnchor(exportedRig)

      entity.traverse(child => {
        if (child instanceof Entity.EntityMesh) {
          child.update(dt)
        }
      })

      if (!isPlayerEntity && botPos && entity.position) {
        const dx = entity.position.x - botPos.x
        const dy = entity.position.y - botPos.y
        const dz = entity.position.z - botPos.z
        const distanceSquared = dx * dx + dy * dy + dz * dz

        const sectionKey = this.worldRenderer.entitySectionKey(entity.position.x, entity.position.y, entity.position.z)
        const occlusionVisible = this.worldRenderer.isSectionOcclusionVisible(sectionKey)

        entity.visible = !!((distanceSquared < VISIBLE_DISTANCE || this.worldRenderer.shouldObjectVisible(entity)) && occlusionVisible)

        this.maybeRenderPlayerSkin(entityIdRaw)
      }

      if (entity.userData.renderHints?.localVehicle) {
        const worldPos = this.resolveLocalVehicleRenderWorldPos(entity)
        entity.position.set(worldPos.x, worldPos.y, worldPos.z)
      }

      if (entity.visible && !isPlayerEntity) {
        this.syncArmorPositions(entity)
      }
    }

    this.updateVehiclePassengerPositions()
    this.applyRemoteBoatPassengerRotations()
    this.applyLocalThirdPersonPlayerRotation()
    this.updateBoatPaddleAnimations(dt)
  }

  private applyRemoteBoatPassengerRotations() {
    processRemoteBoatPassengerRotations({
      entities: this.entities as Record<string, RemoteBoatPassengerEntity>,
      syncArmor: entity => this.syncArmorPositions(entity as SceneEntity)
    })
  }

  private updateBoatPaddleAnimations(dt: number) {
    for (const entity of Object.values(this.entities)) {
      if (!entity) continue
      if (!isBoatEntityName(entity['realName'] as string | undefined)) continue

      const mesh = entity.children.find(child => child.name === 'mesh')
      if (!mesh) continue

      let animState = mesh.userData.boatPaddleAnimation as BoatPaddleAnimationState | undefined
      if (!animState) continue

      updateBoatPaddleAnimationState(
        animState,
        dt,
        mesh.userData.boatPaddleLeftPivot as THREE.Object3D | undefined,
        mesh.userData.boatPaddleRightPivot as THREE.Object3D | undefined,
        this.boatPaddleScratch
      )
    }
  }

  private applyLocalThirdPersonPlayerRotation() {
    const entity = this.playerEntity
    if (!entity?.visible || !entity.playerObject) return

    const rotation = this.worldRenderer.cameraShake.getBaseRotation()
    const isAnchoredPassenger = entity.userData._passengerVehicleId != null || entity.userData._boatPassengerVehicleId != null
    const anchoredVehicleId = entity.userData._passengerVehicleId ?? entity.userData._boatPassengerVehicleId
    const vehicle = anchoredVehicleId != null ? this.entities[anchoredVehicleId] : undefined
    const vehicleName = vehicle?.['realName'] ?? vehicle?.originalEntity.name
    const vehicleYaw = vehicle?.rotation.y

    if (
      shouldApplyBoatPassengerThirdPersonRotation({
        isThirdPerson: true,
        isAnchoredPassenger,
        vehicleName,
        vehicleYaw
      })
    ) {
      const resolved = resolveBoatPassengerThirdPersonRotation({
        cameraYaw: rotation.yaw,
        cameraPitch: rotation.pitch,
        vehicleYaw: vehicleYaw!
      })
      entity.rotation.set(0, resolved.bodyYaw, 0)
      forEachPlayerHead(entity, head => head.rotation.set(resolved.headPitch, resolved.headYaw, 0))
    } else {
      entity.rotation.set(0, rotation.yaw, 0)
      forEachPlayerHead(entity, head => head.rotation.set(-rotation.pitch, 0, 0))
    }

    this.syncArmorPositions(entity)
  }

  private resolvePassengerEntity(passengerId: number): SceneEntity | undefined {
    if (this.playerEntity?.originalEntity.id === passengerId) {
      return this.playerEntity
    }
    return this.entities[passengerId]
  }

  private resolveLocalVehicleRenderWorldPos(sceneEntity: SceneEntity): Vec3Like {
    const originalEntity = sceneEntity.originalEntity
    const renderHints = sceneEntity.userData.renderHints as EntityRenderHints | undefined
    const rawVehicleY = sceneEntity.userData._localVehicleY ?? originalEntity.position?.y ?? sceneEntity.position.y
    return resolveLocalVehicleWorldPosition({
      cameraWorldPos: this.worldRenderer.cameraWorldPos,
      rawVehicleY,
      eyeHeight: this.worldRenderer.playerStateReactive.eyeHeight,
      vehicleName: sceneEntity['realName'] ?? originalEntity.name,
      vehicleHeight: originalEntity.height ?? 1.6,
      verticalCameraLock: renderHints?.localVehicleVerticalCameraLock
    })
  }

  updateVehiclePassengerPositions() {
    applyVehiclePassengerPositions({
      entities: this.entities,
      localPlayer: this.playerEntity,
      getWorldPosition: target => this.worldRenderer.sceneOrigin.getWorldPosition(target as SceneEntity),
      version: this.worldRenderer.version
    })
  }

  /** @deprecated Use updateVehiclePassengerPositions */
  updateBoatPassengerPositions() {
    this.updateVehiclePassengerPositions()
  }

  private syncArmorPositions(entity: SceneEntity) {
    if (!entity.playerObject) return

    // todo-low use property access for less loop iterations (small performance gain)
    entity.traverse(armor => {
      if (!armor.name.startsWith('geometry_armor_')) return

      const { skin } = entity.playerObject!

      switch (armor.name) {
        case 'geometry_armor_head':
          // Head armor sync
          if (armor.children[0]?.children[0]) {
            armor.children[0].children[0].rotation.set(-skin.head.rotation.x, skin.head.rotation.y, skin.head.rotation.z, skin.head.rotation.order)
          }
          break

        case 'geometry_armor_legs':
          // Legs armor sync
          if (armor.children[0]) {
            // Left leg
            if (armor.children[0].children[2]) {
              armor.children[0].children[2].rotation.set(
                -skin.leftLeg.rotation.x,
                skin.leftLeg.rotation.y,
                skin.leftLeg.rotation.z,
                skin.leftLeg.rotation.order
              )
            }
            // Right leg
            if (armor.children[0].children[1]) {
              armor.children[0].children[1].rotation.set(
                -skin.rightLeg.rotation.x,
                skin.rightLeg.rotation.y,
                skin.rightLeg.rotation.z,
                skin.rightLeg.rotation.order
              )
            }
          }
          break

        case 'geometry_armor_feet':
          // Boots armor sync
          if (armor.children[0]) {
            // Right boot
            if (armor.children[0].children[0]) {
              armor.children[0].children[0].rotation.set(
                -skin.rightLeg.rotation.x,
                skin.rightLeg.rotation.y,
                skin.rightLeg.rotation.z,
                skin.rightLeg.rotation.order
              )
            }
            // Left boot (reversed Z rotation)
            if (armor.children[0].children[1]) {
              armor.children[0].children[1].rotation.set(
                -skin.leftLeg.rotation.x,
                skin.leftLeg.rotation.y,
                -skin.leftLeg.rotation.z,
                skin.leftLeg.rotation.order
              )
            }
          }
          break
      }
    })
  }

  getPlayerObject(entityId: string | number) {
    if (this.playerEntity?.originalEntity.id === entityId) return this.playerEntity?.playerObject
    const playerObject = this.entities[entityId]?.playerObject
    return playerObject
  }

  /** Current voice chat presence per entity id, keyed as a string. Absent = no voice indicator. */
  playerVoiceStates: Record<string, PlayerVoiceState> = {}

  /**
   * Show or hide the mic glyph on a player's nametag. `state` undefined hides it
   * (e.g. the player left voice chat, or walked out of proximity range).
   * Regenerates the nametag texture, so callers should only invoke this on
   * actual state transitions (speaking start/stop, mute toggle), not per-frame.
   */
  setPlayerVoiceState(entityId: string | number, username: string, state: PlayerVoiceState | undefined) {
    const key = String(entityId)
    if (state) {
      this.playerVoiceStates[key] = state
    } else {
      delete this.playerVoiceStates[key]
    }

    const e = this.entities[entityId]
    const playerObject = e?.playerObject
    if (!e || !playerObject) return
    const mesh = e.children.find(c => c.name === 'mesh')
    if (!mesh) return

    const nametag = addNametag({ username, voiceState: state }, this.entitiesOptions, mesh, this.worldRenderer.version)
    applyPlayerNametagTransform(nametag, playerObject)
  }

  uuidPerSkinUrlsCache = {} as Record<string, { skinUrl?: string; capeUrl?: string }>
  currentSkinUrls = {} as Record<string, string>

  private isCanvasBlank(canvas: HTMLCanvasElement | OffscreenCanvas): boolean {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    return !ctx?.getImageData(0, 0, canvas.width, canvas.height).data.some(channel => channel !== 0)
  }

  // todo true/undefined doesnt reset the skin to the default one
  // eslint-disable-next-line max-params
  async updatePlayerSkin(
    entityId: string | number,
    username: string | undefined,
    uuidCache: string | undefined,
    skinUrl: string | true,
    capeUrl: string | true | undefined = undefined
  ) {
    const isCustomSkin = skinUrl !== stevePngUrl
    if (isCustomSkin) {
      this.loadedSkinEntityIds.add(String(entityId))
    }
    if (uuidCache) {
      if (typeof skinUrl === 'string' || typeof capeUrl === 'string') this.uuidPerSkinUrlsCache[uuidCache] = {}
      if (typeof skinUrl === 'string') this.uuidPerSkinUrlsCache[uuidCache].skinUrl = skinUrl
      if (typeof capeUrl === 'string') this.uuidPerSkinUrlsCache[uuidCache].capeUrl = capeUrl
      if (skinUrl === true) {
        skinUrl = this.uuidPerSkinUrlsCache[uuidCache]?.skinUrl ?? skinUrl
      }
      capeUrl ??= this.uuidPerSkinUrlsCache[uuidCache]?.capeUrl
    }

    const playerObject = this.getPlayerObject(entityId)
    if (!playerObject) return

    if (skinUrl === true) {
      if (!username) return
      const newSkinUrl = await loadSkinFromUsername(username, 'skin')
      if (!this.getPlayerObject(entityId)) return
      if (!newSkinUrl) return
      skinUrl = newSkinUrl
    }

    if (typeof skinUrl !== 'string') throw new Error('Invalid skin url')

    // Skip if same skin URL is already loaded for this entity
    if (this.currentSkinUrls[String(entityId)] === skinUrl) {
      // Still handle cape if needed
      if (capeUrl) {
        if (capeUrl === true && username) {
          const newCapeUrl = await loadSkinFromUsername(username, 'cape')
          if (!this.getPlayerObject(entityId)) return
          if (!newCapeUrl) return
          capeUrl = newCapeUrl
        }
        if (typeof capeUrl === 'string') {
          void this.loadAndApplyCape(entityId, capeUrl)
        }
      }
      return
    }

    if (skinUrl !== stevePngUrl) {
      this.currentSkinUrls[String(entityId)] = skinUrl
    }
    const renderEars = this.worldRenderer.worldRendererConfig.renderEars || username === 'deadmau5'
    void this.loadAndApplySkin(entityId, skinUrl, renderEars).then(async () => {
      if (capeUrl) {
        if (capeUrl === true && username) {
          const newCapeUrl = await loadSkinFromUsername(username, 'cape')
          if (!this.getPlayerObject(entityId)) return
          if (!newCapeUrl) return
          capeUrl = newCapeUrl
        }
        if (typeof capeUrl === 'string') {
          void this.loadAndApplyCape(entityId, capeUrl)
        }
      }
    })

    playerObject.cape.visible = false
    if (!capeUrl) {
      playerObject.backEquipment = null
      playerObject.elytra.map = null
      if (playerObject.cape.map) {
        playerObject.cape.map.dispose()
      }
      playerObject.cape.map = null
    }
  }

  /** Local preview override: hand + player model until server skin refresh or reconnect. */
  async applyTemporaryPlayerSkinOverride(skinUrl: string, entityId: string | number, username?: string, uuid?: string) {
    this.worldRenderer.playerStateReactive.playerSkin = skinUrl
    await this.updatePlayerSkin(entityId, username, uuid, skinUrl, undefined)
  }

  private async loadAndApplySkin(entityId: string | number, skinUrl: string, renderEars: boolean) {
    let playerObject = this.getPlayerObject(entityId)
    if (!playerObject) return

    try {
      let playerCustomSkinImage: ImageBitmap | undefined

      playerObject = this.getPlayerObject(entityId)
      if (!playerObject) return

      let skinTexture: THREE.Texture
      let skinCanvas: OffscreenCanvas
      if (skinUrl === stevePngUrl) {
        const steveSkin = await loadSkinImage(stevePngUrl)
        playerCustomSkinImage = steveSkin.image
        skinTexture = new THREE.CanvasTexture(steveSkin.canvas)
        skinCanvas = steveSkin.canvas
      } else {
        const { canvas, image } = await loadSkinImage(skinUrl)
        playerCustomSkinImage = image
        skinTexture = new THREE.CanvasTexture(canvas)
        skinCanvas = canvas
      }

      skinTexture.magFilter = THREE.NearestFilter
      skinTexture.minFilter = THREE.NearestFilter
      skinTexture.needsUpdate = true
      playerObject.skin.map = skinTexture as any
      playerObject.skin.modelType = inferModelType(skinCanvas)
      playerObject.skin['isCustom'] = skinUrl !== stevePngUrl
      configurePlayerSkinMaterials(playerObject)

      let earsCanvas: OffscreenCanvas | undefined
      if (!playerCustomSkinImage) {
        renderEars = false
      } else if (renderEars) {
        earsCanvas = createCanvas(64, 64)
        loadEarsToCanvasFromSkin(earsCanvas as unknown as HTMLCanvasElement, playerCustomSkinImage)
        renderEars = !this.isCanvasBlank(earsCanvas)
      }
      if (renderEars) {
        const earsTexture = new THREE.CanvasTexture(earsCanvas!)
        earsTexture.magFilter = THREE.NearestFilter
        earsTexture.minFilter = THREE.NearestFilter
        earsTexture.needsUpdate = true
        playerObject.ears.map = earsTexture
        playerObject.ears.visible = true
      } else {
        playerObject.ears.map = null
        playerObject.ears.visible = false
      }
      this.onSkinUpdate?.()
    } catch (error) {
      console.error('Error loading skin:', error)
    }
  }

  private async loadAndApplyCape(entityId: string | number, capeUrl: string) {
    let playerObject = this.getPlayerObject(entityId)
    if (!playerObject) return

    try {
      const { canvas: capeCanvas, image: capeImage } = await loadSkinImage(capeUrl)

      playerObject = this.getPlayerObject(entityId)
      if (!playerObject) return

      loadCapeToCanvas(capeCanvas, capeImage)
      const capeTexture = new THREE.CanvasTexture(capeCanvas)
      capeTexture.magFilter = THREE.NearestFilter
      capeTexture.minFilter = THREE.NearestFilter
      capeTexture.needsUpdate = true
      playerObject.cape.map = capeTexture
      playerObject.cape.visible = true
      playerObject.elytra.map = capeTexture
      this.onSkinUpdate?.()

      if (!playerObject.backEquipment) {
        playerObject.backEquipment = 'cape'
      }
    } catch (error) {
      console.error('Error loading cape:', error)
    }
  }

  debugSwingArm() {
    const playerObject = Object.values(this.entities).find(entity => entity.playerObject?.animation)
    if (!playerObject || !playerObject.playerObject?.animation) return
    const anim = playerObject.playerObject.animation as any
    if (anim.swingArm) {
      anim.swingArm()
    }
  }

  private applyMovementAnimation(
    playerObject: PlayerObjectType,
    animation: 'walking' | 'running' | 'oneSwing' | 'idle' | 'crouch' | 'crouchWalking' | 'riding'
  ): void {
    const anim = playerObject.animation as WalkingGeneralSwing | undefined
    if (!anim) return

    if (animation === 'oneSwing') {
      anim.swingArm()
      return
    }

    anim.switchAnimationCallback = null
    if (animation === 'riding') {
      anim.isMoving = false
      anim.isRunning = false
      anim.isCrouched = false
      anim.isRiding = true
      return
    }

    anim.isRiding = false
    anim.isMoving = animation === 'walking' || animation === 'running' || animation === 'crouchWalking'
    anim.isRunning = animation === 'running'
    anim.isCrouched = animation === 'crouch' || animation === 'crouchWalking'
  }

  playAnimation(entityPlayerId, animation: 'walking' | 'running' | 'oneSwing' | 'idle' | 'crouch' | 'crouchWalking' | 'riding') {
    // a main hand swing (the animate packet's 0): exported models swing their arms from it too
    if (animation === 'oneSwing' && entityPlayerId !== 'player_entity') this.handleEntitySwing(entityPlayerId, 0)
    const playerObject =
      entityPlayerId === 'player_entity' ? this.playerEntity?.playerObject : (this.getPlayerObject(entityPlayerId) ?? this.playerEntity?.playerObject)

    if (!playerObject) return
    this.applyMovementAnimation(playerObject, animation)
  }

  parseEntityLabel(jsonLike) {
    if (!jsonLike) return
    try {
      if (jsonLike.type === 'string') {
        return jsonLike.value
      }
      const parsed = typeof jsonLike === 'string' ? mojangson.simplify(mojangson.parse(jsonLike)) : nbt.simplify(jsonLike)
      const text = flat(parsed).map(this.textFromComponent)
      return text.join('')
    } catch (err) {
      return jsonLike
    }
  }

  private textFromComponent(component) {
    return typeof component === 'string' ? component : (component.text ?? '')
  }

  getItemMesh(item, specificProps: ItemSpecificContextProperties, faceCamera = false, previousModel?: string) {
    if (!item.nbt && item.nbtData) item.nbt = item.nbtData
    const textureUv = this.worldRenderer.getItemRenderData(item, specificProps)
    if (previousModel && previousModel === textureUv?.modelName) return undefined

    if (textureUv && 'resolvedModel' in textureUv) {
      const mesh = getBlockMeshFromModel(
        this.worldRenderer.material,
        textureUv.resolvedModel,
        textureUv.modelName,
        this.worldRenderer.resourcesManager.currentResources.worldBlockProvider!,
        this.worldRenderer.resourcesManager.currentResources.mcData!
      )
      let SCALE = 1
      if (specificProps['minecraft:display_context'] === 'ground') {
        SCALE = 0.5
      } else if (specificProps['minecraft:display_context'] === 'thirdperson') {
        SCALE = 6
      }
      mesh.scale.set(SCALE, SCALE, SCALE)
      const outerGroup = new THREE.Group()
      outerGroup.add(mesh)
      return {
        mesh: outerGroup,
        isBlock: true,
        modelName: textureUv.modelName
      }
    }

    // Render proper 3D model for items
    if (textureUv) {
      const textureThree = textureUv.renderInfo?.texture === 'blocks' ? this.worldRenderer.material.map! : this.worldRenderer.itemsTexture
      const { u, v, su, sv } = textureUv
      const sizeX = su ?? 1 // su is actually width
      const sizeY = sv ?? 1 // sv is actually height

      const result = createItemMesh(
        textureThree,
        {
          u,
          v,
          sizeX,
          sizeY
        },
        {
          faceCamera,
          use3D: !faceCamera // Only use 3D for non-camera-facing items
        }
      )

      let SCALE = 1
      if (specificProps['minecraft:display_context'] === 'ground') {
        SCALE = 0.5
      } else if (specificProps['minecraft:display_context'] === 'thirdperson') {
        SCALE = 6
      }
      result.mesh.scale.set(SCALE, SCALE, SCALE)

      return {
        mesh: result.mesh,
        isBlock: false,
        modelName: textureUv.modelName,
        cleanup: result.cleanup
      }
    }
  }

  /**
   * The keyframe animations of an exported entity: made when its rig is (again when it is rebuilt from another export),
   * told the entity's pose and synched data on every update.
   */
  private updateExportedAnimator(e: SceneEntity, mesh: THREE.Object3D | undefined, entity: SceneEntity['originalEntity']) {
    const rig = mesh?.userData[EXPORTED_ENTITY_USER_DATA_KEY] as ExportedEntityRig | undefined
    if (!rig) {
      e.userData[EXPORTED_ANIMATOR_USER_DATA_KEY] = undefined
      return
    }
    let animator = e.userData[EXPORTED_ANIMATOR_USER_DATA_KEY] as (ExportedEntityAnimator & { rig?: ExportedEntityRig }) | undefined
    if (animator?.rig !== rig && (!animator || e.userData._exportedAnimatorName !== rig.name)) {
      const store = getEntityModelsStoreFor(this.worldRenderer.version, rig.name)
      animator = store ? ExportedEntityAnimator.create(rig.name, store, this.worldRenderer.version) : undefined
      e.userData[EXPORTED_ANIMATOR_USER_DATA_KEY] = animator
      e.userData._exportedAnimatorName = rig.name
    }
    if (animator) animator.rig = rig
    if (!animator) return
    const meta = getGeneralEntitiesMetadata(entity, this.mcData) as Record<string, unknown>
    animator.update(poseName(meta.pose, this.worldRenderer.version), key => meta[key])
  }

  /** An entity event (entity_status): exported entities start the animations it starts (a warden's attack, a creaking's). */
  handleEntityEvent(entityId: number | string, status: number) {
    const e = this.entities[entityId]
    const animator = e?.userData[EXPORTED_ANIMATOR_USER_DATA_KEY] as ExportedEntityAnimator | undefined
    animator?.event(status)
    ;(e?.userData[ANIM_TRACKER_USER_DATA_KEY] as EntityAnimTracker | undefined)?.event(status)
  }

  /**
   * An entity's arm swing (the animate packet's swing animations: 0 the main hand, 3 the off hand): the models' attack
   * poses follow it.
   */
  handleEntitySwing(entityId: number | string, animation: number) {
    const tracker = this.entities[entityId]?.userData[ANIM_TRACKER_USER_DATA_KEY] as EntityAnimTracker | undefined
    if (animation === 0 || animation === 3) tracker?.swingArm(animation === 0 ? 'MAIN_HAND' : 'OFF_HAND')
  }

  /** The head item a player model wears that the head layer draws (a skull, a block), if any. */
  private playerHeadItemInput(entity: SceneEntity['originalEntity']) {
    const input = lookInputFromEntity(entity as never).head
    if (!input) return undefined
    return buildHumanoidHeadItem(this.worldRenderer.version, input) ? input : undefined
  }

  /** Builds (again when the item changes) the head item of a player model on skinview3d's head. */
  private updatePlayerHeadItem(entityMesh: SceneEntity, entity: SceneEntity['originalEntity']) {
    const head = entityMesh.playerObject!.skin.head as THREE.Object3D
    const input = lookInputFromEntity(entity as never).head
    const signature = JSON.stringify(input ?? null)
    if (head.userData._headItemSignature === signature) return
    head.userData._headItemSignature = signature
    const previous = head.children.find(child => child.name === 'player_head_item')
    if (previous) {
      head.remove(previous)
      disposeObject(previous)
    }
    if (!input) return
    const built = buildHumanoidHeadItem(this.worldRenderer.version, input)
    if (!built) {
      // the version's export still loads: built once it is
      if (entityExportVersionFor(this.worldRenderer.version, 'zombie') && !getEntityModelsStoreFor(this.worldRenderer.version, 'zombie')) {
        head.userData._headItemSignature = undefined
        void loadEntityModels(this.worldRenderer.version)
      }
      return
    }
    const frame = new THREE.Group()
    frame.name = 'player_head_item'
    frame.matrixAutoUpdate = false
    frame.matrix.copy(SKINVIEW_HEAD_FRAME)
    frame.add(built.group)
    head.add(frame)
    if (built.headItem) this.attachHeadItem(built.headItem)
  }

  /** The level's game time (world age, ticks) the client last got: entities' animations that count from it read it. */
  gameTime?: { age: number; at: number }

  setWorldAge(age: number) {
    this.gameTime = { age: Number(age), at: performance.now() }
  }

  /** An entity's position and eyes, by network id (what a guardian or a wither looks at). */
  private entityEyePosition(id: number) {
    const target = this.entities[id]?.originalEntity ?? (this.playerEntity?.originalEntity.id === id ? this.playerEntity.originalEntity : undefined)
    const position = target?.position
    if (!target || !position) return undefined
    const height = target.height ?? 1.8
    const eyeHeight = (target as { eyeHeight?: number }).eyeHeight ?? height * 0.85
    return { x: position.x, y: position.y, z: position.z, eyeY: position.y + eyeHeight, eyeHeight, height }
  }

  /** What the client tick and render state of an exported entity read, from its latest update. */
  private updateAnimInput(e: SceneEntity, entity: SceneEntity['originalEntity'], metaByKey: Record<string, unknown>) {
    let meta = metaByKey
    if (!e.userData[ANIM_TRACKER_USER_DATA_KEY]) e.userData[ANIM_TRACKER_USER_DATA_KEY] = new EntityAnimTracker(entityModelName(entity.name ?? ''), this.worldRenderer.version)
    const previous = e.userData[ANIM_INPUT_USER_DATA_KEY] as EntityAnimInput | undefined
    const array = metadataAsArray(entity.metadata)
    const data: Record<number, unknown> = {}
    if (array) {
      for (const [index, value] of array.entries()) if (value !== undefined) data[index] = value
    } else {
      Object.assign(data, entity.metadata ?? {})
    }
    const equipment: Record<string, string | undefined> = {}
    const slots = ['mainhand', 'offhand', 'feet', 'legs', 'chest', 'head', 'body', 'saddle']
    for (const [index, item] of ((entity as { equipment?: Array<{ name?: string } | null | undefined> }).equipment ?? []).entries()) {
      if (item?.name && slots[index]) equipment[slots[index]] = item.name
    }
    // versions minecraft-data has no metadata keys for: the names the export gives the synched data (dataNames)
    const dataNames = (getExportedEntity(this.worldRenderer.version, entityModelName(entity.name ?? '')) as { dataNames?: Record<string, string> } | undefined)?.dataNames
    if (dataNames) {
      meta = { ...meta }
      for (const [index, key] of Object.entries(dataNames)) {
        const value = data[Number(index)]
        if (value === undefined) continue
        // minecraft-data drops the id_ the game's DATA_ID_* names keep (horse and panda flags: flags)
        for (const name of [key, key.replace(/^id_/, '')]) if (meta[name] === undefined) meta[name] = value
      }
    }
    const customName = typeof meta.custom_name === 'string' ? meta.custom_name : undefined
    e.userData[ANIM_INPUT_USER_DATA_KEY] = {
      name: entityModelName(entity.name ?? ''),
      version: this.worldRenderer.version,
      meta,
      data,
      pose: poseName(meta.pose, this.worldRenderer.version),
      bodyYaw: previous?.bodyYaw ?? (entity.yaw || 0),
      headYaw: previous?.headYaw ?? ((entity as { headYaw?: number }).headYaw ?? entity.yaw ?? 0),
      pitch: previous?.pitch ?? (entity.pitch || 0),
      position: previous?.position ?? (() => {
        const position = entity.position ?? (entity as { pos?: { x: number; y: number; z: number } }).pos
        return position ? { x: position.x, y: position.y, z: position.z } : undefined
      })(),
      onGround: (entity as { onGround?: boolean }).onGround,
      isPassenger: !!(entity as { vehicle?: unknown }).vehicle || e.userData._passengerVehicleId != null || e.userData._boatPassengerVehicleId != null,
      equipment,
      customName,
      renderHints: e.userData.renderHints as EntityAnimInput['renderHints'],
      entityId: typeof entity.id === 'number' ? entity.id : Number(entity.id),
      velocity: (entity as { velocity?: { x: number; y: number; z: number } }).velocity,
      isVehicle: !!(((e.userData.renderHints as EntityAnimInput['renderHints'])?.passengerIds?.length ?? 0) > 0 || (entity as { passengers?: unknown[] }).passengers?.length),
      maxHealth: maxHealthOf(entity),
      isInWater: (entity as { isInWater?: boolean }).isInWater ?? (e.userData.renderHints as { isInWater?: boolean } | undefined)?.isInWater,
      gameTime: this.gameTime ? this.gameTime.age + Math.floor((performance.now() - this.gameTime.at) / 50) : undefined,
      lookupEntity: id => this.entityEyePosition(id),
      cameraEyePosition: this.worldRenderer.cameraWorldPos
    } satisfies EntityAnimInput
  }

  /** Blocks an exported model draws (minecart contents, mooshroom mushrooms, the snow golem's pumpkin), and an item worn on the head. */
  attachExportedExtras(mesh: THREE.Object3D) {
    const build = mesh.userData[EXPORTED_BUILD_USER_DATA_KEY] as ExportedEntityBuild | undefined
    if (!build) return
    if (build.headItem) this.attachHeadItem(build.headItem)
    for (const block of build.blocks) {
      const name = block.block?.replace(/^minecraft:/, '').replace(/\[.*$/, '')
      if (!name) continue
      let object: ReturnType<Entities['getItemMesh']>
      try {
        object = this.getItemMesh({ name }, {})
      } catch {
        continue
      }
      if (!object?.isBlock) {
        object?.cleanup?.()
        continue
      }
      // the game draws the block model over (0, 0, 0) to (1, 1, 1) of the submitted pose; the item group is centered
      // and turned -90 degrees
      const holder = new THREE.Group()
      holder.name = `exported_block_${name}`
      holder.matrixAutoUpdate = false
      holder.matrix.fromArray(block.transform)
      const inner = new THREE.Group()
      inner.position.set(0.5, 0.5, 0.5)
      inner.rotation.y = Math.PI / 2
      inner.add(object.mesh)
      holder.add(inner)
      holder['additionalCleanup'] = () => object!.cleanup?.()
      mesh.add(holder)
    }
  }

  /**
   * An item worn on the head, drawn as the item (ItemRenderer with the head display context): the item model's head
   * display transform, then the model over -0.5 to 0.5, under the pose the head layer draws it with.
   */
  private attachHeadItem(headItem: NonNullable<ExportedEntityBuild['headItem']>) {
    const item = { name: headItem.item.name, metadata: headItem.item.metadata }
    let object: ReturnType<Entities['getItemMesh']>
    try {
      object = this.getItemMesh(item, { 'minecraft:display_context': 'head' })
    } catch {
      return
    }
    if (!object) return
    let resolvedModel: { display?: Record<string, { rotation?: number[]; translation?: number[]; scale?: number[] }> } | undefined
    try {
      const data = this.worldRenderer.getItemRenderData(item, { 'minecraft:display_context': 'head' })
      resolvedModel = data && 'resolvedModel' in data ? (data.resolvedModel as typeof resolvedModel) : undefined
    } catch {}
    const display = headItemDisplayTransform(object.isBlock, resolvedModel?.display?.head)
    const centered = new THREE.Group()
    // the item group is centered; block items are turned -90 degrees like the game's block model
    if (object.isBlock) centered.rotation.y = Math.PI / 2
    centered.add(object.mesh)
    display.add(centered)
    headItem.holder.add(display)
    headItem.holder['additionalCleanup'] = () => object!.cleanup?.()
  }

  setVisible(mesh: THREE.Object3D, visible: boolean) {
    //mesh.visible = visible
    //TODO: Fix workaround for visibility setting
    if (visible) {
      mesh.scale.set(1, 1, 1)
    } else {
      mesh.scale.set(0, 0, 0)
    }
  }

  update(entity: SceneEntity['originalEntity'], overrides) {
    // mannequins (1.21.9+) are drawn with the player model and skin
    const isPlayerModel = entity.name === 'player' || entity.name === 'mannequin'
    if (entity.name === 'zombie_villager' || entity.name === 'husk') {
      overrides.texture = `textures/1.16.4/entity/${entity.name === 'zombie_villager' ? 'zombie_villager/zombie_villager.png' : `zombie/${entity.name}.png`}`
    }
    if (entity.name === 'glow_item_frame') {
      if (!overrides.textures) overrides.textures = []
      overrides.textures['background'] = 'block:glow_item_frame'
    }
    // this can be undefined in case where packet entity_destroy was sent twice (so it was already deleted)
    let e = this.entities[entity.id]
    const justAdded = !e

    if (entity.delete) {
      if (!e) return
      e.userData._posTween?.stop()
      e.userData._rotTween?.stop()
      e.userData[HORSE_HEAD_ANIMATION_USER_DATA_KEY] = undefined
      e.userData[HORSE_HEAD_RIG_USER_DATA_KEY] = undefined
      const boatMesh = e.children.find(c => c.name === 'mesh')
      if (boatMesh) disposeBoatWaterPatch(boatMesh)
      if (e.additionalCleanup) e.additionalCleanup()
      e.traverse(c => {
        if (c['additionalCleanup']) c['additionalCleanup']()
      })
      this.onRemoveEntity(entity)
      this.worldRenderer.sceneOrigin.removeAndUntrack(e)
      disposeObject(e)
      // todo dispose textures as well ?
      delete this.entities[entity.id]
      delete this.playerVoiceStates[String(entity.id)]
      return
    }
    if (!this.isRenderingAllowed()) return

    let mesh: THREE.Object3D | undefined
    if (e === undefined) {
      this.beforeEntityAdded(entity)

      const group = new THREE.Group() as unknown as SceneEntity
      group.originalEntity = entity
      const itemName = entityModelName(entity.name ?? '')
      const itemEntity = exportedItemEntity(this.worldRenderer.version, itemName) ?? thrownItemOf(itemName, this.mcData?.itemsByName)
      if (itemEntity) {
        // the item the entity carries (synched data: a potion's own potion, a firework's own rocket), else its default
        const carried = metadataAsArray(entity.metadata)?.find((m: any) => typeof m === 'object' && m?.itemCount && (m.itemId !== undefined || m.blockId !== undefined))
        const object = (carried ? this.getItemMesh(carried, { 'minecraft:display_context': 'ground' }, true) : undefined) ?? this.getItemMesh({ name: itemEntity.item }, { 'minecraft:display_context': 'ground' }, true)
        if (object) {
          mesh = object.mesh
          mesh.scale.multiplyScalar(0.5 * itemEntity.scale)
          mesh.position.set(0, 0.1 * itemEntity.scale, 0)
          group.additionalCleanup = () => object.cleanup?.()
        }
      } else if (
        entity.name === 'item' ||
        entity.name === 'tnt' ||
        entity.name === 'falling_block'
      ) {
        const item =
          entity.name === 'tnt' || entity.type === 'projectile'
            ? { name: entity.name }
            : entity.name === 'falling_block'
              ? { blockState: entity['objectData'] }
              : metadataAsArray(entity.metadata)?.find((m: any) => typeof m === 'object' && m?.itemCount)
        if (item) {
          const object = this.getItemMesh(
            item,
            {
              'minecraft:display_context': 'ground'
            },
            entity.type === 'projectile'
          )
          if (object) {
            mesh = object.mesh
            if (entity.name === 'item' || entity.type === 'projectile') {
              mesh.scale.set(0.5, 0.5, 0.5)
              mesh.position.set(0, entity.name === 'item' ? 0.2 : 0.1, 0)
            } else {
              mesh.scale.set(2, 2, 2)
              mesh.position.set(0, 0.5, 0)
            }
            // set faces
            // mesh.position.set(targetPos.x + 0.5 + 2, targetPos.y + 0.5, targetPos.z + 0.5)
            // viewer.scene.add(mesh)
            if (entity.name === 'item') {
              const itemTimer = new THREE.Timer()
              mesh.onBeforeRender = () => {
                itemTimer.update(performance.now())
                const delta = itemTimer.getDelta()
                mesh!.rotation.y += delta
              }
            }

            group.additionalCleanup = () => {
              // important: avoid texture memory leak and gpu slowdown
              if (object.cleanup) {
                object.cleanup()
              }
            }
          }
        }
      } else if (isPlayerModel) {
        const wrapper = new THREE.Group()
        const playerObject = this.setupPlayerObject(entity, wrapper, overrides)
        group.playerObject = playerObject
        mesh = wrapper

        if (entity.username) {
          const nametag = addNametag(
            { ...entity, voiceState: this.playerVoiceStates[entity.id] },
            { fontFamily: 'mojangles' },
            wrapper,
            this.worldRenderer.version
          )
          applyPlayerNametagTransform(nametag, playerObject)
        }
      } else {
        mesh = getEntityMesh(this.mcData, entity, this.worldRenderer, this.entitiesOptions, { ...overrides, customModel: entity['customModel'] })
      }
      if (!mesh) return
      mesh.name = 'mesh'
      this.attachExportedExtras(mesh)
      if (mesh.userData[EXPORTED_ENTITY_USER_DATA_KEY]) group.userData[EXPORTED_WALK_USER_DATA_KEY] = createHorseHeadAnimationState()
      const boatMeshYawOffset = getBoatMeshYawOffset(entity.name)
      // the OBJ boat (no export for the version yet) faces -X and has rigs of its own; an exported boat faces north
      if (boatMeshYawOffset != null && !mesh.userData[EXPORTED_ENTITY_USER_DATA_KEY]) {
        mesh.rotation.y = boatMeshYawOffset
        setupBoatMesh(mesh)
      }
      // set initial position so there are no weird jumps update after
      const pos = entity.pos ?? entity.position
      this.worldRenderer.sceneOrigin.track(group)
      group.position.set(pos.x, pos.y, pos.z)

      // todo use width and height instead
      const boxHelper = new THREE.BoxHelper(
        mesh,
        entity.type === 'hostile' ? 0xff_00_00 : entity.type === 'mob' ? 0x00_ff_00 : entity.type === 'player' ? 0x00_00_ff : 0xff_a5_00
      )
      boxHelper.name = 'debug'
      group.add(mesh)
      group.add(boxHelper)
      boxHelper.visible = false

      e = group
      e.name = 'entity'
      e['realName'] = entity.name
      this.entities[entity.id] = e

      if (isPlayerModel) {
        void this.updatePlayerSkin(entity.id, entity.username, overrides?.texture ? entity.uuid : undefined, overrides?.texture || stevePngUrl)
      }
      this.setDebugMode(this.debugMode, group)
      this.syncSceneAttachment(group)

      this.afterAddEntity(entity)
      const horseHeadRig = mesh.userData[HORSE_HEAD_RIG_USER_DATA_KEY] as HorseHeadRig | undefined
      if (horseHeadRig) {
        e.userData[HORSE_HEAD_RIG_USER_DATA_KEY] = horseHeadRig
        e.userData[HORSE_HEAD_ANIMATION_USER_DATA_KEY] = createHorseHeadAnimationState()
      }
    } else {
      mesh = e.children.find(c => c.name === 'mesh')
      if (entity.renderHints) {
        e.originalEntity.renderHints = entity.renderHints
      }
      const rig = mesh?.userData[EXPORTED_ENTITY_USER_DATA_KEY] as ExportedEntityRig | undefined
      const awaiting =
        !rig &&
        !!mesh?.userData[AWAITING_EXPORT_USER_DATA_KEY] &&
        !!entity.name &&
        (entityModelName(entity.name) === 'painting' ? !!getEntityModelsStore(this.worldRenderer.version) : !!getExportedEntity(this.worldRenderer.version, entityModelName(entity.name)))
      // a painting whose variant or facing changed (1.21 sets them with metadata)
      const paintingSignatureNow = mesh?.userData[PAINTING_SIGNATURE_USER_DATA_KEY] as string | undefined
      const paintingLoaded = awaiting && entityModelName(entity.name!) === 'painting'
      if (mesh && (paintingLoaded || (paintingSignatureNow !== undefined && paintingSignature(paintingInputFromEntity(entity as never, paintingMetadataKeys(this.mcData))) !== paintingSignatureNow))) {
        const rebuilt = getEntityMesh(this.mcData, entity, this.worldRenderer, this.entitiesOptions, { ...overrides, customModel: entity['customModel'] })
        if (rebuilt) {
          rebuilt.name = 'mesh'
          e.remove(mesh)
          disposeObject(mesh)
          e.add(rebuilt)
          mesh = rebuilt
        }
      }
      if (mesh && (rig || awaiting)) {
        const exported = getExportedEntity(this.worldRenderer.version, rig?.name ?? entityModelName(entity.name!))
        if (exported && (awaiting || exportedEntitySignature(this.worldRenderer.version, rig!.name, lookInputFromEntity(entity)) !== rig!.signature)) {
          const rebuilt = getEntityMesh(this.mcData, entity, this.worldRenderer, this.entitiesOptions, { ...overrides, customModel: entity['customModel'] })
          if (rebuilt) {
            rebuilt.name = 'mesh'
            this.attachExportedExtras(rebuilt)
            e.remove(mesh)
            disposeObject(mesh)
            e.add(rebuilt)
            mesh = rebuilt
          }
        }
      }
    }

    this.applyEntityRenderHints(e, entity)
    e.userData[LAST_OVERRIDES_USER_DATA_KEY] = overrides
    this.updateExportedAnimator(e, mesh, entity)

    // Update equipment
    this.updateEntityEquipment(e, entity)

    const meta = getGeneralEntitiesMetadata(entity, this.mcData)
    if (mesh?.userData[EXPORTED_ENTITY_USER_DATA_KEY]) this.updateAnimInput(e, entity, meta as Record<string, unknown>)

    const meta0 = metadataAsArray(entity.metadata)?.[0] ?? (entity.metadata as { 0?: unknown } | undefined)?.[0]
    const isInvisible =
      ((meta0 ?? 0) as unknown as number) & 0x20 ||
      (this.worldRenderer.playerStateReactive.cameraSpectatingEntity === entity.id && this.worldRenderer.playerStateUtils.isSpectator())
    for (const child of mesh!.children ?? []) {
      if (child.name !== 'nametag') {
        child.visible = !isInvisible
      }
    }
    // ---
    // set baby size
    if (meta.baby && !mesh?.userData[EXPORTED_ENTITY_USER_DATA_KEY]) {
      e.scale.set(0.5, 0.5, 0.5)
    } else {
      e.scale.set(1, 1, 1)
    }
    // entity specific meta
    const textDisplayMeta = getSpecificEntityMetadata('text_display', entity, this.mcData)
    const displayTextRaw = textDisplayMeta?.text || (meta.custom_name_visible && meta.custom_name)
    if (entity.name !== 'player' && displayTextRaw) {
      const nameTagFixed = textDisplayMeta && (textDisplayMeta.billboard_render_constraints === 'fixed' || !textDisplayMeta.billboard_render_constraints)
      const nameTagBackgroundColor =
        textDisplayMeta && (parseInt(textDisplayMeta.style_flags, 10) & 0x04) === 0 ? toRgba(textDisplayMeta.background_color) : undefined
      let nameTagTextOpacity: any
      if (textDisplayMeta?.text_opacity) {
        const rawOpacity = parseInt(textDisplayMeta?.text_opacity, 10)
        nameTagTextOpacity = rawOpacity > 0 ? rawOpacity : 256 - rawOpacity
      }
      addNametag(
        {
          ...entity,
          username: typeof displayTextRaw === 'string' ? mojangson.simplify(mojangson.parse(displayTextRaw)) : nbt.simplify(displayTextRaw),
          nameTagBackgroundColor,
          nameTagTextOpacity,
          nameTagFixed,
          nameTagScale: textDisplayMeta?.scale,
          nameTagTranslation: textDisplayMeta && (textDisplayMeta.translation || new THREE.Vector3(0, 0, 0)),
          nameTagRotationLeft: toQuaternion(textDisplayMeta?.left_rotation),
          nameTagRotationRight: toQuaternion(textDisplayMeta?.right_rotation)
        },
        this.entitiesOptions,
        mesh,
        this.worldRenderer.version
      )
    }

    const armorStandMeta = getSpecificEntityMetadata('armor_stand', entity, this.mcData)
    if (armorStandMeta) {
      const isSmall = (parseInt(armorStandMeta.client_flags, 10) & 0x01) !== 0
      const hasArms = (parseInt(armorStandMeta.client_flags, 10) & 0x04) !== 0
      const hasBasePlate = (parseInt(armorStandMeta.client_flags, 10) & 0x08) === 0
      const isMarker = (parseInt(armorStandMeta.client_flags, 10) & 0x10) !== 0
      mesh!.castShadow = !isMarker
      mesh!.receiveShadow = !isMarker
      if (isSmall) {
        e.scale.set(0.5, 0.5, 0.5)
      } else {
        e.scale.set(1, 1, 1)
      }
      if (mesh?.userData[EXPORTED_ENTITY_USER_DATA_KEY]) {
        poseExportedArmorStand(mesh.userData[EXPORTED_ENTITY_USER_DATA_KEY] as ExportedEntityRig, armorStandMeta)
        updateExportedHeadAnchor(mesh.userData[EXPORTED_ENTITY_USER_DATA_KEY] as ExportedEntityRig)
      } else e.traverse(c => {
        switch (c.name) {
          case 'bone_baseplate':
            this.setVisible(c, hasBasePlate)
            c.rotation.y = -e.rotation.y
            break
          case 'bone_head':
            if (armorStandMeta.head_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.head_pose))
            }
            break
          case 'bone_body':
            if (armorStandMeta.body_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.body_pose))
            }
            break
          case 'bone_rightarm':
            if (c.parent?.name !== 'bone_armor') {
              this.setVisible(c, hasArms)
            }
            if (armorStandMeta.left_arm_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.left_arm_pose))
            } else {
              c.setRotationFromEuler(poseToEuler({ yaw: -10, pitch: -10, roll: 0 }))
            }
            break
          case 'bone_leftarm':
            if (c.parent?.name !== 'bone_armor') {
              this.setVisible(c, hasArms)
            }
            if (armorStandMeta.right_arm_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.right_arm_pose))
            } else {
              c.setRotationFromEuler(poseToEuler({ yaw: 10, pitch: -10, roll: 0 }))
            }
            break
          case 'bone_rightleg':
            if (armorStandMeta.left_leg_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.left_leg_pose))
            } else {
              c.setRotationFromEuler(poseToEuler({ yaw: -1, pitch: -1, roll: 0 }))
            }
            break
          case 'bone_leftleg':
            if (armorStandMeta.right_leg_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.right_leg_pose))
            } else {
              c.setRotationFromEuler(poseToEuler({ yaw: 1, pitch: 1, roll: 0 }))
            }
            break
        }
      })
    }

    // todo handle map, map_chunks events
    let itemFrameMeta = getSpecificEntityMetadata('item_frame', entity, this.mcData)
    if (!itemFrameMeta) {
      itemFrameMeta = getSpecificEntityMetadata('glow_item_frame', entity, this.mcData)
    }
    if (itemFrameMeta) {
      // TODO: fix type
      // todo! fix errors in mc-data (no entities data prior 1.18.2)
      const item = (itemFrameMeta?.item ?? entity.metadata?.[8]) as any as { itemId; blockId; components; nbtData: { value: { map: { value: number } } } }
      mesh!.scale.set(1, 1, 1)
      mesh!.position.set(0, 0, -0.5)

      e.rotation.x = -entity.pitch
      e.children
        .find(c => {
          if (c.name.startsWith('map_')) {
            disposeObject(c)
            const existingMapNumber = parseInt(c.name.split('_')[1], 10)
            this.itemFrameMaps[existingMapNumber] = this.itemFrameMaps[existingMapNumber]?.filter(mesh => mesh !== c)
            if (c instanceof THREE.Mesh) {
              c.material?.map?.dispose()
            }
            return true
          } else if (c.name === 'item') {
            disposeObject(c)
            return true
          }
          return false
        })
        ?.removeFromParent()

      if (item && (item.itemId ?? item.blockId ?? 0) !== 0) {
        // Get rotation from metadata, default to 0 if not present
        // Rotation is stored in 45° increments (0-7) for items, 90° increments (0-3) for maps
        const rotation = (itemFrameMeta.rotation as any as number) ?? 0
        const mapNumber = item.nbtData?.value?.map?.value ?? item.components?.find(x => x.type === 'map_id')?.data
        if (mapNumber) {
          // TODO: Use proper larger item frame model when a map exists
          mesh!.scale.set(16 / 12, 16 / 12, 1)
          // Handle map rotation (4 possibilities, 90° increments)
          this.addMapModel(e, mapNumber, rotation)
        } else {
          // Handle regular item rotation (8 possibilities, 45° increments)
          const itemMesh = this.getItemMesh(item, {
            'minecraft:display_context': 'fixed'
          })
          if (itemMesh) {
            itemMesh.mesh.position.set(0, 0, -0.05)
            if (itemMesh.isBlock) {
              itemMesh.mesh.scale.set(0.25, 0.25, 0.25)
            } else {
              itemMesh.mesh.scale.set(0.5, 0.5, 0.5)
            }
            // Rotate 180° around Y axis first
            itemMesh.mesh.rotateY(Math.PI)
            // Then apply the 45° increment rotation
            itemMesh.mesh.rotateZ((-rotation * Math.PI) / 4)
            itemMesh.mesh.name = 'item'
            e.add(itemMesh.mesh)
          }
        }
      }
    }

    if (entity.username !== undefined) {
      e.username = entity.username
    }

    this.updateNameTagVisibility(e)

    this.updateEntityPosition(entity, justAdded, overrides)
  }

  applyEntityRenderHints(e: SceneEntity, entity: SceneEntity['originalEntity']) {
    if (entity.renderHints) {
      const hints = entity.renderHints as EntityRenderHints
      const nextPassengerIds = new Set(hints.passengerIds ?? hints.boatPassengerIds ?? [])
      const previousPassengerIds = e.userData.renderHints?.passengerIds ?? e.userData.renderHints?.boatPassengerIds ?? []
      const isPassengerVehicle = isBoatEntityName(entity.name) || isRideableMinecartEntityName(entity.name)
      if (isPassengerVehicle) {
        for (const previousPassengerId of previousPassengerIds) {
          if (nextPassengerIds.has(previousPassengerId)) continue
          const previousPassenger = this.resolvePassengerEntity(previousPassengerId)
          if (previousPassenger) {
            releaseVehiclePassengerPosition(previousPassenger, String(entity.id), this.worldRenderer.sceneOrigin.getWorldPosition(previousPassenger))
          }
        }
      }
      e.userData.renderHints = entity.renderHints
    }
    if (!isBoatEntityName(entity.name)) return
    const mesh = e.children.find(c => c.name === 'mesh')
    if (!mesh) return
    const waterPatch = mesh.userData.boatWaterPatch as THREE.Object3D | undefined
    if (waterPatch) {
      waterPatch.visible = entity.renderHints?.boatWaterPatchVisible === true
    }

    const hints = (e.userData.renderHints ?? entity.renderHints) as EntityRenderHints | undefined
    const leftActive = hints?.boatPaddleLeft === true
    const rightActive = hints?.boatPaddleRight === true
    let animState = mesh.userData.boatPaddleAnimation as BoatPaddleAnimationState | undefined
    if (!animState) {
      animState = createBoatPaddleAnimationState()
      mesh.userData.boatPaddleAnimation = animState
    }
    syncBoatPaddleAnimationTargets(animState, leftActive, rightActive)
  }

  updateEntityPosition(
    entity: SceneEntity['originalEntity'],
    justAdded: boolean,
    overrides: { rotation?: { head?: { y: number; x: number } } },
    headRotationOnly = false
  ) {
    const e = this.entities[entity.id]
    if (!e) return
    this.applyEntityRenderHints(e, entity)
    if (e.userData[HORSE_HEAD_RIG_USER_DATA_KEY]) {
      e.userData._horseHeadPitch = typeof entity.pitch === 'number' && Number.isFinite(entity.pitch) ? entity.pitch : 0
      const headYaw = (entity as any).headYaw
      e.userData._horseHeadYaw = typeof headYaw === 'number' && Number.isFinite(headYaw) ? headYaw : entity.yaw
      e.userData._horseBodyYaw = typeof entity.yaw === 'number' && Number.isFinite(entity.yaw) ? entity.yaw : 0
    }
    if (e.userData[EXPORTED_WALK_USER_DATA_KEY]) {
      e.userData._exportedPitch = typeof entity.pitch === 'number' && Number.isFinite(entity.pitch) ? entity.pitch : 0
      e.userData._exportedBodyYaw = typeof entity.yaw === 'number' && Number.isFinite(entity.yaw) ? entity.yaw : 0
      const headYaw = (entity as any).headYaw
      e.userData._exportedHeadYaw = typeof headYaw === 'number' && Number.isFinite(headYaw) ? headYaw : e.userData._exportedBodyYaw
      if (!headRotationOnly && entity.position && Number.isFinite(entity.position.x) && Number.isFinite(entity.position.z)) {
        setHorseHeadAnimationPosition(e.userData[EXPORTED_WALK_USER_DATA_KEY], entity.position)
      }
    }
    // what the exported entity's client ticking reads: rotations, position, ground
    const animInput = e.userData[ANIM_INPUT_USER_DATA_KEY] as EntityAnimInput | undefined
    if (animInput) {
      const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
      animInput.bodyYaw = finite(entity.yaw, animInput.bodyYaw)
      animInput.headYaw = finite((entity as { headYaw?: number }).headYaw, animInput.bodyYaw)
      animInput.pitch = finite(entity.pitch, animInput.pitch)
      const position = entity.position ?? (entity as { pos?: { x: number; y: number; z: number } }).pos
      if (!headRotationOnly && position && Number.isFinite(position.x)) {
        animInput.position = { x: position.x, y: position.y, z: position.z }
        // when it arrived: the ticks reach it in order, however many one frame covers
        ;(e.userData[ANIM_TRACKER_USER_DATA_KEY] as EntityAnimTracker | undefined)?.walk.setPosition(animInput.position, performance.now())
      }
      animInput.onGround = (entity as { onGround?: boolean }).onGround
    }
    const cameraSynced = usesCameraSyncedVehiclePosition(entity)
    if (entity.position) {
      if (cameraSynced) {
        e.userData._localVehicleY = entity.position.y
        e.userData._posTween?.stop()
        e.userData._posTween = undefined
        const worldPos = this.resolveLocalVehicleRenderWorldPos(e)
        e.position.set(worldPos.x, worldPos.y, worldPos.z)
      } else {
        const ANIMATION_DURATION = getEntityTweenDurationMs(entity, justAdded)
        // Initialize tween target from current world position
        const currentWorld = this.worldRenderer.sceneOrigin.getWorldPosition(e) ?? { x: entity.position.x, y: entity.position.y, z: entity.position.z }
        if (!e.userData._tweenTarget) {
          e.userData._tweenTarget = { x: currentWorld.x, y: currentWorld.y, z: currentWorld.z }
        }
        // Stop previous position tween to prevent accumulation
        e.userData._posTween?.stop()
        // Tween a separate target object, apply via proxy on each update
        e.userData._posTween = new TWEEN.Tween(e.userData._tweenTarget)
          .to({ x: entity.position.x, y: entity.position.y, z: entity.position.z }, ANIMATION_DURATION)
          .onUpdate(() => {
            e.position.set(e.userData._tweenTarget.x, e.userData._tweenTarget.y, e.userData._tweenTarget.z)
          })
          .start()
      }
      const horseAnimation = e.userData[HORSE_HEAD_ANIMATION_USER_DATA_KEY] as HorseHeadAnimationState | undefined
      if (!headRotationOnly && horseAnimation && Number.isFinite(entity.position.x) && Number.isFinite(entity.position.z)) {
        setHorseHeadAnimationPosition(horseAnimation, entity.position)
      }
    }
    const rotationTweenDuration = getEntityRotationTweenDurationMs(entity, justAdded)
    /** World yaw for the whole model: for PlayerObject skins, rotate body to head look dir; head mesh stays yaw-fixed (pitch only). */
    let targetYaw: number | undefined
    if (e.playerObject && overrides?.rotation?.head) {
      const hy = overrides.rotation.head.y
      const headYawWorld = typeof hy === 'number' && Number.isFinite(hy) ? hy : entity.yaw
      if (typeof headYawWorld === 'number' && Number.isFinite(headYawWorld)) {
        targetYaw = headYawWorld
      }
    } else if (entity.name === 'painting' && e.children.find(c => c.name === 'mesh')?.userData[PAINTING_SIGNATURE_USER_DATA_KEY] !== undefined) {
      // an exported painting turns itself from its facing
      targetYaw = 0
    } else if (typeof entity.yaw === 'number' && Number.isFinite(entity.yaw)) {
      targetYaw = entity.yaw
    }
    if (typeof targetYaw === 'number' && Number.isFinite(targetYaw)) {
      // Stop previous rotation tween to prevent accumulation (mirror _posTween)
      e.userData._rotTween?.stop()
      e.userData._rotTween = undefined
      const currentYaw = Number.isFinite(e.rotation.y) ? e.rotation.y : 0
      const dy = shortestYawRadians(currentYaw, targetYaw)
      if (rotationTweenDuration === 0) {
        e.rotation.y = currentYaw + dy
      } else {
        e.userData._rotTween = new TWEEN.Tween(e.rotation).to({ y: currentYaw + dy }, rotationTweenDuration).start()
      }
    }

    if (e?.playerObject && overrides?.rotation?.head) {
      const { playerObject } = e
      const hy = overrides.rotation.head.y
      storeNetworkHeadYaw(e.userData, hy, entity.yaw)
      playerObject.skin.head.rotation.y = 0

      const hp = overrides.rotation.head.x
      storeNetworkHeadPitch(e.userData, hp)
      applyNetworkHeadPitch(playerObject, e.userData)
    } else if (e?.playerObject && typeof entity.yaw === 'number' && Number.isFinite(entity.yaw)) {
      storeNetworkHeadYaw(e.userData, undefined, entity.yaw)
    }
  }

  afterAddEntity(entity: import('prismarine-entity').Entity) {}

  beforeEntityAdded(entity: import('prismarine-entity').Entity) {
    const override = this.pendingModelOverrides.get(entity.id.toString())
    if (override) {
      const { parts } = override
      entity['customModel'] = parts.length === 1 ? parts[0]! : { parts }
      this.pendingModelOverrides.delete(entity.id.toString())
    }
  }

  loadedSkinEntityIds = new Set<string>()
  maybeRenderPlayerSkin(entityId: string) {
    let mesh = this.entities[entityId]
    if (entityId === 'player_entity') {
      mesh = this.playerEntity!
      entityId = this.playerEntity?.originalEntity.id as any
    }
    if (!mesh) return
    if (!mesh.playerObject) return
    if (!mesh.visible) return

    const MAX_DISTANCE_SKIN_LOAD = 128
    const cameraPos = this.worldRenderer.getCameraPosition()
    // Use world positions for accurate distance calculation
    const wp = this.worldRenderer.sceneOrigin.getWorldPosition(mesh)
    const entityWorldPos = wp
      ? new THREE.Vector3(wp.x, wp.y, wp.z)
      : mesh.position.clone().add(new THREE.Vector3(this.worldRenderer.sceneOrigin.x, this.worldRenderer.sceneOrigin.y, this.worldRenderer.sceneOrigin.z))
    const distance = entityWorldPos.distanceTo(cameraPos)
    if (distance < MAX_DISTANCE_SKIN_LOAD && distance < this.worldRenderer.viewDistance * 16) {
      if (this.loadedSkinEntityIds.has(String(entityId))) return
      void this.updatePlayerSkin(entityId, mesh.playerObject.realUsername, mesh.playerObject.realPlayerUuid, true, true)
    }
  }

  onRemoveEntity(entity: import('prismarine-entity').Entity) {
    this.loadedSkinEntityIds.delete(entity.id.toString())
    delete this.currentSkinUrls[entity.id.toString()]
  }

  updateMap(mapNumber: string | number, data: string) {
    this.cachedMapsImages[mapNumber] = data
    let itemFrameMeshes = this.itemFrameMaps[mapNumber]
    if (!itemFrameMeshes) return
    itemFrameMeshes = itemFrameMeshes.filter(mesh => mesh.parent)
    this.itemFrameMaps[mapNumber] = itemFrameMeshes
    if (itemFrameMeshes) {
      for (const mesh of itemFrameMeshes) {
        mesh.material.map = this.loadMap(data)
        mesh.material.needsUpdate = true
        mesh.visible = true
      }
    }
  }

  updateNameTagVisibility(entity: SceneEntity) {
    const playerTeam = this.worldRenderer.playerStateReactive.team
    const entityTeam = entity.originalEntity.team
    const nameTagVisibility = entityTeam?.nameTagVisibility || 'always'
    const showNameTag =
      nameTagVisibility === 'always' ||
      (nameTagVisibility === 'hideForOwnTeam' && entityTeam?.team !== playerTeam?.team) ||
      (nameTagVisibility === 'hideForOtherTeams' && (entityTeam?.team === playerTeam?.team || playerTeam === undefined))
    entity.traverse(c => {
      if (c.name === 'nametag') {
        c.visible = showNameTag
      }
    })
  }

  addMapModel(entityMesh: THREE.Object3D, mapNumber: number, rotation: number) {
    const imageData = this.cachedMapsImages?.[mapNumber]
    let texture: THREE.Texture | null = null
    if (imageData) {
      texture = this.loadMap(imageData)
    }
    const parameters = {
      transparent: true,
      alphaTest: 0.1
    }
    if (texture) {
      parameters['map'] = texture
    }
    const material = new THREE.MeshLambertMaterial(parameters)

    const mapMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)

    mapMesh.rotation.set(0, Math.PI, 0)
    entityMesh.add(mapMesh)
    let isInvisible = true
    entityMesh.traverseVisible(c => {
      if (c.name === 'geometry_frame') {
        isInvisible = false
      }
    })
    if (isInvisible) {
      mapMesh.position.set(0, 0, 0.499)
    } else {
      mapMesh.position.set(0, 0, 0.437)
    }
    // Apply 90° increment rotation for maps (0-3)
    mapMesh.rotateZ(Math.PI * 2 - (rotation * Math.PI) / 2)
    mapMesh.name = `map_${mapNumber}`

    if (!texture) {
      mapMesh.visible = false
    }

    if (!this.itemFrameMaps[mapNumber]) {
      this.itemFrameMaps[mapNumber] = []
    }
    this.itemFrameMaps[mapNumber].push(mapMesh)
  }

  loadMap(data: any) {
    const texture = loadNearestFilterTexture(data)
    texture.needsUpdate = true
    return texture
  }

  addItemModel(entityMesh: SceneEntity, hand: 'left' | 'right', item: Item, isPlayer = false) {
    const bedrockParentName = `bone_${hand}item`
    const itemName = `custom_item_${hand}`

    // remove existing item
    entityMesh.traverse(c => {
      if (c.name === itemName) {
        c.removeFromParent()
        if (c['additionalCleanup']) c['additionalCleanup']()
      }
    })
    if (!item) return

    const itemObject = this.getItemMesh(item, {
      'minecraft:display_context': 'thirdperson'
    })
    if (itemObject?.mesh) {
      entityMesh.traverse(c => {
        if (c instanceof THREE.Bone && c.name === `${hand}_arm` && !c.children.some(child => child.name === itemName)) {
          const group = new THREE.Object3D()
          group['additionalCleanup'] = () => itemObject.cleanup?.()
          group.rotation.set(-Math.PI / 2, Math.PI, 0, 'XYZ')
          group.translateX(hand === 'left' ? -1 : 1)
          group.translateY(2)
          group.translateZ(-10)
          const holder = new THREE.Object3D()
          holder.rotation.x = Math.PI
          holder.add(itemObject.mesh)
          group.add(holder)
          group.name = itemName
          c.add(group)
          return
        }
        if (c.name.toLowerCase() === bedrockParentName || c.name === `${hand}Arm`) {
          const group = new THREE.Object3D()
          group['additionalCleanup'] = () => {
            // important: avoid texture memory leak and gpu slowdown
            if (itemObject.cleanup) {
              itemObject.cleanup()
            }
          }
          const itemMesh = itemObject.mesh
          group.rotation.z = -Math.PI / 16
          if (itemObject.isBlock) {
            group.rotation.y = Math.PI / 4
          } else {
            itemMesh.rotation.z = -Math.PI / 4
            group.rotation.y = Math.PI / 2
            group.scale.multiplyScalar(2)
          }

          // if player, move item below and forward a bit
          if (isPlayer) {
            group.position.y = -8
            group.position.z = 5
            group.position.x = hand === 'left' ? 1 : -1
            group.rotation.x = Math.PI
          }

          group.add(itemMesh)

          group.name = itemName
          c.add(group)
        }
      })
    }
  }

  handleDamageEvent(entityId, damageAmount) {
    const entityMesh = this.entities[entityId]?.children.find(c => c.name === 'mesh')
    if (entityMesh) {
      entityMesh.traverse(child => {
        if (child instanceof THREE.Mesh && child.material.clone) {
          const clonedMaterial = child.material.clone()
          clonedMaterial.dispose()
          child.material = child.material.clone()
          const originalColor = child.material.color.clone()
          child.material.color.set(0xff_00_00)
          new TWEEN.Tween(child.material.color).to(originalColor, 500).start()
        }
      })
    }
  }

  raycastSceneDebug() {
    // return any object from scene. raycast from camera
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.worldRenderer.camera)
    const intersects = raycaster.intersectObjects(this.worldRenderer.scene.children)
    return intersects[0]?.object
  }

  updateEntityModel(entityId: string, modelPathOrParts: string | EntityModelOverridePart[], modelType?: Entity.EntityModelType, metadata?: any) {
    const parts: EntityModelOverridePart[] = Array.isArray(modelPathOrParts)
      ? modelPathOrParts
      : [{ modelPath: modelPathOrParts, modelType: modelType!, metadata }]
    this.pendingModelOverrides.set(entityId, { parts })

    // Force entity recreation if it exists
    const entity = this.entities[entityId]
    if (!entity) return

    // Update with remove flag to force recreation
    this.update({ ...entity.originalEntity, delete: true } as SceneEntity['originalEntity'], {})
    this.update(entity.originalEntity, {})
  }

  private setupPlayerObject(entity: SceneEntity['originalEntity'], wrapper: THREE.Group, overrides: { texture?: string }): PlayerObjectType {
    const playerObject = new PlayerObject() as PlayerObjectType
    playerObject.realPlayerUuid = entity.uuid ?? ''
    playerObject.realUsername = entity.username ?? ''
    playerObject.position.set(0, 16, 0)

    configurePlayerSkinMaterials(playerObject)

    wrapper.add(playerObject as any)
    const scale = 1 / 16
    wrapper.scale.set(scale, scale, scale)
    wrapper.rotation.set(0, Math.PI, 0)

    // Set up animation
    playerObject.animation = new WalkingGeneralSwing()
    //@ts-expect-error
    playerObject.animation.isMoving = false

    return playerObject
  }

  private updateEntityEquipment(entityMesh: SceneEntity, entity: SceneEntity['originalEntity']) {
    if (!entityMesh || !entity.equipment) return

    const isPlayer = entity.type === 'player'
    const exported = !!entityMesh.children.find(child => child.name === 'mesh')?.userData[EXPORTED_ENTITY_USER_DATA_KEY]
    const mainHand = isPlayer || exported ? 'right' : 'left'
    this.addItemModel(entityMesh, mainHand, entity.equipment[0], isPlayer)
    this.addItemModel(entityMesh, mainHand === 'right' ? 'left' : 'right', entity.equipment[1], isPlayer)
    // exported entities with armor draw the armor layers the game exported, rebuilt when the equipment changes
    const exportedRig = entityMesh.children.find(child => child.name === 'mesh')?.userData[EXPORTED_ENTITY_USER_DATA_KEY] as ExportedEntityRig | undefined
    if (!exportedRig?.armor) {
      addArmorModel(this.worldRenderer, entityMesh, 'feet', entity.equipment[2])
      addArmorModel(this.worldRenderer, entityMesh, 'legs', entity.equipment[3], 2)
      addArmorModel(this.worldRenderer, entityMesh, 'chest', entity.equipment[4])
      // a skull or block on the head is the head layer's (updatePlayerHeadItem), not armor
      if (!entityMesh.playerObject || !this.playerHeadItemInput(entity)) addArmorModel(this.worldRenderer, entityMesh, 'head', entity.equipment[5])
      else removeArmorModel(entityMesh, 'head')
    }

    // a skull or block worn on a player's (or mannequin's) head, drawn as the head layer draws it
    if (entityMesh.playerObject) this.updatePlayerHeadItem(entityMesh, entity)

    // Update player-specific equipment
    if (isPlayer && entityMesh.playerObject) {
      const { playerObject } = entityMesh
      playerObject.backEquipment = entity.equipment.some(item => item?.name === 'elytra') ? 'elytra' : 'cape'
      if (playerObject.backEquipment === 'elytra') {
        void this.loadAndApplyCape(entity.id, elytraTexture)
      }
      if (playerObject.cape.map === null) {
        playerObject.cape.visible = false
      }
    }
  }
}

/**
 * ArmorStandArmorModel.setupAnim: each part's rotation is its pose in degrees; the parts' rest pose from the export has
 * the default poses, metadata replaces them.
 */
function poseExportedArmorStand(rig: ExportedEntityRig, meta: Record<string, any>) {
  const poses: Record<string, unknown> = {
    head: meta.head_pose,
    body: meta.body_pose,
    left_arm: meta.left_arm_pose,
    right_arm: meta.right_arm_pose,
    left_leg: meta.left_leg_pose,
    right_leg: meta.right_leg_pose
  }
  for (const [part, pose] of Object.entries(poses)) {
    if (!pose || typeof pose !== 'object') continue
    const { pitch = 0, yaw = 0, roll = 0 } = pose as { pitch?: number; yaw?: number; roll?: number }
    for (const exported of rig.parts.get(part) ?? []) {
      exported.bone.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), THREE.MathUtils.degToRad(roll), 'ZYX')
      exported.rest.rotation.copy(exported.bone.rotation)
    }
  }
}

function getGeneralEntitiesMetadata(
  entity: { name; metadata },
  mcData?: IndexedData
): Partial<UnionToIntersection<EntityMetadataVersions[keyof EntityMetadataVersions]>> {
  const entityData = mcData?.entitiesByName[entity.name]
  return new Proxy(
    {},
    {
      get(target, p, receiver) {
        if (typeof p !== 'string' || !entityData) return
        const index = entityData.metadataKeys?.indexOf(p)
        return entity.metadata?.[index ?? -1]
      }
    }
  )
}

function getSpecificEntityMetadata<T extends keyof EntityMetadataVersions>(name: T, entity, mcData?: IndexedData): EntityMetadataVersions[T] | undefined {
  if (entity.name !== name) return
  return getGeneralEntitiesMetadata(entity, mcData) as any
}

function addArmorModel(worldRenderer: WorldRendererThree, entityMesh: THREE.Object3D, slotType: string, item: Item, layer = 1, overlay = false) {
  if (!item) {
    removeArmorModel(entityMesh, slotType)
    return
  }
  const itemParts = item.name.split('_')
  let texturePath
  const isPlayerHead = slotType === 'head' && item.name === 'player_head'
  if (isPlayerHead) {
    removeArmorModel(entityMesh, slotType)
    if (item.nbt) {
      const itemNbt = nbt.simplify(item.nbt)
      try {
        let textureData
        if (itemNbt.SkullOwner) {
          textureData = itemNbt.SkullOwner.Properties.textures[0]?.Value
        } else {
          textureData = itemNbt['minecraft:profile']?.Properties?.find(p => p.name === 'textures')?.value
        }
        if (textureData) {
          const decodedData = JSON.parse(Buffer.from(textureData, 'base64').toString())
          texturePath = decodedData.textures?.SKIN?.url
          const { skinTexturesProxy } = worldRenderer.worldRendererConfig
          if (skinTexturesProxy) {
            texturePath = texturePath
              ?.replace('http://textures.minecraft.net/', skinTexturesProxy)
              .replace('https://textures.minecraft.net/', skinTexturesProxy)
          }
        }
      } catch (err) {
        console.error('Error decoding player head texture:', err)
      }
    } else {
      texturePath = stevePngUrl
    }
  }
  const armorMaterial = itemParts[0]
  if (!texturePath) {
    // TODO: Support mirroring on certain parts of the model
    const armorTextureName = `${armorMaterial}_layer_${layer}${overlay ? '_overlay' : ''}`
    texturePath = worldRenderer.resourcesManager.currentResources.customTextures.armor?.textures[armorTextureName]?.src ?? armorTextures[armorTextureName]
  }
  if (!texturePath || !armorModel[slotType]) {
    removeArmorModel(entityMesh, slotType)
    return
  }

  const meshName = `geometry_armor_${slotType}${overlay ? '_overlay' : ''}`
  let mesh = entityMesh.children.findLast(c => c.name === meshName) as THREE.Mesh
  let material
  if (mesh) {
    material = mesh.material
    void loadTexture(texturePath, texture => {
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.flipY = false
      texture.wrapS = THREE.MirroredRepeatWrapping
      texture.wrapT = THREE.MirroredRepeatWrapping
      material.map = texture
    })
  } else {
    mesh = getMesh(worldRenderer, texturePath, armorModel[slotType])
    if (slotType === 'head') {
      // avoid z-fighting with the head
      mesh.children[0].position.y += 0.01
    }
    mesh.name = meshName
    material = mesh.material
    if (!isPlayerHead) {
      material.side = THREE.DoubleSide
    }
  }
  if (armorMaterial === 'leather' && !overlay) {
    const color = (item.nbt?.value as any)?.display?.value?.color?.value
    if (color) {
      const r = (color >> 16) & 0xff
      const g = (color >> 8) & 0xff
      const b = color & 0xff
      material.color.setRGB(r / 255, g / 255, b / 255)
    } else {
      material.color.setHex(0xb5_6d_51) // default brown color
    }
    addArmorModel(worldRenderer, entityMesh, slotType, item, layer, true)
  } else {
    material.color.setHex(0xff_ff_ff)
  }
  const group = new THREE.Object3D()
  group.name = `armor_${slotType}${overlay ? '_overlay' : ''}`
  group.add(mesh)

  entityMesh.add(mesh)
}

function removeArmorModel(entityMesh: THREE.Object3D, slotType: string) {
  for (const c of entityMesh.children) {
    if (c.name === `geometry_armor_${slotType}` || c.name === `geometry_armor_${slotType}_overlay`) {
      c.removeFromParent()
    }
  }
}
