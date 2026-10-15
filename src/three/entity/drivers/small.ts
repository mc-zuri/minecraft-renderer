import type { EntityAnimInput, EntityAnimTracker, EntityDriver } from '../entityAnimState'
import { PI, clamp, doubleSinCos, f, floatSinCos, lerp } from '../setupAnim/mth'
import { versionNumber, type AnimState } from '../setupAnim/types'

/**
 * Small animals and flyers (26.3): wolf, cat, ocelot, fox, rabbit, chicken, parrot, bat, bee, allay, vex. Each driver is
 * the entity's client side ticking (Wolf.tick's head tilt and shake, Cat's lie down amounts, Fox's crouch, Rabbit's jump
 * and animation states, Chicken / Parrot flapping, Bee roll, Allay holding / dancing...) and its renderer's
 * extractRenderState, from what the client knows of the entity.
 */

// ---- synched data helpers ----

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : undefined)

const truthy = (value: unknown) => value === true || value === 1

/** A flag of a synched byte (TamableAnimal / Fox / Bee / Bat / Vex DATA_FLAGS_ID are all minecraft-data's `flags`). */
const flag = (input: EntityAnimInput, mask: number) => {
  const value = num(input.meta.flags)
  return value !== undefined && (value & mask) !== 0
}

const sharedFlag = (input: EntityAnimInput, mask: number) => {
  const value = num(input.meta.shared_flags ?? input.meta.entity_flags)
  return value !== undefined && (value & mask) !== 0
}

const mobFlag = (input: EntityAnimInput, mask: number) => {
  const value = num(input.meta.mob_flags ?? input.meta.insentient)
  return value !== undefined && (value & mask) !== 0
}

/** A synched long as prismarine may decode it: a number, a bigint, or [high, low] 32 bit halves. */
const long = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return value[0] * 2 ** 32 + (value[1] >>> 0)
  return undefined
}

/**
 * NeutralMob.isAngry: the synched anger end time (26.3, `anger_end_time`) is still ahead of the level's game time. The
 * game time is the time packet's, which the scene can pass as `gameTime`; without it an end time that is set (the server
 * puts it back to -1 when the mob stops being angry) counts as angry. Before 1.21.11 the synched value was the remaining
 * anger time in ticks (`remaining_anger_time`), angry while above 0.
 */
const isAngryNeutral = (input: EntityAnimInput) => {
  const endTime = long(input.meta.anger_end_time)
  if (endTime !== undefined) {
    if (endTime <= 0) return false
    const gameTime = long((input as any).gameTime)
    return gameTime === undefined ? true : endTime - gameTime > 0
  }
  const remaining = num(input.meta.remaining_anger_time)
  return remaining !== undefined && remaining > 0
}

/** TamableAnimal.isInSittingPose (flags & 1) and isTame (flags & 4). */
const isInSittingPose = (input: EntityAnimInput) => flag(input, 1)
const isTame = (input: EntityAnimInput) => flag(input, 4)

const isEmptyItem = (item: string | undefined) => !item || item === 'air' || item === 'minecraft:air'

const isAlive = (input: EntityAnimInput) => {
  const health = num(input.meta.health)
  return health === undefined || health > 0
}

/** Mth.sin of the version: the 65536 entry table of doubles since 1.21.11, of floats before. */
const sinOf = (version: string) => (versionNumber(version) >= versionNumber('1.21.11') ? doubleSinCos.sin : floatSinCos.sin)

/** Optional input: is the entity in water or rain (Entity.isInWaterOrRain, a block / weather lookup). */
const isInWaterOrRain = (input: EntityAnimInput) => !!((input as any).isInWaterOrRain ?? (input as any).isInWater)

/** onGround as the movement packets give it (mineflayer starts an entity on the ground). */
const onGroundOf = (input: EntityAnimInput) => input.onGround !== false

/** Hand items as ArmedEntityRenderState gives them by arm (the framework's, with air as an empty hand). */
const armedItems = (state: AnimState, input: EntityAnimInput) => {
  const main = isEmptyItem(input.equipment?.mainhand) ? undefined : input.equipment?.mainhand
  const off = isEmptyItem(input.equipment?.offhand) ? undefined : input.equipment?.offhand
  state.mainHandItem = main
  state.offHandItem = off
  state.rightHandItem = state.mainArm === 'LEFT' ? off : main
  state.leftHandItem = state.mainArm === 'LEFT' ? main : off
}

// ---- wolf ----

type WolfMemory = { interestedAngle: number; interestedAngleO: number; isWet: boolean; isShaking: boolean; shakeAnim: number; shakeAnimO: number }

const wolfMemory = (tracker: EntityAnimTracker): WolfMemory =>
  (tracker.memory.wolf ??= { interestedAngle: 0, interestedAngleO: 0, isWet: false, isShaking: false, shakeAnim: 0, shakeAnimO: 0 })

/** Wolf: head tilt while interested, the shake off water (entity event 8 starts it, 56 cancels it), tail from health. */
const wolf: EntityDriver = {
  tick(tracker, input) {
    const m = wolfMemory(tracker)
    if (!isAlive(input)) return
    m.interestedAngleO = m.interestedAngle
    if (truthy(input.meta.interested)) m.interestedAngle = f(m.interestedAngle + f(f(1 - m.interestedAngle) * f(0.4)))
    else m.interestedAngle = f(m.interestedAngle + f(f(0 - m.interestedAngle) * f(0.4)))
    if (isInWaterOrRain(input)) {
      // the client only gets wet: the server cancels the shake (event 56)
      m.isWet = true
    } else if ((m.isWet || m.isShaking) && m.isShaking) {
      m.shakeAnimO = m.shakeAnim
      m.shakeAnim = f(m.shakeAnim + f(0.05))
      if (m.shakeAnimO >= 2) {
        m.isWet = false
        m.isShaking = false
        m.shakeAnimO = 0
        m.shakeAnim = 0
      }
    }
  },
  event(tracker, id) {
    const m = wolfMemory(tracker)
    if (id === 8) {
      m.isShaking = true
      m.shakeAnim = 0
      m.shakeAnimO = 0
    } else if (id === 56) {
      m.isShaking = false
      m.shakeAnim = 0
      m.shakeAnimO = 0
    }
  },
  state(state, tracker, input) {
    const m = wolfMemory(tracker)
    const pt = tracker.partialTick
    const angry = isAngryNeutral(input)
    state.isAngry = angry
    state.isSitting = isInSittingPose(input)
    // Wolf.getTailAngle
    if (angry) {
      state.tailAngle = f(1.539_380_4)
    } else if (isTame(input)) {
      // max health is an attribute (update_attributes), not synched data: a tame wolf's base is 40 since 1.20.5, 20 before
      const maxHealth = f(num((input as any).maxHealth) ?? (versionNumber(input.version) >= versionNumber('1.20.5') ? 40 : 20))
      const health = f(num(input.meta.health) ?? maxHealth)
      const damageRatio = f(f(maxHealth - health) / maxHealth)
      state.tailAngle = f(f(f(0.55) - f(damageRatio * f(0.4))) * PI)
    } else {
      state.tailAngle = f(0.628_318_55)
    }
    state.headRollAngle = f(f(lerp(pt, m.interestedAngleO, m.interestedAngle) * f(0.15)) * PI)
    state.shakeAnim = lerp(pt, m.shakeAnimO, m.shakeAnim)
    state.wetShade = m.isWet ? Math.min(f(f(0.75) + f(f(lerp(pt, m.shakeAnimO, m.shakeAnim) / 2) * f(0.25))), 1) : 1
  }
}

// ---- cat, ocelot ----

type CatMemory = { lieDownAmount: number; lieDownAmountO: number; lieDownAmountTail: number; lieDownAmountOTail: number; relaxStateOneAmount: number; relaxStateOneAmountO: number }

const catMemory = (tracker: EntityAnimTracker): CatMemory =>
  (tracker.memory.cat ??= { lieDownAmount: 0, lieDownAmountO: 0, lieDownAmountTail: 0, lieDownAmountOTail: 0, relaxStateOneAmount: 0, relaxStateOneAmountO: 0 })

/** FelineRenderState as the ocelot's renderer fills it: crouching (pose) and sprinting (shared flag 3); it never sits. */
const felineState = (state: AnimState, input: EntityAnimInput) => {
  state.isCrouching = input.pose === 'CROUCHING'
  state.isSprinting = sharedFlag(input, 0x08)
  state.isSitting = false
  state.lieDownAmount = 0
  state.lieDownAmountTail = 0
  state.relaxStateOneAmount = 0
}

/** Cat: Cat.handleLieDown's lie down and relax amounts, sitting from the tamable flags. */
const cat: EntityDriver = {
  tick(tracker, input) {
    const m = catMemory(tracker)
    m.lieDownAmountO = m.lieDownAmount
    m.lieDownAmountOTail = m.lieDownAmountTail
    if (truthy(input.meta.is_lying)) {
      m.lieDownAmount = Math.min(1, f(m.lieDownAmount + f(0.15)))
      m.lieDownAmountTail = Math.min(1, f(m.lieDownAmountTail + f(0.08)))
    } else {
      m.lieDownAmount = Math.max(0, f(m.lieDownAmount - f(0.22)))
      m.lieDownAmountTail = Math.max(0, f(m.lieDownAmountTail - f(0.13)))
    }
    m.relaxStateOneAmountO = m.relaxStateOneAmount
    if (truthy(input.meta.relax_state_one)) m.relaxStateOneAmount = Math.min(1, f(m.relaxStateOneAmount + f(0.1)))
    else m.relaxStateOneAmount = Math.max(0, f(m.relaxStateOneAmount - f(0.13)))
  },
  state(state, tracker, input) {
    const m = catMemory(tracker)
    const pt = tracker.partialTick
    felineState(state, input)
    state.isSitting = isInSittingPose(input)
    state.lieDownAmount = lerp(pt, m.lieDownAmountO, m.lieDownAmount)
    state.lieDownAmountTail = lerp(pt, m.lieDownAmountOTail, m.lieDownAmountTail)
    state.relaxStateOneAmount = lerp(pt, m.relaxStateOneAmountO, m.relaxStateOneAmount)
    // a sleeping player within 2 blocks of the cat's block: an entity lookup the scene can pass as `sleepingPlayerNearby`
    state.isLyingOnTopOfSleepingPlayer = truthy(input.meta.is_lying) && (input as any).sleepingPlayerNearby === true
  }
}

const ocelot: EntityDriver = {
  state(state, _tracker, input) {
    felineState(state, input)
  }
}

// ---- fox ----

type FoxMemory = { interestedAngle: number; interestedAngleO: number; crouchAmount: number; crouchAmountO: number }

const foxMemory = (tracker: EntityAnimTracker): FoxMemory => (tracker.memory.fox ??= { interestedAngle: 0, interestedAngleO: 0, crouchAmount: 0, crouchAmountO: 0 })

/**
 * Fox flags: 1 sitting, 4 crouching, 8 interested, 16 pouncing, 32 sleeping, 64 faceplanted (Fox overrides isCrouching
 * and isSleeping with them). The faceplanted leg motion is the model's own counter (FoxModel.legMotionPos).
 */
const fox: EntityDriver = {
  tick(tracker, input) {
    const m = foxMemory(tracker)
    m.interestedAngleO = m.interestedAngle
    if (flag(input, 8)) m.interestedAngle = f(m.interestedAngle + f(f(1 - m.interestedAngle) * f(0.4)))
    else m.interestedAngle = f(m.interestedAngle + f(f(0 - m.interestedAngle) * f(0.4)))
    m.crouchAmountO = m.crouchAmount
    if (flag(input, 4)) {
      m.crouchAmount = f(m.crouchAmount + f(0.2))
      if (m.crouchAmount > 5) m.crouchAmount = 5
    } else {
      m.crouchAmount = 0
    }
  },
  state(state, tracker, input) {
    const m = foxMemory(tracker)
    const pt = tracker.partialTick
    state.headRollAngle = f(f(lerp(pt, m.interestedAngleO, m.interestedAngle) * f(0.11)) * PI)
    state.isCrouching = flag(input, 4)
    state.crouchAmount = lerp(pt, m.crouchAmountO, m.crouchAmount)
    state.isSleeping = flag(input, 32)
    state.isSitting = flag(input, 1)
    state.isFaceplanted = flag(input, 64)
    state.isPouncing = flag(input, 16)
  }
}

// ---- rabbit ----

type RabbitMemory = { jumpTicks: number; jumpDuration: number; idleAnimationTimeout: number; leashed: boolean }

/** random.nextInt(40) + 180: a random the client draws itself (Rabbit's constructor and each idle head tilt). */
const idleTimeout = () => Math.floor(Math.random() * 40) + 180

const rabbitMemory = (tracker: EntityAnimTracker): RabbitMemory =>
  (tracker.memory.rabbit ??= { jumpTicks: 0, jumpDuration: 0, idleAnimationTimeout: idleTimeout(), leashed: false })

/**
 * Rabbit: entity event 1 (jumpFromGround on the server) starts a 15 tick jump; baseTick's setupAnimationStates (client
 * side, before aiStep advances the jump) runs the hop while the jump is under way and the idle head tilt when its random
 * timeout runs out (not while leashed or without AI). The leash is the attach packet's, which the scene can pass as
 * `leashed`.
 */
const rabbit: EntityDriver = {
  tick(tracker, input) {
    const m = rabbitMemory(tracker)
    // setLeashData (on attaching or detaching a leash) stops the head tilt
    const leashed = !!(input as any).leashed
    if (leashed !== m.leashed) tracker.stop('idleHeadTiltAnimationState')
    m.leashed = leashed
    // baseTick: setupAnimationStates
    if (m.idleAnimationTimeout <= 0 && !leashed && !mobFlag(input, 1)) {
      m.idleAnimationTimeout = idleTimeout()
      tracker.start('idleHeadTiltAnimationState')
    } else if (m.jumpTicks > 0) {
      tracker.startIfStopped('hopAnimationState')
      tracker.stop('idleHeadTiltAnimationState')
    } else {
      m.idleAnimationTimeout--
      tracker.stop('hopAnimationState')
    }
    // aiStep
    if (m.jumpTicks !== m.jumpDuration) {
      m.jumpTicks++
    } else if (m.jumpDuration !== 0) {
      m.jumpTicks = 0
      m.jumpDuration = 0
    }
  },
  event(tracker, id) {
    if (id !== 1) return
    const m = rabbitMemory(tracker)
    m.jumpDuration = 15
    m.jumpTicks = 0
  },
  state(state, tracker, input) {
    const m = rabbitMemory(tracker)
    state.jumpCompletion = m.jumpDuration === 0 ? 0 : f(f(m.jumpTicks + tracker.partialTick) / m.jumpDuration)
    state.isToast = input.customName === 'Toast'
    state.hopAnimationState = tracker.animationStates.hopAnimationState ?? null
    state.idleHeadTiltAnimationState = tracker.animationStates.idleHeadTiltAnimationState ?? null
  }
}

// ---- chicken, parrot ----

type FlapMemory = { flap: number; flapSpeed: number; oFlapSpeed: number; oFlap: number; flapping: number }

const flapMemory = (tracker: EntityAnimTracker): FlapMemory => (tracker.memory.flap ??= { flap: 0, flapSpeed: 0, oFlapSpeed: 0, oFlap: 0, flapping: 1 })

/** Chicken.aiStep / Parrot.calculateFlapping: the wings speed up off the ground (and, for a parrot, not riding). */
const tickFlap = (m: FlapMemory, flying: boolean, onGround: boolean) => {
  m.oFlap = m.flap
  m.oFlapSpeed = m.flapSpeed
  m.flapSpeed = f(m.flapSpeed + f((flying ? 4 : -1) * f(0.3)))
  m.flapSpeed = clamp(m.flapSpeed, 0, 1)
  if (!onGround && m.flapping < 1) m.flapping = 1
  m.flapping = f(m.flapping * f(0.9))
  m.flap = f(m.flap + f(m.flapping * 2))
}

const chicken: EntityDriver = {
  tick(tracker, input) {
    const onGround = onGroundOf(input)
    tickFlap(flapMemory(tracker), !onGround, onGround)
  },
  state(state, tracker) {
    const m = flapMemory(tracker)
    const pt = tracker.partialTick
    state.flap = lerp(pt, m.oFlap, m.flap)
    state.flapSpeed = lerp(pt, m.oFlapSpeed, m.flapSpeed)
  }
}

type Jukebox = { x: number; y: number; z: number }

/**
 * The parrot's party: the client's LevelEventHandler calls setRecordPlayingNearby on the living entities around a jukebox
 * that starts (level event 1010) or stops (1011) playing, and Parrot.aiStep forgets the jukebox once the parrot is no
 * longer within 3.46 of its center (or the block is no longer a jukebox). None of that is in EntityAnimInput: the scene
 * can pass the playing jukebox the parrot was told about as `recordPlayingNearby` ({ x, y, z } block position, absent
 * once stopped or the block is gone). Without it a parrot never parties.
 */
const parrotJukebox = (tracker: EntityAnimTracker, input: EntityAnimInput): Jukebox | undefined => {
  const told = (input as any).recordPlayingNearby as Jukebox | undefined
  const key = told ? `${told.x},${told.y},${told.z}` : undefined
  // a new notification (setRecordPlayingNearby) replaces the jukebox, whatever the parrot forgot
  if (key !== tracker.memory.parrotJukeboxKey) {
    tracker.memory.parrotJukeboxKey = key
    tracker.memory.parrotJukebox = told
  }
  return tracker.memory.parrotJukebox
}

const parrot: EntityDriver = {
  tick(tracker, input) {
    // aiStep: forget the jukebox when out of range (Vec3i.closerToCenterThan(position, 3.46))
    const jukebox = parrotJukebox(tracker, input)
    const p = input.position
    if (jukebox && (!p || (jukebox.x + 0.5 - p.x) ** 2 + (jukebox.y + 0.5 - p.y) ** 2 + (jukebox.z + 0.5 - p.z) ** 2 >= 3.46 * 3.46)) tracker.memory.parrotJukebox = undefined
    const onGround = onGroundOf(input)
    tickFlap(flapMemory(tracker), !onGround && !input.isPassenger, onGround)
  },
  state(state, tracker, input) {
    const m = flapMemory(tracker)
    const pt = tracker.partialTick
    const flap = lerp(pt, m.oFlap, m.flap)
    const flapSpeed = lerp(pt, m.oFlapSpeed, m.flapSpeed)
    state.flapAngle = f(f(sinOf(input.version)(flap) + 1) * flapSpeed)
    // ParrotModel.getPose, as `parrotPose` (ParrotRenderState.pose hides LivingEntityRenderState.pose, kept as `pose`)
    if (parrotJukebox(tracker, input)) state.parrotPose = 'PARTY'
    else if (isInSittingPose(input)) state.parrotPose = 'SITTING'
    else state.parrotPose = onGroundOf(input) ? 'STANDING' : 'FLYING'
  }
}

// ---- bat ----

/** Bat: resting (flags & 1) runs the rest animation, else the fly animation (Bat.setupAnimationStates, every tick). */
const bat: EntityDriver = {
  tick(tracker, input) {
    if (flag(input, 1)) {
      tracker.stop('flyAnimationState')
      tracker.startIfStopped('restAnimationState')
    } else {
      tracker.stop('restAnimationState')
      tracker.startIfStopped('flyAnimationState')
    }
  },
  state(state, tracker, input) {
    state.isResting = flag(input, 1)
    state.flyAnimationState = tracker.animationStates.flyAnimationState ?? null
    state.restAnimationState = tracker.animationStates.restAnimationState ?? null
  }
}

// ---- bee ----

type BeeMemory = { rollAmount: number; rollAmountO: number; movedSqr: number; last?: Jukebox }

const beeMemory = (tracker: EntityAnimTracker): BeeMemory => (tracker.memory.bee ??= { rollAmount: 0, rollAmountO: 0, movedSqr: 0 })

/** Bee flags: 2 rolling, 4 has stung, 8 has nectar; angry from the anger end time. */
const bee: EntityDriver = {
  tick(tracker, input) {
    const m = beeMemory(tracker)
    m.rollAmountO = m.rollAmount
    if (flag(input, 2)) m.rollAmount = Math.min(1, f(m.rollAmount + f(0.2)))
    else m.rollAmount = Math.max(0, f(m.rollAmount - f(0.24)))
    // the movement of this tick, standing in for the delta movement (see isOnGround)
    const p = input.position
    if (p) {
      const last = m.last ?? p
      m.movedSqr = (p.x - last.x) ** 2 + (p.y - last.y) ** 2 + (p.z - last.z) ** 2
      m.last = { x: p.x, y: p.y, z: p.z }
    }
  },
  state(state, tracker, input) {
    const m = beeMemory(tracker)
    state.rollAmount = lerp(tracker.partialTick, m.rollAmountO, m.rollAmount)
    state.hasStinger = !flag(input, 4)
    // onGround && getDeltaMovement().lengthSqr() < 1.0E-7: the delta movement is the scene's `velocity` (blocks per tick)
    // when given, else the distance moved in the last tick
    const velocity = (input as any).velocity as Jukebox | undefined
    const movedSqr = velocity ? velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2 : m.movedSqr
    state.isOnGround = onGroundOf(input) && movedSqr < 1e-7
    state.isAngry = isAngryNeutral(input)
    state.hasNectar = flag(input, 8)
  }
}

// ---- allay ----

type AllayMemory = { holdingItemAnimationTicks: number; holdingItemAnimationTicks0: number; dancingAnimationTicks: number; spinningAnimationTicks: number; spinningAnimationTicks0: number }

const allayMemory = (tracker: EntityAnimTracker): AllayMemory =>
  (tracker.memory.allay ??= { holdingItemAnimationTicks: 0, holdingItemAnimationTicks0: 0, dancingAnimationTicks: 0, spinningAnimationTicks: 0, spinningAnimationTicks0: 0 })

/** Allay.isSpinning: the first 15 of every 55 dancing ticks. */
const allaySpinning = (m: AllayMemory) => f(m.dancingAnimationTicks % 55) < 15

/** Allay: the client side holding and dancing counters of Allay.tick (dancing is synched, the item the main hand's). */
const allay: EntityDriver = {
  tick(tracker, input) {
    const m = allayMemory(tracker)
    m.holdingItemAnimationTicks0 = m.holdingItemAnimationTicks
    if (!isEmptyItem(input.equipment?.mainhand)) m.holdingItemAnimationTicks = clamp(f(m.holdingItemAnimationTicks + 1), 0, 5)
    else m.holdingItemAnimationTicks = clamp(f(m.holdingItemAnimationTicks - 1), 0, 5)
    if (truthy(input.meta.dancing)) {
      m.dancingAnimationTicks = f(m.dancingAnimationTicks + 1)
      m.spinningAnimationTicks0 = m.spinningAnimationTicks
      if (allaySpinning(m)) m.spinningAnimationTicks = f(m.spinningAnimationTicks + 1)
      else m.spinningAnimationTicks = f(m.spinningAnimationTicks - 1)
      m.spinningAnimationTicks = clamp(m.spinningAnimationTicks, 0, 15)
    } else {
      m.dancingAnimationTicks = 0
      m.spinningAnimationTicks = 0
      m.spinningAnimationTicks0 = 0
    }
  },
  state(state, tracker, input) {
    const m = allayMemory(tracker)
    const pt = tracker.partialTick
    armedItems(state, input)
    state.isDancing = truthy(input.meta.dancing)
    state.isSpinning = allaySpinning(m)
    state.spinningProgress = f(lerp(pt, m.spinningAnimationTicks0, m.spinningAnimationTicks) / 15)
    state.holdingAnimationProgress = f(lerp(pt, m.holdingItemAnimationTicks0, m.holdingItemAnimationTicks) / 5)
  }
}

// ---- vex ----

/** Vex: charging (flags & 1) and the items by arm (the charging arms differ when a hand holds something). */
const vex: EntityDriver = {
  state(state, _tracker, input) {
    armedItems(state, input)
    state.isCharging = flag(input, 1)
  }
}

export const SMALL_DRIVERS: Record<string, EntityDriver> = { wolf, cat, ocelot, fox, rabbit, chicken, parrot, bat, bee, allay, vex }
