import type { EntityAnimInput, EntityAnimTracker, EntityDriver } from '../entityAnimState'
import { clamp, f, lerp, rotLerp, wrapDegrees, type SinCos } from '../setupAnim/mth'
import { animContext, type AnimState } from '../setupAnim/types'

/**
 * Monsters (26.3): creeper, enderman, spider, cave spider, slime, magma cube, sulfur cube, blaze, ghast, happy ghast,
 * phantom, silverfish, endermite, shulker, shulker bullet, wither, ender dragon, end crystal. Each driver is the entity's
 * client side ticking (Creeper.tick's swell, AbstractCubeMob.tick's squish, SulfurCube's fuse, Shulker's peek and
 * teleport interpolation, WitherBoss.aiStep's side heads, EnderDragon.aiStep's flapping and flight history, EndCrystal's
 * time, ProjectileUtil.rotateTowardsMovement for the shulker bullet) and its renderer's extractRenderState, from what the
 * client knows of the entity.
 *
 * Inputs read beyond EntityAnimInput (all optional, `(input as any).name`):
 * - `entityId` (number): the entity's network id (Phantom.getUniqueFlapTickOffset is id * 3); absent = 0.
 * - `velocity` ({ x, y, z }, blocks per tick): the entity's deltaMovement as the last set_entity_motion packet gave it
 *   (the ender dragon's flap speed, the shulker bullet's rotation); absent = the position change since the last tick.
 * - `isVehicle` (boolean): the entity has passengers (set_passengers), the happy ghast's isRidden.
 * - `lookupEntity(id)` (=> { x, y, z, eyeY } | undefined): another entity the client knows, by network id (the wither's
 *   side heads look at their targets' eyes); absent or unknown = the game's branch for a target the client hasn't got.
 * - `maxHealth` (number): the max health attribute (the wither is powered at half of it); absent = 300 (the default).
 * - `podiumTopY` (number): the MOTION_BLOCKING_NO_LEAVES heightmap Y at the end podium column (x 0, z 0), from which the
 *   ender dragon's distanceToEgg is measured; absent = distanceToEgg 0 (the render state's default).
 * - `nearestCrystal` ({ x, y, z, time }): the end crystal the ender dragon draws its healing beam from (its position and
 *   its own `time` counter); absent = no beam.
 */

// ---- synched data helpers ----

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : undefined)

const truthy = (value: unknown) => value === true || value === 1

const mobFlag = (input: EntityAnimInput, mask: number) => {
  const value = num(input.meta.mob_flags ?? input.meta.insentient)
  return value !== undefined && (value & mask) !== 0
}

/** Mob.isNoAi */
const isNoAi = (input: EntityAnimInput) => mobFlag(input, 1)

/** LivingEntity.isDeadOrDying: health <= 0 (the client's entity starts at full health until the data says otherwise). */
const isDeadOrDying = (input: EntityAnimInput) => {
  const health = num(input.meta.health)
  return health !== undefined && health <= 0
}

/** prismarine yaw (radians, 0 north, counterclockwise) to the game's yRot in degrees, as entityAnimState converts it. */
const RAD_TO_DEG = 180 / Math.PI
const gameYRot = (yaw: number) => f(wrapDegrees(f(180 - yaw * RAD_TO_DEG)))
const gameXRot = (pitch: number) => f(-pitch * RAD_TO_DEG)

const sinCosCache = new Map<string, SinCos>()
/** Mth.sin / Mth.cos of the version (the double table from 1.21.11, the float table before). */
const sinCos = (version: string): SinCos => {
  let value = sinCosCache.get(version)
  if (!value) {
    const context = animContext(version)
    value = { sin: context.sin, cos: context.cos }
    sinCosCache.set(version, value)
  }
  return value
}

type Vec = { x: number; y: number; z: number }

/**
 * The entity's deltaMovement: the `velocity` input when the scene has it (the motion packets' value, which the game's
 * client keeps for these entities), else the position change over the last tick (recorded by `trackPosition`).
 */
const velocity = (tracker: EntityAnimTracker, input: EntityAnimInput): Vec => {
  const given = (input as any).velocity as Vec | undefined
  if (given && typeof given.x === 'number') return given
  const delta = tracker.memory.positionDelta as Vec | undefined
  return delta ?? { x: 0, y: 0, z: 0 }
}

/** Records the position change since the last tick (the `velocity` fallback): call once at the start of a tick. */
const trackPosition = (tracker: EntityAnimTracker, input: EntityAnimInput) => {
  const m = tracker.memory
  const position = input.position
  if (!position) return
  const last = m.lastPosition as Vec | undefined
  m.positionDelta = last ? { x: position.x - last.x, y: position.y - last.y, z: position.z - last.z } : { x: 0, y: 0, z: 0 }
  m.lastPosition = { x: position.x, y: position.y, z: position.z }
}

// ---- Mth.atan2 (the game's table based arctangent, not Math.atan2) ----

const bits = new DataView(new ArrayBuffer(8))
const doubleBits = (value: number) => {
  bits.setFloat64(0, value)
  return bits.getBigInt64(0)
}
const bitsToDouble = (value: bigint) => {
  bits.setBigInt64(0, BigInt.asIntN(64, value))
  return bits.getFloat64(0)
}
const FRAC_BIAS = bitsToDouble(4_805_340_802_404_319_232n)
const ASIN_TAB = new Float64Array(257)
const COS_TAB = new Float64Array(257)
for (let index = 0; index < 257; index++) {
  const asin = Math.asin(index / 256)
  COS_TAB[index] = Math.cos(asin)
  ASIN_TAB[index] = asin
}
/** the entries where HotSpot's Math.cos (the game's table) is 1 ulp off V8's (printed by the Java code) */
const JAVA_COS_TAB: Record<number, number> = {
  61: 0.971_196_193_309_280_6,
  70: 0.961_889_772_060_057_8,
  125: 0.872_686_324_459_388_7,
  127: 0.868_268_962_482_788_2,
  141: 0.834_649_635_864_317_3,
  170: 0.747_677_066_716_473_5,
  175: 0.729_862_716_516_563_4,
  181: 0.707_182_304_305_924_7,
  182: 0.703_255_196_279_238_3,
  186: 0.687_100_381_017_031_6
}
for (const [index, value] of Object.entries(JAVA_COS_TAB)) COS_TAB[Number(index)] = value

/** Mth.fastInvSqrt */
const fastInvSqrt = (value: number) => {
  const half = 0.5 * value
  let x = bitsToDouble(6_910_469_410_427_058_090n - (doubleBits(value) >> 1n))
  x *= 1.5 - half * x * x
  return x
}

/** Mth.atan2(double, double) */
export const mthAtan2 = (y: number, x: number) => {
  const d2 = x * x + y * y
  if (Number.isNaN(d2)) return Number.NaN
  const negY = y < 0
  if (negY) y = -y
  const negX = x < 0
  if (negX) x = -x
  const steep = y > x
  if (steep) {
    const t = x
    x = y
    y = t
  }
  const rinv = fastInvSqrt(d2)
  x *= rinv
  y *= rinv
  const yp = FRAC_BIAS + y
  const index = Number(BigInt.asIntN(32, doubleBits(yp)))
  const phi = ASIN_TAB[index]!
  const cPhi = COS_TAB[index]!
  const sPhi = yp - FRAC_BIAS
  const sd = y * cPhi - x * sPhi
  const d = (6 + sd * sd) * sd * 0.166_666_666_666_666_66
  let theta = phi + d
  if (steep) theta = 1.570_796_326_794_896_6 - theta
  if (negX) theta = 3.141_592_653_589_793 - theta
  if (negY) theta = -theta
  return theta
}

// ---- creeper ----

/** Creeper's maxSwell: the "Fuse" NBT, which isn't synched; the client keeps the default. */
const CREEPER_MAX_SWELL = 30

const creeper: EntityDriver = {
  /** Creeper.tick (client side: the swell counts toward the synched swell direction; ignited forces it to 1) */
  tick(tracker, input) {
    if (isDeadOrDying(input)) return
    const m = tracker.memory
    m.swell ??= 0
    m.oldSwell = m.swell
    // isIgnited: setSwellDir(1), which the client sets on its own copy of the synched data
    const swellDir = truthy(input.meta.is_ignited) ? 1 : (num(input.meta.swell_dir) ?? -1)
    m.swell += swellDir
    if (m.swell < 0) m.swell = 0
    if (m.swell >= CREEPER_MAX_SWELL) m.swell = CREEPER_MAX_SWELL // explodeCreeper is the server's
  },
  state(state, tracker, input) {
    const m = tracker.memory
    // Creeper.getSwelling
    state.swelling = f(lerp(tracker.partialTick, m.oldSwell ?? 0, m.swell ?? 0) / (CREEPER_MAX_SWELL - 2))
    state.isPowered = truthy(input.meta.is_powered)
  }
}

// ---- enderman ----

const enderman: EntityDriver = {
  state(state, _tracker, input) {
    state.isCreepy = truthy(input.meta.creepy)
    // DATA_CARRY_STATE (OPTIONAL_BLOCK_STATE, 0 = none): the block state id; the renderer resolves its block model
    const carried = input.meta.carry_state
    state.carriedBlock = (typeof carried === 'number' && carried > 0) || (carried !== null && typeof carried === 'object') ? carried : undefined
  }
}

// ---- slimes ----

/**
 * AbstractCubeMob.tick: the squish eases toward the target, which landing sets to -0.5 and leaving the ground to 1, then
 * decreaseSquish (0.6 for slimes and sulfur cubes, 0.9 for magma cubes) shrinks the target.
 */
const tickSquish = (tracker: EntityAnimTracker, input: EntityAnimInput, decrease: number) => {
  const m = tracker.memory
  m.squish ??= 0
  m.targetSquish ??= 0
  m.wasOnGround ??= false
  m.oSquish = m.squish
  m.squish = f(m.squish + f(f(m.targetSquish - m.squish) * 0.5))
  const onGround = !!input.onGround
  if (onGround && !m.wasOnGround) m.targetSquish = -0.5
  else if (!onGround && m.wasOnGround) m.targetSquish = 1
  m.wasOnGround = onGround
  m.targetSquish = f(m.targetSquish * f(decrease))
}

/** AbstractCubeMobRenderer.extractRenderState */
const squishState = (state: AnimState, tracker: EntityAnimTracker, input: EntityAnimInput) => {
  const m = tracker.memory
  state.squish = lerp(tracker.partialTick, m.oSquish ?? 0, m.squish ?? 0)
  state.size = num(input.meta.size) ?? 1
}

const cubeMob = (decrease: number): EntityDriver => ({
  tick: (tracker, input) => tickSquish(tracker, input, decrease),
  state: squishState
})

/** The skull blocks' SkullBlock.Type by item (a sulfur cube that swallowed one wears it as a head). */
const SKULL_TYPES: Record<string, string> = {
  skeleton_skull: 'SKELETON',
  wither_skeleton_skull: 'WITHER_SKELETON',
  player_head: 'PLAYER',
  zombie_head: 'ZOMBIE',
  creeper_head: 'CREEPER',
  dragon_head: 'DRAGON',
  piglin_head: 'PIGLIN'
}

const sulfurCube: EntityDriver = {
  /** SulfurCube.tick: tickFuse (the MAX_FUSE callback sets the fuse, each tick counts it down), then the squish */
  tick(tracker, input) {
    const m = tracker.memory
    const maxFuse = num(input.meta.max_fuse) ?? -1
    m.fuse ??= -1
    // onSyncedDataUpdated(MAX_FUSE): the spawn data's value, then each change
    if (m.maxFuse === undefined ? maxFuse !== -1 : maxFuse !== m.maxFuse) m.fuse = maxFuse
    m.maxFuse = maxFuse
    if (m.fuse > 0) m.fuse--
    tickSquish(tracker, input, 0.6)
  },
  state(state, tracker, input) {
    squishState(state, tracker, input)
    const fuse = tracker.memory.fuse ?? -1
    // isPrimed: fuse >= 0
    state.fuseRemainingTicks = fuse >= 0 ? f(f(fuse - tracker.partialTick) + 1) : 0
    // the body slot holds the swallowed block: a skull is drawn as a worn head, any other block as its block model
    const body = input.equipment?.body?.replace(/^minecraft:/, '')
    state.wornHeadType = undefined
    state.containedBlock = undefined
    if (body) {
      if (SKULL_TYPES[body]) state.wornHeadType = SKULL_TYPES[body]
      else state.containedBlock = body
    }
  }
}

// ---- blaze, ghasts, phantom ----

const blaze: EntityDriver = {
  state(state, _tracker, input) {
    // Blaze.isOnFire is its charged flag (DATA_FLAGS_ID bit 1), which displayFireAnimation reads
    const flags = num(input.meta.flags)
    state.displayFireAnimation = flags !== undefined && (flags & 1) !== 0
  }
}

const ghast: EntityDriver = {
  state(state, _tracker, input) {
    state.isCharging = truthy(input.meta.is_charging)
  }
}

const happyGhast: EntityDriver = {
  state(state, _tracker, input) {
    state.bodyItem = input.equipment?.body
    state.isRidden = !!(input as any).isVehicle
    state.isLeashHolder = truthy(input.meta.is_leash_holder)
    // HappyGhast.getAgeScale
    state.ageScale = state.isBaby ? f(0.2375) : 1
  }
}

const phantom: EntityDriver = {
  state(state, _tracker, input) {
    // getUniqueFlapTickOffset: id * 3
    const id = num((input as any).entityId) ?? 0
    state.flapTime = f(f(id * 3) + state.ageInTicks)
    state.size = num(input.meta.size) ?? 0
  }
}

// ---- shulker ----

const DIRECTIONS = ['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST']
const DYE_COLORS = ['WHITE', 'ORANGE', 'MAGENTA', 'LIGHT_BLUE', 'YELLOW', 'LIME', 'PINK', 'GRAY', 'LIGHT_GRAY', 'CYAN', 'PURPLE', 'BLUE', 'BROWN', 'GREEN', 'RED', 'BLACK']

const directionName = (value: unknown) => {
  if (typeof value === 'string') return value.toUpperCase()
  const id = num(value)
  return id === undefined ? 'DOWN' : (DIRECTIONS[id] ?? 'DOWN')
}

/** Shulker.getColor: 16 (or anything above 15) = no color; DyeColor.byId falls back to white */
const shulkerColor = (value: unknown) => {
  const id = num(value) ?? 16
  if (id > 15) return null
  return DYE_COLORS[id] ?? 'WHITE'
}

/** the block position Shulker.setPos snaps to: (floor(x) + 0.5, floor(y + 0.5), floor(z) + 0.5) */
const shulkerBlockPos = (position: Vec) => ({ x: Math.floor(position.x), y: Math.floor(position.y + 0.5), z: Math.floor(position.z) })

const samePos = (a: Vec | null | undefined, b: Vec) => !!a && a.x === b.x && a.y === b.y && a.z === b.z

const shulker: EntityDriver = {
  tick(tracker, input) {
    const m = tracker.memory
    const rawPeekData = num(input.meta.peek) ?? 0
    // a peek packet (onSyncedDataUpdated) sets the client's copy
    if (rawPeekData !== m.rawPeekData) {
      m.rawPeekData = rawPeekData
      m.rawPeek = rawPeekData
    }
    m.interpolation ??= 0
    // Shulker.setPos (the client's interpolation moving it, before tick): a new block position resets the client's peek
    // and starts the 6 tick teleport interpolation from the old position (not on the entity's first tick)
    if (input.position) {
      const pos = shulkerBlockPos(input.position)
      const old = m.blockPos as Vec | undefined
      if (old && tracker.tickCount > 1 && !samePos(old, pos)) {
        m.rawPeek = 0
        if (!input.isPassenger && !samePos(m.clientOldAttachPosition, pos)) {
          m.clientOldAttachPosition = old
          m.interpolation = 6
        }
      }
      m.blockPos = pos
    }
    // updatePeekAmount
    m.peek ??= 0
    m.peekO = m.peek
    const target = f((m.rawPeek ?? 0) * f(0.01))
    if (m.peek !== target) {
      if (m.peek > target) m.peek = clamp(f(m.peek - f(0.05)), target, 1)
      else m.peek = clamp(f(m.peek + f(0.05)), 0, target)
    }
    // the client's teleport interpolation countdown
    if (m.interpolation > 0) m.interpolation--
    else m.clientOldAttachPosition = null
  },
  state(state, tracker, input) {
    const m = tracker.memory
    const pt = tracker.partialTick
    state.peekAmount = lerp(pt, m.peekO ?? 0, m.peek ?? 0)
    state.yHeadRot = gameYRot(input.headYaw)
    state.yBodyRot = gameYRot(input.bodyYaw)
    state.attachFace = directionName(input.meta.attach_face)
    state.color = shulkerColor(input.meta.color)
    // getRenderPosition
    const old = m.clientOldAttachPosition as Vec | null | undefined
    const current = m.blockPos as Vec | undefined
    if (old && current && m.interpolation > 0) {
      let scale = f(m.interpolation - pt) / 6
      scale *= scale
      scale *= state.scale ?? 1
      state.renderOffset = { x: -((current.x - old.x) * scale), y: -((current.y - old.y) * scale), z: -((current.z - old.z) * scale) }
    } else {
      state.renderOffset = { x: 0, y: 0, z: 0 }
    }
  }
}

// ---- shulker bullet ----

/** Entity.setXRot: xRot % 360, clamped to -90..90 */
const setXRot = (xRot: number) => clamp(f(xRot % 360), -90, 90)

const shulkerBullet: EntityDriver = {
  /**
   * The client's rotation: a rotation the server sends (a change of the input's yaw / pitch) is taken as is, then each
   * tick ProjectileUtil.rotateTowardsMovement(0.5) turns it halfway toward the movement.
   */
  tick(tracker, input) {
    const m = tracker.memory
    trackPosition(tracker, input)
    const inputYRot = gameYRot(input.bodyYaw)
    const inputXRot = setXRot(gameXRot(input.pitch))
    m.yRot ??= inputYRot
    m.xRot ??= inputXRot
    // setOldPosAndRot
    m.yRotO = m.yRot
    m.xRotO = m.xRot
    if (inputYRot !== m.inputYRot || inputXRot !== m.inputXRot) {
      m.inputYRot = inputYRot
      m.inputXRot = inputXRot
      m.yRot = inputYRot
      m.xRot = inputXRot
    }
    const movement = velocity(tracker, input)
    if (movement.x * movement.x + movement.y * movement.y + movement.z * movement.z !== 0) {
      const sd = Math.sqrt(movement.x * movement.x + movement.z * movement.z)
      const yRot = f(f(mthAtan2(movement.z, movement.x) * 57.295_776_367_187_5) + 90)
      const xRot = setXRot(f(f(mthAtan2(sd, movement.y) * 57.295_776_367_187_5) - 90))
      while (f(xRot - m.xRotO) < -180) m.xRotO = f(m.xRotO - 360)
      while (f(xRot - m.xRotO) >= 180) m.xRotO = f(m.xRotO + 360)
      while (f(yRot - m.yRotO) < -180) m.yRotO = f(m.yRotO - 360)
      while (f(yRot - m.yRotO) >= 180) m.yRotO = f(m.yRotO + 360)
      m.xRot = setXRot(lerp(0.5, m.xRotO, xRot))
      m.yRot = lerp(0.5, m.yRotO, yRot)
    }
  },
  state(state, tracker, input) {
    const m = tracker.memory
    const pt = tracker.partialTick
    if (m.yRot === undefined) {
      state.yRot = gameYRot(input.bodyYaw)
      state.xRot = setXRot(gameXRot(input.pitch))
      return
    }
    // getYRot(partialTicks) / getXRot(partialTicks)
    state.yRot = pt === 1 ? m.yRot : rotLerp(pt, m.yRotO, m.yRot)
    state.xRot = pt === 1 ? m.xRot : lerp(pt, m.xRotO, m.xRot)
  }
}

// ---- wither ----

/** WitherBoss.rotlerp */
const witherRotlerp = (a: number, b: number, max: number) => {
  let diff = wrapDegrees(f(b - a))
  if (diff > max) diff = max
  if (diff < -max) diff = -max
  return f(a + diff)
}

type LookupEntity = (id: number) => { x: number; y: number; z: number; eyeY: number } | undefined

const wither: EntityDriver = {
  /**
   * WitherBoss.aiStep (on the client too): each side head turns toward its target's eyes (DATA_TARGET_B / C, an entity
   * id), at most 10 degrees of yaw and 40 of pitch a tick; with no target (or one the client doesn't have) its yaw follows
   * the body and its pitch stays.
   */
  tick(tracker, input) {
    const m = tracker.memory
    const xRots = (m.xHeadRots ??= [0, 0]) as number[]
    const yRots = (m.yHeadRots ??= [0, 0]) as number[]
    const { sin, cos } = sinCos(input.version)
    const yBodyRot = gameYRot(input.bodyYaw)
    const position = input.position ?? { x: 0, y: 0, z: 0 }
    const scale = 1 // the scale attribute (update_attributes), which EntityAnimInput doesn't carry: its default
    const lookup = (input as any).lookupEntity as LookupEntity | undefined
    const targets = [input.meta.target_b, input.meta.target_c]
    for (let i = 0; i < 2; i++) {
      const id = num(targets[i]) ?? 0
      const entity = id > 0 ? lookup?.(id) : undefined
      if (entity) {
        // getHeadX / getHeadY / getHeadZ of head i + 1
        const headAngle = f(f(yBodyRot + 180 * i) * f(0.017_453_292))
        const hx = position.x + cos(headAngle) * 1.3 * scale
        const hy = position.y + f(f(2.2) * scale)
        const hz = position.z + sin(headAngle) * 1.3 * scale
        const xd = entity.x - hx
        const yd = entity.eyeY - hy
        const zd = entity.z - hz
        const sd = Math.sqrt(xd * xd + zd * zd)
        const yRotD = f(f(mthAtan2(zd, xd) * 57.295_776_367_187_5) - 90)
        const xRotD = f(-(mthAtan2(yd, sd) * 57.295_776_367_187_5))
        xRots[i] = witherRotlerp(xRots[i]!, xRotD, 40)
        yRots[i] = witherRotlerp(yRots[i]!, yRotD, 10)
      } else {
        yRots[i] = witherRotlerp(yRots[i]!, yBodyRot, 10)
      }
    }
  },
  state(state, tracker, input) {
    const m = tracker.memory
    state.xHeadRots = [...((m.xHeadRots as number[] | undefined) ?? [0, 0])]
    state.yHeadRots = [...((m.yHeadRots as number[] | undefined) ?? [0, 0])]
    const invulnerableTicks = num(input.meta.inv) ?? 0
    state.invulnerableTicks = invulnerableTicks > 0 ? f(invulnerableTicks - tracker.partialTick) : 0
    // isPowered: health <= max health / 2
    const maxHealth = num((input as any).maxHealth) ?? 300
    const health = num(input.meta.health) ?? maxHealth
    state.isPowered = health <= f(maxHealth / 2)
  }
}

// ---- ender dragon ----

/** EnderDragonPhase ids */
const DRAGON_LANDING = 3
const DRAGON_TAKEOFF = 4
const DRAGON_HOVERING = 10
/** the sitting phases (AbstractDragonSittingPhase: sitting flaming, scanning, attacking; and DragonHoverPhase) */
const DRAGON_SITTING = new Set([5, 6, 7, DRAGON_HOVERING])

type DragonSample = { y: number; yRot: number }
type DragonHistory = { samples: DragonSample[]; head: number }

const newHistory = (): DragonHistory => ({ samples: Array.from({ length: 64 }, () => ({ y: 0, yRot: 0 })), head: -1 })

/** DragonFlightHistory.record */
const recordHistory = (history: DragonHistory, y: number, yRot: number) => {
  const sample = { y, yRot }
  if (history.head < 0) history.samples.fill(sample)
  if (++history.head === 64) history.head = 0
  history.samples[history.head] = sample
}

/** DATA_PHASE (the client's phase manager starts at HOVERING) */
const dragonPhase = (input: EntityAnimInput) => num(input.meta.phase) ?? DRAGON_HOVERING

const enderDragon: EntityDriver = {
  /** EnderDragon.aiStep on the client (and tickDeath's death time) */
  tick(tracker, input) {
    const m = tracker.memory
    trackPosition(tracker, input)
    m.flapTime ??= 0
    m.oFlapTime ??= 0
    m.dragonDeathTime ??= 0
    const history = (m.flightHistory ??= newHistory()) as DragonHistory
    const dead = isDeadOrDying(input)
    // LivingEntity.baseTick: tickDeath while dead or dying (before aiStep)
    if (dead) m.dragonDeathTime++
    m.oFlapTime = m.flapTime
    if (dead) return
    const movement = velocity(tracker, input)
    let flapSpeed = f(f(0.2) / f(f(f(Math.sqrt(movement.x * movement.x + movement.z * movement.z)) * 10) + 1))
    flapSpeed = f(flapSpeed * f(2 ** movement.y))
    // inWall is only set on the server: the client's stays false
    if (DRAGON_SITTING.has(dragonPhase(input))) m.flapTime = f(m.flapTime + f(0.1))
    else m.flapTime = f(m.flapTime + flapSpeed)
    const yRot = wrapDegrees(gameYRot(input.bodyYaw))
    if (isNoAi(input)) m.flapTime = 0.5
    else recordHistory(history, input.position?.y ?? 0, yRot)
  },
  state(state, tracker, input) {
    const m = tracker.memory
    const pt = tracker.partialTick
    const dead = isDeadOrDying(input)
    state.flapTime = lerp(pt, m.oFlapTime ?? 0, m.flapTime ?? 0)
    const deathTime = m.dragonDeathTime ?? 0
    state.deathTime = deathTime > 0 ? f(deathTime + pt) : 0
    const phase = dragonPhase(input)
    state.isLandingOrTakingOff = phase === DRAGON_LANDING || phase === DRAGON_TAKEOFF
    state.isSitting = DRAGON_SITTING.has(phase)
    // the egg: the heightmap at the podium (EnderDragonFight.getPodiumLocation of the client's fight origin, 0 0 0);
    // BlockPos.distToCenterSqr
    const podiumTopY = num((input as any).podiumTopY)
    const position = input.position
    state.distanceToEgg =
      podiumTopY !== undefined && position ? (0.5 - position.x) ** 2 + (podiumTopY + 0.5 - position.y) ** 2 + (0.5 - position.z) ** 2 : 0
    state.partialTicks = dead ? 0 : pt
    const history = m.flightHistory as DragonHistory | undefined
    state.flightHistory = history ? { samples: [...history.samples], head: history.head } : newHistory()
    // the healing beam from the nearest crystal: its position plus EndCrystalRenderer.getY(time + partialTicks)
    const crystal = (input as any).nearestCrystal as (Vec & { time?: number }) | undefined
    if (crystal && position) {
      const { sin } = sinCos(input.version)
      const time = f((crystal.time ?? 0) + pt)
      let hh = f(f(sin(f(time * f(0.2))) / 2) + 0.5)
      hh = f(f(f(hh * hh) + hh) * f(0.4))
      const crystalY = f(hh - f(1.4))
      state.beamOffset = { x: crystal.x - position.x, y: crystal.y + crystalY - position.y, z: crystal.z - position.z }
    } else {
      state.beamOffset = null
    }
  }
}

// ---- end crystal ----

const endCrystal: EntityDriver = {
  /** EndCrystal.tick: ++time (the game starts it at a client side random 0..99999; here at 0) */
  tick(tracker) {
    tracker.memory.time = (tracker.memory.time ?? 0) + 1
  },
  state(state, tracker, input) {
    state.ageInTicks = f((tracker.memory.time ?? 0) + tracker.partialTick)
    state.showsBottom = input.meta.show_bottom === undefined ? true : truthy(input.meta.show_bottom)
    // the beam target (OPTIONAL_BLOCK_POS): Vec3.atCenterOf(target) - the crystal's position
    const target = input.meta.beam_target as Vec | null | undefined
    const position = input.position
    state.beamOffset =
      target && typeof target === 'object' && typeof target.x === 'number' && position
        ? { x: target.x + 0.5 - position.x, y: target.y + 0.5 - position.y, z: target.z + 0.5 - position.z }
        : null
  }
}

/** Entities whose renderer adds nothing to LivingEntityRenderer's state (the common fields cover their models). */
const livingOnly: EntityDriver = {}

export const MONSTERS_DRIVERS: Record<string, EntityDriver> = {
  creeper,
  enderman,
  spider: livingOnly,
  cave_spider: livingOnly,
  slime: cubeMob(0.6),
  magma_cube: cubeMob(0.9),
  sulfur_cube: sulfurCube,
  blaze,
  ghast,
  happy_ghast: happyGhast,
  phantom,
  silverfish: livingOnly,
  endermite: livingOnly,
  shulker,
  shulker_bullet: shulkerBullet,
  wither,
  ender_dragon: enderDragon,
  end_crystal: endCrystal
}
