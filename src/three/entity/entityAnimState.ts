import { f, lerp, wrapDegrees } from './setupAnim/mth'
import { TickedWalk } from './setupAnim/walkAnimation'
import type { AnimState } from './setupAnim/types'
import type { EntityRenderHints } from './interpolationPolicy'

/**
 * The render state the game's renderers extract from an entity each frame (EntityRenderState and its subclasses), made
 * from what a client knows of the entity: its synched data, equipment, position and rotations, the entity events and arm
 * swings the server sent, and the client side ticking the game does for it (the walk animation, swings, swim amount,
 * animation states). Field names are 26.3's, which the ported models read.
 */

/** What the scene knows of an entity this frame. */
export type EntityAnimInput = {
  name: string
  version: string
  /** synched data by minecraft-data key (when the version has keys) */
  meta: Record<string, unknown>
  /** synched data by index */
  data: Record<number, unknown>
  /** pose name (STANDING, CROUCHING...) */
  pose?: string
  /** prismarine angles: radians, yaw 0 north counterclockwise, pitch positive up */
  bodyYaw: number
  headYaw: number
  pitch: number
  position?: { x: number; y: number; z: number }
  onGround?: boolean
  isPassenger?: boolean
  /** item names by slot: mainhand, offhand, head, chest, legs, feet, body, saddle */
  equipment?: Partial<Record<string, string | undefined>>
  /** the custom name (Dinnerbone and Grumm are drawn upside down) */
  customName?: string
  /** what the client tells the renderer about a vehicle (paddles, water patch, passengers) */
  renderHints?: EntityRenderHints
}

/** Flags of the shared, living and mob flag bytes. */
const bit = (value: unknown, mask: number) => typeof value === 'number' && (value & mask) !== 0

const TICK_MS = 50

/**
 * LivingEntity's swing: swing(hand) starts it, each tick advances it, the attack animation is its progress
 * (swingTime / attackAnim before 26.1, LivingEntity.SwingState since).
 */
export class SwingTracker {
  swinging = false
  swingTime = 0
  attackAnim = 0
  oAttackAnim = 0
  hand: 'MAIN_HAND' | 'OFF_HAND' = 'MAIN_HAND'
  duration = 6
  /** the swing animation type (26.3 items can stab) */
  type = 'WHACK'
  /** SwingState (26.1+) */
  modern = false

  swing(hand: 'MAIN_HAND' | 'OFF_HAND', duration = 6, type = 'WHACK') {
    if (this.modern) {
      // SwingState.startIfAble
      if (this.swinging && this.swingTime <= Math.trunc(this.duration / 2) && this.swingTime > 0) return
      if (!this.swinging || this.hand !== hand || this.duration !== duration || this.type !== type) {
        this.oAttackAnim = 0
        this.attackAnim = 0
      }
      this.swinging = true
      this.swingTime = 0
      this.hand = hand
      this.duration = duration
      this.type = type
      return
    }
    if (!this.swinging || this.swingTime >= Math.trunc(duration / 2) || this.swingTime < 0) {
      this.swingTime = -1
      this.swinging = true
      this.hand = hand
      this.duration = duration
      this.type = type
    }
  }

  /** LivingEntity.updateSwingTime and the attack animation, once per tick. */
  tick() {
    this.oAttackAnim = this.attackAnim
    if (this.modern) {
      // SwingState.tick
      if (this.swinging) {
        if (this.duration > 0) this.attackAnim = Math.min(f(this.swingTime / this.duration), 1)
        if (this.swingTime++ > this.duration) {
          this.swinging = false
          this.attackAnim = 0
        }
      } else {
        this.attackAnim = 0
      }
      return
    }
    if (this.swinging) {
      this.swingTime++
      if (this.swingTime >= this.duration) {
        this.swingTime = 0
        this.swinging = false
      }
    } else {
      this.swingTime = 0
    }
    this.attackAnim = f(this.swingTime / this.duration)
  }

  /** getSwingAnimation / getAttackAnim(partialTicks) */
  progress(partialTick: number) {
    if (this.modern) return this.attackAnim >= this.oAttackAnim ? lerp(partialTick, this.oAttackAnim, this.attackAnim) : lerp(partialTick, this.oAttackAnim, f(this.attackAnim + 1))
    let delta = f(this.attackAnim - this.oAttackAnim)
    if (delta < 0) delta = f(delta + 1)
    return f(this.oAttackAnim + f(delta * partialTick))
  }
}

/** Per scene entity: everything the game ticks client side that the render state reads. */
export class EntityAnimTracker {
  readonly walk = new TickedWalk()
  readonly swing = new SwingTracker()
  tickCount = 0
  swimAmount = 0
  swimAmountO = 0
  /** ticks since the entity started using an item (living flags), counted client side */
  useTicks = 0
  using = false
  /** animation states by render state field: the tick they started at */
  readonly animationStates: Record<string, number | null> = {}
  /** whatever an entity's own client ticking keeps */
  readonly memory: Record<string, any> = {}
  /** timers events start, in ticks */
  readonly timers: Record<string, number> = {}
  private input?: EntityAnimInput

  constructor(
    readonly name: string,
    readonly version: string
  ) {
    this.swing.modern = versionAtLeast(version, '26.1')
  }

  /** The latest input (pose, data, position): read by the ticks. */
  setInput(input: EntityAnimInput) {
    this.input = input
    if (input.position) this.walk.setPosition(input.position)
  }

  /** Advances the client ticks the frame's time covers. */
  advance(deltaSeconds: number) {
    const input = this.input
    const still = !!input?.isPassenger
    const flying = !!input && OMNIDIRECTIONAL.has(input.name)
    const baby = !!input && isBaby(input)
    const ticks = this.walk.advance(deltaSeconds, { useY: flying, positionScale: input && babyWalkScale(input.version, baby), still })
    for (let i = 0; i < ticks; i++) this.tick()
  }

  /** One client tick. */
  tick() {
    this.tickCount++
    this.swing.tick()
    const input = this.input
    if (!input) return
    this.swimAmountO = this.swimAmount
    this.swimAmount = input.pose === 'SWIMMING' ? Math.min(1, f(this.swimAmount + f(0.09))) : Math.max(0, f(this.swimAmount - f(0.09)))
    const using = bit(livingFlags(input), 1)
    if (using && !this.using) this.useTicks = 0
    else if (using) this.useTicks++
    this.using = using
    ENTITY_DRIVERS[input.name]?.tick?.(this, input)
  }

  /** An entity event (entity_status) the server sent. */
  event(id: number) {
    if (this.input) ENTITY_DRIVERS[this.input.name]?.event?.(this, id, this.input)
    else ENTITY_DRIVERS[this.name]?.event?.(this, id, undefined)
  }

  /** An arm swing (the animate packet: 0 main hand, 3 off hand). */
  swingArm(hand: 'MAIN_HAND' | 'OFF_HAND') {
    this.swing.swing(hand)
  }

  /** AnimationState.start / startIfStopped / stop / animateWhen, by render state field, at this tick. */
  start(field: string) {
    this.animationStates[field] = this.tickCount
  }

  startIfStopped(field: string) {
    if (this.animationStates[field] === null || this.animationStates[field] === undefined) this.animationStates[field] = this.tickCount
  }

  stop(field: string) {
    this.animationStates[field] = null
  }

  animateWhen(field: string, condition: boolean) {
    if (condition) this.startIfStopped(field)
    else this.stop(field)
  }

  started(field: string) {
    return this.animationStates[field] !== null && this.animationStates[field] !== undefined
  }

  get partialTick() {
    return this.walk.partialTick
  }

  get ageInTicks() {
    return f(this.tickCount + this.partialTick)
  }
}

/** Entities that walk in 3D (LivingEntity.omnidirectionalAirMover: flying and swimming mobs). */
const OMNIDIRECTIONAL = new Set(['bat', 'bee', 'allay', 'vex', 'blaze', 'ghast', 'happy_ghast', 'parrot', 'phantom', 'ender_dragon', 'wither', 'breeze'])

/** 1.19.4 made a baby's walk position three times as fast. */
const babyWalkScale = (version: string, baby: boolean) => (baby && versionAtLeast(version, '1.19.4') ? 3 : 1)

const versionAtLeast = (version: string, other: string) => {
  const n = (v: string) => v.split('.').reduce((total, part, i) => total + Number(part) * [1_000_000, 1000, 1][i]!, 0)
  return n(version) >= n(other)
}

const livingFlags = (input: EntityAnimInput) => input.meta.living_entity_flags ?? input.meta.hand_states
const mobFlags = (input: EntityAnimInput) => input.meta.mob_flags ?? input.meta.insentient
const sharedFlags = (input: EntityAnimInput) => input.meta.shared_flags ?? input.meta.entity_flags

export const isBaby = (input: EntityAnimInput) => input.meta.baby === true || (typeof input.meta.age === 'number' && input.meta.age < 0)

const RAD_TO_DEG = 180 / Math.PI

/**
 * Per entity: the client side ticking its render state reads (a chicken's flapping, a squid's tentacles, animation
 * states started by poses and synched data), its entity events, and its renderer's own render state fields
 * (extractRenderState of its renderer).
 */
export type EntityDriver = {
  /** the entity's client tick (after the common ticking) */
  tick?: (tracker: EntityAnimTracker, input: EntityAnimInput) => void
  /** an entity event (entity_status) */
  event?: (tracker: EntityAnimTracker, id: number, input: EntityAnimInput | undefined) => void
  /** the renderer's own render state fields */
  state?: (state: AnimState, tracker: EntityAnimTracker, input: EntityAnimInput) => void
}

/** Filled from ./drivers (set there to avoid an import cycle). */
export const ENTITY_DRIVERS: Record<string, EntityDriver> = {}

export const registerEntityDrivers = (drivers: Record<string, EntityDriver>) => Object.assign(ENTITY_DRIVERS, drivers)

/**
 * The render state of an entity now: LivingEntityRenderer's, ArmedEntityRenderState's and HumanoidMobRenderer's fields
 * (what every living model reads), then the entity's renderer's own.
 */
export function entityAnimState(tracker: EntityAnimTracker, input: EntityAnimInput): AnimState {
  const pt = tracker.partialTick
  const bodyRot = f(wrapDegrees(f(180 - input.bodyYaw * RAD_TO_DEG)))
  const headRot = f(wrapDegrees(f(180 - input.headYaw * RAD_TO_DEG)))
  let yRot = wrapDegrees(f(headRot - bodyRot))
  let xRot = f(-input.pitch * RAD_TO_DEG)
  const isUpsideDown = input.customName === 'Dinnerbone' || input.customName === 'Grumm'
  if (isUpsideDown) {
    xRot = f(xRot * -1)
    yRot = f(yRot * -1)
  }
  const baby = isBaby(input)
  const passenger = !!input.isPassenger
  const living = livingFlags(input)
  const usingItem = bit(living, 1)
  const useItemHand = bit(living, 2) ? 'OFF_HAND' : 'MAIN_HAND'
  const shared = sharedFlags(input)
  const swing = tracker.swing
  const swingAnimation = swing.progress(pt)
  const state: AnimState = {
    ageInTicks: tracker.ageInTicks,
    bodyRot,
    yRot,
    xRot,
    deathTime: 0,
    walkAnimationPos: passenger ? 0 : tracker.walk.walk.positionAt(pt),
    walkAnimationSpeed: passenger ? 0 : tracker.walk.walk.speedAt(pt),
    scale: 1,
    ageScale: baby ? 0.5 : 1,
    ticksSinceKineticHitFeedback: 0,
    isUpsideDown,
    isFullyFrozen: typeof input.meta.ticks_frozen === 'number' && input.meta.ticks_frozen >= 140,
    isBaby: baby,
    isInWater: false,
    isAutoSpinAttack: bit(living, 4),
    hasRedOverlay: false,
    isInvisibleToPlayer: false,
    isInvisible: bit(shared, 0x20),
    bedOrientation: null,
    pose: input.pose ?? 'STANDING',
    wornHeadAnimationPos: 0,
    // ArmedEntityRenderState
    mainArm: bit(mobFlags(input), 2) ? 'LEFT' : 'RIGHT',
    rightArmPose: 'EMPTY',
    leftArmPose: 'EMPTY',
    currentSwing: swing.swinging ? { hand: swing.hand, animation: { type: swing.type, duration: swing.duration }, durationTicks: swing.duration } : null,
    swingAnimation,
    // HumanoidRenderState
    swimAmount: lerp(pt, tracker.swimAmountO, tracker.swimAmount),
    speedValue: 1,
    maxCrossbowChargeDuration: 25,
    ticksUsingItem: usingItem ? f(tracker.useTicks + pt) : 0,
    useItemHand,
    isCrouching: input.pose === 'CROUCHING',
    isFallFlying: bit(shared, 0x80),
    isVisuallySwimming: input.pose === 'SWIMMING',
    isPassenger: passenger,
    isUsingItem: usingItem,
    elytraRotX: 0,
    elytraRotY: 0,
    elytraRotZ: 0,
    // Mob
    isAggressive: bit(mobFlags(input), 4),
    // the items in hand (models read whether a hand is empty)
    mainHandItem: input.equipment?.mainhand,
    offHandItem: input.equipment?.offhand
  }
  state.wornHeadAnimationPos = state.walkAnimationPos
  state.rightHandItem = state.mainArm === 'RIGHT' ? state.mainHandItem : state.offHandItem
  state.leftHandItem = state.mainArm === 'RIGHT' ? state.offHandItem : state.mainHandItem
  for (const [field, start] of Object.entries(tracker.animationStates)) state[field] = start
  ENTITY_DRIVERS[input.name]?.state?.(state, tracker, input)
  return state
}

export const TICK_SECONDS = TICK_MS / 1000
