import { isBaby, type EntityAnimInput, type EntityAnimTracker, type EntityDriver } from '../entityAnimState'
import { PI, RAD_TO_DEG as RAD_TO_DEG_F, f, lerp, wrapDegrees } from '../setupAnim/mth'
import { animContext, type AnimContext } from '../setupAnim/types'
import { WalkAnimation } from '../setupAnim/walkAnimation'

/**
 * Fish, dolphins, squids, guardians, axolotls, frogs, tadpoles and nautiluses (26.3): the render state their renderers
 * extract and the client side ticking it reads (Squid.aiStep's tentacles and body angles, Guardian.aiStep's tail, spikes
 * and attack time, Axolotl.baseTick's animators and the baby's animation states, Frog's pose callbacks, swim idle and
 * walk animation).
 *
 * Inputs beyond EntityAnimInput, read when the scene has them:
 * - `isInWater` (boolean): Entity.isInWater(), a fluid lookup at the entity. Without it the entity is out of water, the
 *   field's default (Entity.wasTouchingWater starts false): fish flop, guardians flail, squids hang.
 * - `velocity` ({x, y, z}, blocks per tick): the client's deltaMovement (entity_velocity packets). Without it, the
 *   distance moved over the last tick.
 * - guardians: `attackTarget` ({position, eyeHeight, height}): the entity the attack_target id names (its position, eye
 *   height and bounding box height); `cameraEyePosition` ({x, y, z}): the camera entity's eye position, which the eye
 *   looks at without an attack target.
 * - `tracker.memory.random` (() => number): the client's random (Math.random when absent), for what the game rolls
 *   client side (a squid's tentacle speed, a guardian's first tail angle and its spikes out of water).
 */

type Vec3 = { x: number; y: number; z: number }

const RAD_TO_DEG = 180 / Math.PI
const MOVING_EPSILON = f(1e-5)

const contexts = new Map<string, AnimContext>()
/** The version's Mth.sin / Mth.cos and Ease. */
const ctx = (version: string) => {
  let context = contexts.get(version)
  if (!context) {
    context = animContext(version)
    contexts.set(version, context)
  }
  return context
}

/** Entity.isInWater(): a block lookup, read from the scene (out of water without it, see above). */
export const isInWater = (input: EntityAnimInput) => (input as { isInWater?: unknown }).isInWater === true

/** The client's random. */
const random = (tracker: EntityAnimTracker): number => ((tracker.memory.random as (() => number) | undefined) ?? Math.random)()

/** The game's yRot of the head and xRot, in degrees (as entityAnimState converts prismarine angles). */
const headRotation = (input: EntityAnimInput) => ({
  yRot: f(wrapDegrees(f(180 - input.headYaw * RAD_TO_DEG))),
  xRot: f(-input.pitch * RAD_TO_DEG)
})

/**
 * Per tick: the entity's deltaMovement (the velocity input, else the distance moved since the last tick: the first tick
 * of a frame sees the frame's move, as the walk animation does).
 */
const trackMotion = (tracker: EntityAnimTracker, input: EntityAnimInput) => {
  const memory = tracker.memory
  const given = (input as { velocity?: Vec3 }).velocity
  const position = input.position
  const last = memory.lastPosition as Vec3 | undefined
  if (given) memory.velocity = { x: given.x, y: given.y, z: given.z }
  else if (position && last) memory.velocity = { x: position.x - last.x, y: position.y - last.y, z: position.z - last.z }
  else memory.velocity = { x: 0, y: 0, z: 0 }
  if (position) memory.lastPosition = { x: position.x, y: position.y, z: position.z }
}

const velocityOf = (tracker: EntityAnimTracker): Vec3 => (tracker.memory.velocity as Vec3 | undefined) ?? { x: 0, y: 0, z: 0 }

/** LivingEntityRenderer: state.isInWater = entity.isInWater() (the framework has no fluid lookup). */
const waterState: NonNullable<EntityDriver['state']> = (state, _tracker, input) => {
  state.isInWater = isInWater(input)
}

// ---------------------------------------------------------------------------------------------------------------------
// Mth.atan2: the game's table based arc tangent (the squid's body pitch reads it).

const FRAC_BIAS = 17_592_186_044_416 // Double.longBitsToDouble(0x42B0000000000000L) = 2^44
const ASIN_TAB = new Float64Array(257)
const COS_TAB = new Float64Array(257)
const bits = new DataView(new ArrayBuffer(8))
/** COS_TAB entries where the JVM's Math.cos (an intrinsic) rounds differently from the JS engine's: the JVM's bits */
const JVM_COS_BITS: Record<number, bigint> = {
  61: 4_606_922_977_173_859_057n,
  70: 4_606_839_152_383_318_751n,
  125: 4_606_035_679_156_569_677n,
  127: 4_605_995_891_097_066_120n,
  141: 4_605_693_075_123_403_335n,
  170: 4_604_909_695_863_391_967n,
  175: 4_604_749_238_461_547_642n,
  181: 4_604_544_951_469_586_758n,
  182: 4_604_509_579_225_095_501n,
  186: 4_604_364_069_585_105_275n
}
for (let i = 0; i < 257; i++) {
  const asin = Math.asin(i / 256)
  COS_TAB[i] = Math.cos(asin)
  ASIN_TAB[i] = asin
  const jvm = JVM_COS_BITS[i]
  if (jvm !== undefined) {
    bits.setBigInt64(0, jvm)
    COS_TAB[i] = bits.getFloat64(0)
  }
}

const fastInvSqrt = (x: number) => {
  const xhalf = 0.5 * x
  bits.setFloat64(0, x)
  bits.setBigInt64(0, 6_910_469_410_427_058_090n - (bits.getBigInt64(0) >> 1n))
  x = bits.getFloat64(0)
  return x * (1.5 - xhalf * x * x)
}

/** Mth.atan2(double y, double x) */
export const mthAtan2 = (y: number, x: number) => {
  const d2 = x * x + y * y
  if (Number.isNaN(d2)) return Number.NaN
  const negY = y < 0
  if (negY) y = -y
  const negX = x < 0
  if (negX) x = -x
  const steep = y > x
  if (steep) [x, y] = [y, x]
  const rinv = fastInvSqrt(d2)
  x *= rinv
  y *= rinv
  const yp = FRAC_BIAS + y
  bits.setFloat64(0, yp)
  const index = bits.getInt32(4) // (int) Double.doubleToRawLongBits(yp): the low 32 bits
  const phi = ASIN_TAB[index]!
  const cPhi = COS_TAB[index]!
  const sPhi = yp - FRAC_BIAS
  const sd = y * cPhi - x * sPhi
  const d = (6 + sd * sd) * sd * 0.166_666_666_666_666_66
  let theta = phi + d
  if (steep) theta = 1.570_796_326_794_896_6 - theta
  if (negX) theta = Math.PI - theta
  if (negY) theta = -theta
  return theta
}

// ---------------------------------------------------------------------------------------------------------------------
// Fish

/** SalmonRenderer: the variant picks the small, medium or large model (Salmon.Variant by id, clamped). */
const SALMON_VARIANTS = ['SMALL', 'MEDIUM', 'LARGE']
const salmon: EntityDriver = {
  state(state, tracker, input) {
    waterState(state, tracker, input)
    const type = input.meta.type
    state.variant = typeof type === 'number' ? SALMON_VARIANTS[Math.max(0, Math.min(2, type))] : typeof type === 'string' ? type.toUpperCase() : 'MEDIUM'
  }
}

/** PufferfishRenderer: puffState (0 the small model, 1 the mid one, else the big one). */
const pufferfish: EntityDriver = {
  state(state, tracker, input) {
    waterState(state, tracker, input)
    state.puffState = typeof input.meta.puff_state === 'number' ? input.meta.puff_state : 0
  }
}

/** TropicalFish.Pattern by packed id (base | index << 8): BY_ID is sparse, KOB for unknown ids. */
const TROPICAL_PATTERNS: Record<number, [string, 'SMALL' | 'LARGE']> = {}
for (const [i, name] of ['KOB', 'SUNSTREAK', 'SNOOPER', 'DASHER', 'BRINELY', 'SPOTTY'].entries()) TROPICAL_PATTERNS[0 | (i << 8)] = [name, 'SMALL']
for (const [i, name] of ['FLOPPER', 'STRIPEY', 'GLITTER', 'BLOCKFISH', 'BETTY', 'CLAYFISH'].entries()) TROPICAL_PATTERNS[1 | (i << 8)] = [name, 'LARGE']

/** DyeColor.getTextureDiffuseColor (ARGB.opaque, a Java int) by id; DyeColor.byId is ByIdMap ZERO: white out of range. */
const DYE_DIFFUSE = [
  16_383_998, 16_351_261, 13_061_821, 3_847_130, 16_701_501, 8_439_583, 15_961_002, 4_673_362, 10_329_495, 1_481_884, 8_991_416, 3_949_738, 8_606_770, 6_192_150,
  11_546_150, 1_908_001
].map(color => color | 0xff_00_00_00)
const dyeColor = (id: number) => DYE_DIFFUSE[id] ?? DYE_DIFFUSE[0]!

/**
 * TropicalFishRenderer: pattern (its constant name), baseColor and patternColor (the dyes' texture diffuse colors), from
 * the packed type_variant; patternBase (pattern.base(): SMALL or LARGE) picks the model and texture.
 */
const tropicalFish: EntityDriver = {
  state(state, tracker, input) {
    waterState(state, tracker, input)
    const raw = input.meta.type_variant
    const packed = typeof raw === 'number' ? raw | 0 : 0
    const [pattern, base] = TROPICAL_PATTERNS[packed & 0xff_ff] ?? TROPICAL_PATTERNS[0]!
    state.pattern = pattern
    state.patternBase = base
    state.baseColor = dyeColor((packed >> 16) & 255)
    state.patternColor = dyeColor((packed >> 24) & 255)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Dolphin

/** DolphinRenderer: isMoving (deltaMovement.horizontalDistanceSqr() > 1.0E-7), heldItem (the main hand item). */
const dolphin: EntityDriver = {
  tick: trackMotion,
  state(state, tracker, input) {
    waterState(state, tracker, input)
    const velocity = velocityOf(tracker)
    state.isMoving = velocity.x * velocity.x + velocity.z * velocity.z > 1e-7
    state.heldItem = input.equipment?.mainhand
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Squid, glow squid

type SquidMemory = {
  xBodyRot: number
  xBodyRotO: number
  zBodyRot: number
  zBodyRotO: number
  tentacleMovement: number
  oldTentacleMovement: number
  tentacleAngle: number
  oldTentacleAngle: number
  tentacleSpeed: number
  rotateSpeed: number
}

const squidMemory = (tracker: EntityAnimTracker): SquidMemory => {
  // the constructor: tentacleSpeed = 1.0F / (random.nextFloat() + 1.0F) * 0.2F
  tracker.memory.squid ??= {
    xBodyRot: 0,
    xBodyRotO: 0,
    zBodyRot: 0,
    zBodyRotO: 0,
    tentacleMovement: 0,
    oldTentacleMovement: 0,
    tentacleAngle: 0,
    oldTentacleAngle: 0,
    tentacleSpeed: f(f(1 / f(f(random(tracker)) + 1)) * f(0.2)),
    rotateSpeed: 0
  } satisfies SquidMemory
  return tracker.memory.squid as SquidMemory
}

const TWO_PI_F = f(Math.PI * 2) // 6.2831855F

/**
 * Squid.aiStep, client side: the tentacles' movement advances by the tentacle speed up to a full turn (2 PI, held there
 * on the client until the server's entity event 19 restarts it); in water the tentacles beat over the first half turn and
 * the body spins (zBodyRot) and pitches toward the movement (xBodyRot); out of water they flap and the body tips to -90.
 */
const squid: EntityDriver = {
  tick(tracker, input) {
    trackMotion(tracker, input)
    const s = squidMemory(tracker)
    const { sin } = ctx(input.version)
    s.xBodyRotO = s.xBodyRot
    s.zBodyRotO = s.zBodyRot
    s.oldTentacleMovement = s.tentacleMovement
    s.oldTentacleAngle = s.tentacleAngle
    s.tentacleMovement = f(s.tentacleMovement + s.tentacleSpeed)
    if (s.tentacleMovement > 6.283_185_307_179_586) s.tentacleMovement = TWO_PI_F
    if (isInWater(input)) {
      if (s.tentacleMovement < PI) {
        const tentacleScale = f(s.tentacleMovement / PI)
        s.tentacleAngle = f(f(sin(f(f(tentacleScale * tentacleScale) * PI)) * PI) * f(0.25))
        if (tentacleScale > 0.75) s.rotateSpeed = 1
        else s.rotateSpeed = f(s.rotateSpeed * f(0.8))
      } else {
        s.tentacleAngle = 0
        s.rotateSpeed = f(s.rotateSpeed * f(0.99))
      }
      const movement = velocityOf(tracker)
      const horizontalMovement = Math.sqrt(movement.x * movement.x + movement.z * movement.z)
      // (yBodyRot and yRot turn toward the movement here too: the body yaw is the entity's rotation input)
      s.zBodyRot = f(s.zBodyRot + f(f(PI * s.rotateSpeed) * f(1.5)))
      s.xBodyRot = f(s.xBodyRot + f(f(f(-f(mthAtan2(horizontalMovement, movement.y)) * RAD_TO_DEG_F) - s.xBodyRot) * f(0.1)))
    } else {
      s.tentacleAngle = f(f(Math.abs(sin(s.tentacleMovement)) * PI) * f(0.25))
      s.xBodyRot = f(s.xBodyRot + f(f(-90 - s.xBodyRot) * f(0.02)))
    }
  },
  event(tracker, id) {
    if (id === 19) squidMemory(tracker).tentacleMovement = 0
  },
  /** SquidRenderer: tentacleAngle, xBodyRot and zBodyRot (degrees: the renderer's setupRotations turns the body by them). */
  state(state, tracker, input) {
    waterState(state, tracker, input)
    const s = squidMemory(tracker)
    const pt = tracker.partialTick
    state.tentacleAngle = lerp(pt, s.oldTentacleAngle, s.tentacleAngle)
    state.xBodyRot = lerp(pt, s.xBodyRotO, s.xBodyRot)
    state.zBodyRot = lerp(pt, s.zBodyRotO, s.zBodyRot)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Guardian, elder guardian

type GuardianMemory = {
  tail: number
  tailO: number
  tailSpeed: number
  spikes: number
  spikesO: number
  attackTime: number
  attackTarget: number
}

const guardianMemory = (tracker: EntityAnimTracker): GuardianMemory => {
  // the constructor: clientSideTailAnimation = random.nextFloat(), the old value the same
  if (!tracker.memory.guardian) {
    const tail = f(random(tracker))
    tracker.memory.guardian = { tail, tailO: tail, tailSpeed: 0, spikes: 0, spikesO: 0, attackTime: 0, attackTarget: 0 } satisfies GuardianMemory
  }
  return tracker.memory.guardian as GuardianMemory
}

const attackTargetId = (input: EntityAnimInput) => (typeof input.meta.attack_target === 'number' ? input.meta.attack_target : 0)

type GuardianTarget = { position: Vec3; eyeHeight: number; height: number }

/**
 * Guardian.aiStep, client side (while alive): the tail speeds up when moving in water and flails out of it, the spikes
 * draw in while moving, stick out while still and jitter out of water; the attack time counts the ticks the attack
 * target has been set (80 at most), from 0 again whenever the attack_target data changes (onSyncedDataUpdated).
 */
const guardianDriver = (eyeHeight: number): EntityDriver => ({
  tick(tracker, input) {
    const g = guardianMemory(tracker)
    const target = attackTargetId(input)
    if (target !== g.attackTarget) {
      g.attackTarget = target
      g.attackTime = 0
    }
    if (typeof input.meta.health === 'number' && input.meta.health <= 0) return
    const inWater = isInWater(input)
    const moving = input.meta.moving === true
    g.tailO = g.tail
    if (!inWater) {
      g.tailSpeed = 2
    } else if (moving) {
      if (g.tailSpeed < 0.5) g.tailSpeed = 4
      else g.tailSpeed = f(g.tailSpeed + f(f(0.5 - g.tailSpeed) * f(0.1)))
    } else {
      g.tailSpeed = f(g.tailSpeed + f(f(0.125 - g.tailSpeed) * f(0.2)))
    }
    g.tail = f(g.tail + g.tailSpeed)
    g.spikesO = g.spikes
    if (!inWater) g.spikes = f(random(tracker))
    else if (moving) g.spikes = f(g.spikes + f(f(0 - g.spikes) * 0.25))
    else g.spikes = f(g.spikes + f(f(1 - g.spikes) * f(0.06)))
    if (target !== 0 && g.attackTime < 80) g.attackTime++
  },
  /**
   * GuardianRenderer: spikesAnimation, tailAnimation, eyePosition; lookDirection (the view vector of the head's rotation)
   * and lookAtPosition (the eye position of the attack target, else of the camera entity), null without one; the beam's
   * attackScale, attackTime and attackTargetPosition (the target's middle) while the attack target is known.
   */
  state(state, tracker, input) {
    waterState(state, tracker, input)
    const g = guardianMemory(tracker)
    const pt = tracker.partialTick
    state.spikesAnimation = lerp(pt, g.spikesO, g.spikes)
    state.tailAnimation = lerp(pt, g.tailO, g.tail)
    const position = input.position ?? { x: 0, y: 0, z: 0 }
    state.eyePosition = { x: position.x, y: position.y + eyeHeight, z: position.z }
    const hasTarget = attackTargetId(input) !== 0
    const target = hasTarget ? (input as { attackTarget?: GuardianTarget }).attackTarget : undefined
    // getEntityToLookAt: the attack target while one is set (none when the client doesn't know it), else the camera
    const lookAt = hasTarget
      ? target && { x: target.position.x, y: target.position.y + target.eyeHeight, z: target.position.z }
      : (input as { cameraEyePosition?: Vec3 }).cameraEyePosition
    if (lookAt) {
      // Entity.calculateViewVector(xRot, yHeadRot)
      const { sin, cos } = ctx(input.version)
      const { yRot, xRot } = headRotation(input)
      const realXRot = f(xRot * f(0.017_453_292))
      const realYRot = f(-yRot * f(0.017_453_292))
      const yCos = cos(realYRot)
      const ySin = sin(realYRot)
      const xCos = cos(realXRot)
      const xSin = sin(realXRot)
      state.lookDirection = { x: f(ySin * xCos), y: -xSin, z: f(yCos * xCos) }
      state.lookAtPosition = { x: lookAt.x, y: lookAt.y, z: lookAt.z }
    } else {
      state.lookDirection = null
      state.lookAtPosition = null
    }
    if (target) {
      state.attackScale = f(f(g.attackTime + pt) / 80)
      state.attackTime = f(g.attackTime + pt)
      state.attackTargetPosition = { x: target.position.x, y: target.position.y + target.height * 0.5, z: target.position.z }
    } else {
      state.attackScale = 0
      state.attackTime = 0
      state.attackTargetPosition = null
    }
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// Axolotl

type Binary = { ticks: number; ticksOld: number }

/** BinaryAnimator(10, IN_OUT_SINE).tick */
const binaryTick = (animator: Binary, active: boolean) => {
  animator.ticksOld = animator.ticks
  if (active) {
    if (animator.ticks < 10) animator.ticks++
  } else if (animator.ticks > 0) {
    animator.ticks--
  }
}

/** BinaryAnimator.getFactor */
const binaryFactor = (animator: Binary, partialTicks: number, context: AnimContext) => context.ease.inOutSine(f(lerp(partialTicks, animator.ticksOld, animator.ticks) / 10))

type AxolotlMemory = {
  playingDead: Binary
  inWater: Binary
  onGround: Binary
  moving: Binary
  /** the walk speed as the last tick left it (baseTick runs before the tick's walk update) */
  walkSpeed: number
  yRot?: number
  xRot?: number
}

const axolotlMemory = (tracker: EntityAnimTracker): AxolotlMemory => {
  const binary = () => ({ ticks: 0, ticksOld: 0 })
  tracker.memory.axolotl ??= { playingDead: binary(), inWater: binary(), onGround: binary(), moving: binary(), walkSpeed: 0 } satisfies AxolotlMemory
  return tracker.memory.axolotl as AxolotlMemory
}

/** Axolotl's animation states (ALL_ANIMATIONS) by render state field. */
const AXOLOTL_ANIMATIONS = [
  'swimAnimation',
  'walkAnimationState',
  'walkUnderWaterAnimationState',
  'idleUnderWaterAnimationState',
  'idleUnderWaterOnGroundAnimationState',
  'idleOnGroundAnimationState',
  'playDeadAnimationState'
]

const AXOLOTL_VARIANTS = ['LUCY', 'WILD', 'GOLD', 'CYAN', 'BLUE']

/**
 * Axolotl.baseTick, client side: moving is the walk animation moving or the rotation changing this tick. A baby plays one
 * of its seven animation states (soloAnimation: start that one if stopped, stop the others): play dead; moving: swim (in
 * water, off the ground), walk (on the ground out of water), walk under water (otherwise); still: idle under water (off
 * the ground), idle on the ground under water, idle on the ground. An adult eases its four 10 tick animators instead.
 */
const axolotl: EntityDriver = {
  tick(tracker, input) {
    const a = axolotlMemory(tracker)
    const playingDead = input.meta.playing_dead === true
    const inWater = isInWater(input)
    const onGround = !!input.onGround
    const rotated = a.yRot !== undefined && (input.bodyYaw !== a.yRot || input.pitch !== a.xRot)
    const isMoving = a.walkSpeed > MOVING_EPSILON || rotated
    if (isBaby(input)) {
      binaryTick(a.moving, isMoving)
      let solo: string
      if (playingDead) solo = 'playDeadAnimationState'
      else if (isMoving) solo = inWater && !onGround ? 'swimAnimation' : !inWater && onGround ? 'walkAnimationState' : 'walkUnderWaterAnimationState'
      else solo = inWater && !onGround ? 'idleUnderWaterAnimationState' : inWater && onGround ? 'idleUnderWaterOnGroundAnimationState' : 'idleOnGroundAnimationState'
      for (const field of AXOLOTL_ANIMATIONS) {
        if (field === solo) tracker.startIfStopped(field)
        else tracker.stop(field)
      }
    } else {
      const animationState = playingDead ? 'PLAYING_DEAD' : inWater ? 'IN_WATER' : onGround ? 'ON_GROUND' : 'IN_AIR'
      binaryTick(a.playingDead, animationState === 'PLAYING_DEAD')
      binaryTick(a.inWater, animationState === 'IN_WATER')
      binaryTick(a.onGround, animationState === 'ON_GROUND')
      binaryTick(a.moving, isMoving)
    }
    a.yRot = input.bodyYaw
    a.xRot = input.pitch
    // this tick's walk update (LivingEntity.aiStep, after baseTick), which the next baseTick reads
    a.walkSpeed = tracker.walk.walk.speed
  },
  /** AxolotlRenderer: variant, the four factors, and the seven animation states (the framework copies them). */
  state(state, tracker, input) {
    waterState(state, tracker, input)
    const a = axolotlMemory(tracker)
    const pt = tracker.partialTick
    const context = ctx(input.version)
    const variant = input.meta.variant
    state.variant = typeof variant === 'number' ? (AXOLOTL_VARIANTS[variant] ?? 'LUCY') : typeof variant === 'string' ? variant.toUpperCase() : 'LUCY'
    state.playingDeadFactor = binaryFactor(a.playingDead, pt, context)
    state.inWaterFactor = binaryFactor(a.inWater, pt, context)
    state.onGroundFactor = binaryFactor(a.onGround, pt, context)
    state.movingFactor = binaryFactor(a.moving, pt, context)
    for (const field of AXOLOTL_ANIMATIONS) state[field] ??= null
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Frog

type FrogMemory = { pose: string; walk: WalkAnimation; lastPosition?: Vec3 }

const frogMemory = (tracker: EntityAnimTracker): FrogMemory => {
  tracker.memory.frog ??= { pose: 'STANDING', walk: new WalkAnimation() } satisfies FrogMemory
  return tracker.memory.frog as FrogMemory
}

/** Frog.onSyncedDataUpdated(DATA_POSE): the pose's animation starts, the others stop. */
const FROG_POSE_ANIMATIONS: Array<[string, string]> = [
  ['LONG_JUMPING', 'jumpAnimationState'],
  ['CROAKING', 'croakAnimationState'],
  ['USING_TONGUE', 'tongueAnimationState']
]

/**
 * Frog: the pose callback starts jump / croak / tongue (when the pose data arrives, before the tick that sees it: at the
 * previous tick's count); Frog.tick plays the swim idle while in water and the walk animation isn't moving (before the
 * tick's walk update); Frog.updateWalkAnimation: the walk's target speed is the distance times 25 (not 4), 0 while the
 * jump animation plays.
 */
const frog: EntityDriver = {
  tick(tracker, input) {
    const m = frogMemory(tracker)
    const pose = input.pose ?? 'STANDING'
    if (pose !== m.pose) {
      m.pose = pose
      for (const [animationPose, field] of FROG_POSE_ANIMATIONS) tracker.animationStates[field] = pose === animationPose ? tracker.tickCount - 1 : null
    }
    tracker.animateWhen('swimIdleAnimationState', isInWater(input) && !(m.walk.speed > MOVING_EPSILON))
    // LivingEntity.aiStep: calculateEntityAnimation(false), the horizontal distance moved this tick
    const position = input.position
    const last = m.lastPosition ?? position
    const distance = position && last ? f(Math.sqrt((position.x - last.x) ** 2 + (position.z - last.z) ** 2)) : 0
    if (position) m.lastPosition = { x: position.x, y: position.y, z: position.z }
    if (input.isPassenger) {
      m.walk.stop()
    } else {
      const targetSpeed = tracker.started('jumpAnimationState') ? 0 : Math.min(f(distance * 25), 1)
      m.walk.update(targetSpeed, f(0.4), isBaby(input) ? 3 : 1)
    }
  },
  /** FrogRenderer: isSwimming (isInWater), the four animation states (the framework copies them), the frog's own walk. */
  state(state, tracker, input) {
    waterState(state, tracker, input)
    const m = frogMemory(tracker)
    const pt = tracker.partialTick
    state.isSwimming = isInWater(input)
    state.walkAnimationPos = m.walk.positionAt(pt)
    state.walkAnimationSpeed = m.walk.speedAt(pt)
    state.wornHeadAnimationPos = state.walkAnimationPos
    for (const [, field] of FROG_POSE_ANIMATIONS) state[field] ??= null
    state.swimIdleAnimationState ??= null
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Nautilus

/** NautilusRenderer: saddle and bodyArmorItem (the saddle and body slots). */
const nautilusState: NonNullable<EntityDriver['state']> = (state, tracker, input) => {
  waterState(state, tracker, input)
  state.saddle = input.equipment?.saddle
  state.bodyArmorItem = input.equipment?.body
}

/** ZombieNautilusRenderer: also its variant (the zombie_nautilus_variant holder as the synched data has it). */
const zombieNautilus: EntityDriver = {
  state(state, tracker, input) {
    nautilusState(state, tracker, input)
    state.variant = input.meta.variant ?? null
  }
}

export const AQUATIC_DRIVERS: Record<string, EntityDriver> = {
  cod: { state: waterState },
  salmon,
  pufferfish,
  tropical_fish: tropicalFish,
  dolphin,
  squid,
  glow_squid: squid,
  guardian: guardianDriver(f(0.425)),
  elder_guardian: guardianDriver(f(0.998_75)),
  axolotl,
  frog,
  tadpole: { state: waterState },
  nautilus: { state: nautilusState },
  zombie_nautilus: zombieNautilus
}
