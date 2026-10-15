import { isBaby, type EntityAnimInput, type EntityAnimTracker, type EntityDriver } from '../entityAnimState'
import { f, lerp } from '../setupAnim/mth'
import { versionNumber } from '../setupAnim/types'
import { WalkAnimation } from '../setupAnim/walkAnimation'

/**
 * Horses, donkeys, mules, skeleton and zombie horses (AbstractHorseRenderer), camels and camel husks (CamelRenderer),
 * sniffers, armadillos and striders, 26.3: their renderers' extractRenderState and the client side ticking, synched
 * data callbacks and entity events feeding it.
 *
 * Inputs beyond EntityAnimInput, all optional (read as `(input as any).name`):
 * - `isVehicle`: the entity carries passengers (Entity.isVehicle: the render states' isRidden)
 * - `gameTime`: the level's game time (ClientLevel.getGameTime: the set_time packet's, counted on by the client each
 *   tick) — a camel's pose time is the game time minus its last_pose_change_tick
 * - `isInWater` / `isInLava` / `isInLiquid`: the fluid at the entity (a camel's dash ends in a liquid, a horse's legs
 *   swing slower in water)
 */

/** Client side randomness (the entity's random): `tracker.memory.random` replaces Math.random (tests). */
const nextInt = (tracker: EntityAnimTracker, bound: number) => Math.floor(((tracker.memory.random as (() => number) | undefined) ?? Math.random)() * bound)

/** A synched long or int as prismarine decodes it: a number, a bigint, a [high, low] pair or a numeric string. */
const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return value[0] * 2 ** 32 + (value[1] >>> 0)
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return undefined
}

/** A synched enum by its constant name: numbers are ids, strings names; an unknown id is the first (ByIdMap ZERO). */
const enumName = (value: unknown, names: readonly string[]) => {
  if (typeof value === 'string' && Number.isNaN(Number(value))) return value.toUpperCase()
  const id = toNumber(value)
  return (id !== undefined && names[id]) || names[0]!
}

const sameValue = (a: unknown, b: unknown) => a === b || (toNumber(a) !== undefined && toNumber(a) === toNumber(b))

/**
 * Entity.onSyncedDataUpdated: runs `onChange` when a synched field's value differs from the last one this entity saw.
 * The server sends a field when it changes, and the spawn's data sends every field not at its default, so a first
 * value other than the default counts as received too (`first`: during the entity's first tick, Entity.firstTick).
 */
const onSyncedDataUpdated = (tracker: EntityAnimTracker, key: string, value: unknown, defaultValue: unknown, onChange: (first: boolean) => void) => {
  const slot = `synched:${key}`
  const first = !(slot in tracker.memory)
  const previous = first ? defaultValue : tracker.memory[slot]
  const current = value ?? defaultValue
  tracker.memory[slot] = current
  if (!sameValue(previous, current)) onChange(first)
}

const isVehicle = (input: EntityAnimInput) => (input as any).isVehicle === true
const isInLiquid = (input: EntityAnimInput) => (input as any).isInLiquid === true || (input as any).isInWater === true || (input as any).isInLava === true

const before = (input: EntityAnimInput, version: string) => versionNumber(input.version) < versionNumber(version)

/** AbstractHorse's synched flag byte (DATA_ID_FLAGS): tame 2, saddled 4 (before 1.21.5), bred 8, eating 16, standing 32, open mouth 64. */
const horseFlag = (input: EntityAnimInput, flag: number) => ((toNumber(input.meta.flags) ?? 0) & flag) !== 0

/** The saddle: the saddle equipment slot (1.21.5+), the horse flags' saddled bit before. */
const horseSaddle = (input: EntityAnimInput) => input.equipment?.saddle ?? (before(input, '1.21.5') && horseFlag(input, 4) ? 'saddle' : undefined)

type HorseMemory = {
  tailCounter: number
  eatAnim: number
  eatAnimO: number
  standAnim: number
  standAnimO: number
  mouthAnim: number
  mouthAnimO: number
}

const horseMemory = (tracker: EntityAnimTracker): HorseMemory => {
  tracker.memory.horse ??= { tailCounter: 0, eatAnim: 0, eatAnimO: 0, standAnim: 0, standAnimO: 0, mouthAnim: 0, mouthAnimO: 0 }
  return tracker.memory.horse as HorseMemory
}

/**
 * AbstractHorse: aiStep's tail swish (1 in 200 each tick, on the client too), tick's tail counter, and the eat, stand
 * and mouth animations eased toward the synched eating, standing and open mouth flags.
 */
const equine: EntityDriver = {
  tick(tracker, input) {
    const m = horseMemory(tracker)
    // aiStep: moveTail
    if (nextInt(tracker, 200) === 0) m.tailCounter = 1
    // tick (the mouth and stand counters run where the flags are set: on the server)
    if (m.tailCounter > 0 && ++m.tailCounter > 8) m.tailCounter = 0
    m.eatAnimO = m.eatAnim
    if (horseFlag(input, 16)) {
      m.eatAnim = f(m.eatAnim + f(f(f(1 - m.eatAnim) * f(0.4)) + f(0.05)))
      if (m.eatAnim > 1) m.eatAnim = 1
    } else {
      m.eatAnim = f(m.eatAnim + f(f(f(0 - m.eatAnim) * f(0.4)) - f(0.05)))
      if (m.eatAnim < 0) m.eatAnim = 0
    }
    m.standAnimO = m.standAnim
    if (horseFlag(input, 32)) {
      m.eatAnim = 0
      m.eatAnimO = m.eatAnim
      m.standAnim = f(m.standAnim + f(f(f(1 - m.standAnim) * f(0.4)) + f(0.05)))
      if (m.standAnim > 1) m.standAnim = 1
    } else {
      const s = m.standAnim
      m.standAnim = f(s + f(f(f(f(f(f(f(0.8) * s) * s) * s) - s) * f(0.6)) - f(0.05)))
      if (m.standAnim < 0) m.standAnim = 0
    }
    m.mouthAnimO = m.mouthAnim
    if (horseFlag(input, 64)) {
      m.mouthAnim = f(m.mouthAnim + f(f(f(1 - m.mouthAnim) * f(0.7)) + f(0.05)))
      if (m.mouthAnim > 1) m.mouthAnim = 1
    } else {
      m.mouthAnim = f(m.mouthAnim + f(f(f(0 - m.mouthAnim) * f(0.7)) - f(0.05)))
      if (m.mouthAnim < 0) m.mouthAnim = 0
    }
  },
  // AbstractHorseRenderer.extractRenderState
  state(state, tracker, input) {
    const m = horseMemory(tracker)
    const pt = tracker.partialTick
    state.saddle = horseSaddle(input)
    state.bodyArmorItem = input.equipment?.body
    state.isRidden = isVehicle(input)
    state.eatAnimation = lerp(pt, m.eatAnimO, m.eatAnim)
    state.standAnimation = lerp(pt, m.standAnimO, m.standAnim)
    state.feedingAnimation = lerp(pt, m.mouthAnimO, m.mouthAnim)
    state.animateTail = m.tailCounter > 0
    // LivingEntityRenderState.isInWater (the legs swing slower in water), when the scene knows it
    if (typeof (input as any).isInWater === 'boolean') state.isInWater = (input as any).isInWater
  }
}

/** DonkeyRenderer: AbstractHorseRenderer's state and whether it carries a chest (synched DATA_ID_CHEST). */
const chestedEquine: EntityDriver = {
  ...equine,
  state(state, tracker, input) {
    equine.state!(state, tracker, input)
    state.hasChest = input.meta.chest === true
  }
}

// --- camels ---

const SITDOWN_DURATION_TICKS = 40
const STANDUP_DURATION_TICKS = 52

type CamelMemory = {
  /** the client's DASH value: the server's, or false once the client ends the dash itself */
  dashing: boolean
  dashCooldown: number
  idleAnimationTimeout: number
  walk: WalkAnimation
  lastPosition?: { x: number; z: number }
  /** without a game time input: the game time minus tickCount, from the pose changes seen (undefined before one) */
  gameTimeOffset?: number
}

const camelMemory = (tracker: EntityAnimTracker): CamelMemory => {
  tracker.memory.camel ??= { dashing: false, dashCooldown: 0, idleAnimationTimeout: 0, walk: new WalkAnimation() }
  return tracker.memory.camel as CamelMemory
}

const lastPoseChangeTick = (input: EntityAnimInput) => toNumber(input.meta.last_pose_change_tick) ?? 0

/**
 * Camel.getPoseTime: the level's game time minus the magnitude of the synched last pose change tick (negative while
 * sitting). With a `gameTime` input, exact. Without one, the game time is worked out from the pose changes seen:
 * sitDown and standUp write the game time of the change, so when the value changes the game time is (at least) its
 * magnitude, and it advances one per tick after. Before any change is seen the pose is taken as long settled (a camel
 * already sitting when it comes into view does not sit down again).
 */
const camelPoseTime = (tracker: EntityAnimTracker, input: EntityAnimInput) => {
  const change = Math.abs(lastPoseChangeTick(input))
  const gameTime = toNumber((input as any).gameTime)
  if (gameTime !== undefined) return gameTime - change
  const offset = camelMemory(tracker).gameTimeOffset
  if (offset === undefined) return Number.MAX_SAFE_INTEGER
  return tracker.tickCount + offset - change
}

/** Camel.onSyncedDataUpdated for DASH: the dash cooldown starts (unless running) when the dash flag changes. */
const camelDashChanged = (m: CamelMemory) => {
  m.dashCooldown = m.dashCooldown === 0 ? 55 : m.dashCooldown
}

/**
 * Camel (and CamelHusk): the dash flag and its client cooldown (jumpCooldown), its own walk animation (6 times the
 * distance, eased by 0.2, none while sitting or dashing), and setupAnimationStates: the idle every 80 to 119 ticks,
 * sitting down, sat and standing up by the pose time, the dash.
 */
const camel: EntityDriver = {
  tick(tracker, input) {
    const m = camelMemory(tracker)
    // synched data received before this tick
    onSyncedDataUpdated(tracker, 'dash', input.meta.dash === true, false, first => {
      m.dashing = input.meta.dash === true
      if (!first) camelDashChanged(m)
    })
    onSyncedDataUpdated(tracker, 'last_pose_change_tick', lastPoseChangeTick(input), 0, first => {
      if (first) return
      // the change happened now (the game time is its magnitude) or before (standUpInstantly writes game time - 53)
      const offset = Math.abs(lastPoseChangeTick(input)) - tracker.tickCount
      m.gameTimeOffset = m.gameTimeOffset === undefined ? offset : Math.max(m.gameTimeOffset, offset)
    })

    // LivingEntity.aiStep -> calculateEntityAnimation -> Camel.updateWalkAnimation (with the last tick's dash state)
    const position = input.position
    const distance = position && m.lastPosition ? f(Math.hypot(position.x - m.lastPosition.x, position.z - m.lastPosition.z)) : 0
    if (position) m.lastPosition = { x: position.x, z: position.z }
    if (input.isPassenger) {
      m.walk.stop()
    } else {
      const standing = (input.pose ?? 'STANDING') === 'STANDING'
      const targetSpeed = standing && !tracker.started('dashAnimationState') ? Math.min(f(distance * 6), 1) : 0
      m.walk.update(targetSpeed, f(0.2), isBaby(input) ? 3 : 1)
    }

    // Camel.tick
    if (m.dashing && m.dashCooldown < 50 && (input.onGround || isInLiquid(input) || input.isPassenger)) {
      // setDashing(false) on the client: the data callback runs too
      m.dashing = false
      camelDashChanged(m)
    }
    if (m.dashCooldown > 0) --m.dashCooldown

    // setupAnimationStates
    if (m.idleAnimationTimeout <= 0) {
      m.idleAnimationTimeout = nextInt(tracker, 40) + 80
      tracker.start('idleAnimationState')
    } else {
      --m.idleAnimationTimeout
    }
    const sitting = lastPoseChangeTick(input) < 0
    const poseTime = camelPoseTime(tracker, input)
    if (poseTime < 0 !== sitting) {
      // isCamelVisuallySitting
      tracker.stop('sitUpAnimationState')
      tracker.stop('dashAnimationState')
      if (sitting && poseTime < SITDOWN_DURATION_TICKS && poseTime >= 0) {
        tracker.startIfStopped('sitAnimationState')
        tracker.stop('sitPoseAnimationState')
      } else {
        tracker.stop('sitAnimationState')
        tracker.startIfStopped('sitPoseAnimationState')
      }
    } else {
      tracker.stop('sitAnimationState')
      tracker.stop('sitPoseAnimationState')
      tracker.animateWhen('dashAnimationState', m.dashing)
      const inPoseTransition = poseTime < (sitting ? SITDOWN_DURATION_TICKS : STANDUP_DURATION_TICKS)
      tracker.animateWhen('sitUpAnimationState', inPoseTransition && poseTime >= 0)
    }
  },
  // CamelRenderer.extractAdditionalState (entityAnimState copies the animation states)
  state(state, tracker, input) {
    const m = camelMemory(tracker)
    const pt = tracker.partialTick
    state.saddle = horseSaddle(input)
    state.isRidden = isVehicle(input)
    state.jumpCooldown = Math.max(f(m.dashCooldown - pt), 0)
    // Camel.getAgeScale
    state.ageScale = state.isBaby ? f(0.6) : 1
    // the camel's own walk animation (a passenger's is stopped: entityAnimState gives 0)
    if (!input.isPassenger) {
      state.walkAnimationPos = m.walk.positionAt(pt)
      state.walkAnimationSpeed = m.walk.speedAt(pt)
      state.wornHeadAnimationPos = state.walkAnimationPos
    }
  }
}

// --- sniffer ---

const SNIFFER_STATES = ['IDLING', 'FEELING_HAPPY', 'SCENTING', 'SNIFFING', 'SEARCHING', 'DIGGING', 'RISING'] as const
const SNIFFER_ANIMATIONS = ['diggingAnimationState', 'sniffingAnimationState', 'risingAnimationState', 'feelingHappyAnimationState', 'scentingAnimationState']
const SNIFFER_STARTS: Record<string, string> = {
  FEELING_HAPPY: 'feelingHappyAnimationState',
  SCENTING: 'scentingAnimationState',
  SNIFFING: 'sniffingAnimationState',
  DIGGING: 'diggingAnimationState',
  RISING: 'risingAnimationState'
}
const snifferState = (input: EntityAnimInput) => enumName(input.meta.state, SNIFFER_STATES)

/** Sniffer.onSyncedDataUpdated for DATA_STATE: every animation stops, the new state's starts; searching walks differently. */
const sniffer: EntityDriver = {
  tick(tracker, input) {
    if (!('sniffer' in tracker.memory)) {
      tracker.memory.sniffer = true
      for (const field of SNIFFER_ANIMATIONS) tracker.stop(field)
    }
    const state = snifferState(input)
    onSyncedDataUpdated(tracker, 'state', state, 'IDLING', () => {
      for (const field of SNIFFER_ANIMATIONS) tracker.stop(field)
      const field = SNIFFER_STARTS[state]
      // the callback ran when the data arrived, between ticks: at the last tick's tickCount
      if (field) tracker.animationStates[field] = tracker.tickCount - 1
    })
  },
  state(state, _tracker, input) {
    state.isSearching = snifferState(input) === 'SEARCHING'
  }
}

// --- armadillo ---

const ARMADILLO_STATES = ['IDLE', 'ROLLING', 'SCARED', 'UNROLLING'] as const
const SCARED_ANIMATION_DURATION = 50
const armadilloState = (input: EntityAnimInput) => enumName(input.meta.armadillo_state, ARMADILLO_STATES)

/** ArmadilloState.shouldHideInShell */
const shouldHideInShell = (state: string, ticksInState: number) => {
  switch (state) {
    case 'ROLLING':
      return ticksInState > 5
    case 'SCARED':
      return true
    case 'UNROLLING':
      return ticksInState < 26
    default:
      return false
  }
}

type ArmadilloMemory = { inStateTicks: number; peekReceivedClient: boolean }
const armadilloMemory = (tracker: EntityAnimTracker): ArmadilloMemory => {
  tracker.memory.armadillo ??= { inStateTicks: 0, peekReceivedClient: false }
  return tracker.memory.armadillo as ArmadilloMemory
}

/**
 * Armadillo: the ticks in its synched state (reset when it changes), setupAnimationStates (rolling up; peeking — fast
 * forwarded past the peek when it became scared this tick, restarted by entity event 64 — and rolling out), and the
 * in-shell part visibility (shouldHideInShell).
 */
const armadillo: EntityDriver = {
  tick(tracker, input) {
    const m = armadilloMemory(tracker)
    const state = armadilloState(input)
    onSyncedDataUpdated(tracker, 'armadillo_state', state, 'IDLE', () => {
      m.inStateTicks = 0
    })
    // setupAnimationStates
    switch (state) {
      case 'ROLLING':
        tracker.stop('rollOutAnimationState')
        tracker.startIfStopped('rollUpAnimationState')
        tracker.stop('peekAnimationState')
        break
      case 'SCARED':
        tracker.stop('rollOutAnimationState')
        tracker.stop('rollUpAnimationState')
        if (m.peekReceivedClient) {
          tracker.stop('peekAnimationState')
          m.peekReceivedClient = false
        }
        if (m.inStateTicks === 0) {
          tracker.start('peekAnimationState')
          // fastForward(SCARED.animationDuration(), 1.0F)
          tracker.animationStates.peekAnimationState = tracker.tickCount - Math.trunc(f(SCARED_ANIMATION_DURATION * 1))
        } else {
          tracker.startIfStopped('peekAnimationState')
        }
        break
      case 'UNROLLING':
        tracker.startIfStopped('rollOutAnimationState')
        tracker.stop('rollUpAnimationState')
        tracker.stop('peekAnimationState')
        break
      default:
        tracker.stop('rollOutAnimationState')
        tracker.stop('rollUpAnimationState')
        tracker.stop('peekAnimationState')
    }
    ++m.inStateTicks
  },
  event(tracker, id) {
    // the peek out of the shell (sent while scared)
    if (id === 64) armadilloMemory(tracker).peekReceivedClient = true
  },
  state(state, tracker, input) {
    state.isHidingInShell = shouldHideInShell(armadilloState(input), armadilloMemory(tracker).inStateTicks)
    // Armadillo.getAgeScale
    state.ageScale = state.isBaby ? f(0.6) : 1
  }
}

// --- strider ---

/** StriderRenderer: cold (synched suffocating: the cold texture, the renderer's shaking) and ridden. */
const strider: EntityDriver = {
  state(state, _tracker, input) {
    state.saddle = input.equipment?.saddle ?? (before(input, '1.21.5') && input.meta.saddle === true ? 'saddle' : undefined)
    state.isSuffocating = input.meta.suffocating === true
    state.isRidden = isVehicle(input)
    // StriderRenderer.isShaking: LivingEntityRenderer.setupRotations shakes the body (a renderer field, not a model's)
    state.isShaking = !!state.isFullyFrozen || state.isSuffocating
  }
}

export const EQUINES_DRIVERS: Record<string, EntityDriver> = {
  horse: equine,
  skeleton_horse: equine,
  zombie_horse: equine,
  donkey: chestedEquine,
  mule: chestedEquine,
  camel,
  camel_husk: camel,
  sniffer,
  armadillo,
  strider
}
