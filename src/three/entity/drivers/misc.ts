import type { EntityAnimInput, EntityAnimTracker, EntityDriver } from '../entityAnimState'
import type { AnimState } from '../setupAnim/types'
import { WalkAnimation } from '../setupAnim/walkAnimation'
import { f, lerp } from '../setupAnim/mth'

/**
 * Golems, villagers, illagers, witch, warden, breeze, creaking, minecarts and arrows: what their renderers' extractRenderState
 * read (26.3), from the synched data, equipment, entity events and the client ticking of the entities (IronGolem.aiStep's
 * attack / flower timers, Villager.tick's unhappy counter, Warden.tick's tendrils and heart beat, Breeze.tick, Creaking's
 * timers and eye flicker, CopperGolem.setupAnimationStates, Illusioner's mirror offsets, AbstractMinecart.tick's hurt
 * wobble, AbstractArrow's shake).
 *
 * onSyncedDataUpdated callbacks run when the packet arrives, between two ticks; the drivers see the new value at the next
 * tick, so what such a callback starts is started at the tick the packet arrived in (tickCount - 1).
 *
 * Inputs beyond EntityAnimInput, read when the scene provides them:
 * - `entityId` (Entity.getId): the witch's nose wobble speed and the minecart's offset seed;
 * - `hurtTime` (LivingEntity.hurtTime, 10 on the hurt animation packet, counting down): the illusioner's mirror shuffle;
 * - `maxHealth` (the max_health attribute): the iron golem's crackiness (its default, 100, otherwise).
 * Client randomness (the copper golem's idle spin delay, the creaking's eye flicker, the illusioner's offsets) draws from
 * `tracker.memory.random` (a function returning [0, 1), Math.random when unset).
 */

const RAD_TO_DEG = 180 / Math.PI

const bit = (value: unknown, mask: number) => typeof value === 'number' && (value & mask) !== 0
const numberOf = (value: unknown, fallback = 0) => (typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : fallback)
const boolOf = (value: unknown, fallback = false) => (typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : fallback)
const mobFlags = (input: EntityAnimInput) => input.meta.mob_flags ?? input.meta.insentient
const sharedFlags = (input: EntityAnimInput) => input.meta.shared_flags ?? input.meta.entity_flags
const itemName = (name: string | undefined) => name?.replace(/^minecraft:/, '')

type ExtraInput = EntityAnimInput & { entityId?: number; id?: number; hurtTime?: number; maxHealth?: number }
const extra = (input: EntityAnimInput) => input as ExtraInput
const entityIdOf = (input: EntityAnimInput) => {
  const { entityId, id } = extra(input)
  return typeof entityId === 'number' ? entityId : typeof id === 'number' ? id : undefined
}

/** An enum's constant name from a synched value: its id (ByIdMap, out of bounds = the first) or its (serialized) name. */
const enumName = (value: unknown, names: readonly string[], fallback: string) => {
  if (typeof value === 'string') return value.replace(/^minecraft:/, '').toUpperCase()
  if (typeof value === 'number') return names[value] ?? names[0] ?? fallback
  return fallback
}

/** RandomSource.nextInt(bound) of the client's random. */
const nextInt = (tracker: EntityAnimTracker, bound: number) => {
  const random = (tracker.memory.random as (() => number) | undefined) ?? Math.random
  return Math.min(bound - 1, Math.floor(random() * bound))
}

/** onSyncedDataUpdated: did the synched value change since the last tick (from its default before the first)? */
const synchedChanged = (tracker: EntityAnimTracker, key: string, value: unknown, initial: unknown) => {
  const memo = `synched:${key}`
  const previous = memo in tracker.memory ? tracker.memory[memo] : initial
  tracker.memory[memo] = value
  return previous !== value
}

/** The tick a synched data callback ran at: the one before the tick that sees the new value. */
const callbackTick = (tracker: EntityAnimTracker) => Math.max(0, tracker.tickCount - 1)

const startAt = (tracker: EntityAnimTracker, field: string, tick: number) => {
  tracker.animationStates[field] = tick
}

const startIfStoppedAt = (tracker: EntityAnimTracker, field: string, tick: number) => {
  if (!tracker.started(field)) tracker.animationStates[field] = tick
}

/**
 * A synched counter the client also counts down every tick (Villager.tick's unhappy counter, AbstractMinecart.tick's hurt
 * and damage): the server's value when a new one arrives, then one less each tick (the packet comes before the tick).
 */
const countDown = (tracker: EntityAnimTracker, key: string, value: unknown) => {
  const memo = `count:${key}`
  if (synchedChanged(tracker, key, value, undefined)) tracker.memory[memo] = numberOf(value)
  const current = numberOf(tracker.memory[memo])
  if (current > 0) tracker.memory[memo] = f(current - 1)
}

const counter = (tracker: EntityAnimTracker, key: string) => numberOf(tracker.memory[`count:${key}`])

// --- golems ---

/** Crackiness.GOLEM.byFraction */
const golemCrackiness = (fraction: number) => (fraction < f(0.25) ? 'HIGH' : fraction < f(0.5) ? 'MEDIUM' : fraction < f(0.75) ? 'LOW' : 'NONE')

/** IronGolem: attack (event 4) and flower offering (events 11, 34) timers, counted down in aiStep. */
const ironGolem: EntityDriver = {
  tick(tracker) {
    const { timers } = tracker
    if ((timers.attackAnimationTick ?? 0) > 0) timers.attackAnimationTick!--
    if ((timers.offerFlowerTick ?? 0) > 0) timers.offerFlowerTick!--
  },
  event(tracker, id) {
    if (id === 4) tracker.timers.attackAnimationTick = 10
    else if (id === 11) tracker.timers.offerFlowerTick = 400
    else if (id === 34) tracker.timers.offerFlowerTick = 0
  },
  state(state, tracker, input) {
    const attackTick = tracker.timers.attackAnimationTick ?? 0
    state.attackTicksRemaining = attackTick > 0 ? f(attackTick - tracker.partialTick) : 0
    state.offerFlowerTick = tracker.timers.offerFlowerTick ?? 0
    state.flowerBlock = state.offerFlowerTick > 0 ? 'minecraft:poppy' : null
    const health = input.meta.health
    state.crackiness = typeof health === 'number' ? golemCrackiness(f(f(health) / f(numberOf(extra(input).maxHealth, 100)))) : 'NONE'
  }
}

/** SnowGolem: the carved pumpkin on its head (the pumpkin flag byte, 16, set by default). */
const snowGolem: EntityDriver = {
  state(state, _tracker, input) {
    const pumpkin = input.meta.pumpkin
    const hasPumpkin = pumpkin === undefined || pumpkin === null ? true : typeof pumpkin === 'boolean' ? pumpkin : bit(pumpkin, 16)
    state.headBlock = hasPumpkin ? 'minecraft:carved_pumpkin' : null
  }
}

const COPPER_GOLEM_STATES = ['IDLE', 'GETTING_ITEM', 'GETTING_NO_ITEM', 'DROPPING_ITEM', 'DROPPING_NO_ITEM'] as const
const WEATHER_STATES = ['UNAFFECTED', 'EXPOSED', 'WEATHERED', 'OXIDIZED'] as const

const COPPER_GOLEM_ANIMATIONS: Record<string, string> = {
  GETTING_ITEM: 'interactionGetItem',
  GETTING_NO_ITEM: 'interactionGetNoItem',
  DROPPING_ITEM: 'interactionDropItem',
  DROPPING_NO_ITEM: 'interactionDropNoItem'
}

/** CopperGolem.setupAnimationStates (client tick, unless NoAI): the idle head spin and the chest interactions. */
const copperGolem: EntityDriver = {
  tick(tracker, input) {
    if (bit(mobFlags(input), 1)) return
    const tick = tracker.tickCount
    const golemState = enumName(input.meta.copper_golem_state, COPPER_GOLEM_STATES, 'IDLE')
    const field = COPPER_GOLEM_ANIMATIONS[golemState]
    if (!field) {
      // IDLE: the head spins at a random tick 200 to 239 ticks after the last one
      for (const other of Object.values(COPPER_GOLEM_ANIMATIONS)) tracker.stop(other)
      const startTick = numberOf(tracker.memory.idleAnimationStartTick)
      if (startTick === tick) tracker.start('idleAnimationState')
      else if (startTick === 0) tracker.memory.idleAnimationStartTick = tick + 200 + nextInt(tracker, 40)
      if (tick === numberOf(tracker.memory.idleAnimationStartTick) + 10) tracker.memory.idleAnimationStartTick = 0
      return
    }
    tracker.stop('idleAnimationState')
    tracker.memory.idleAnimationStartTick = 0
    for (const other of Object.values(COPPER_GOLEM_ANIMATIONS)) if (other !== field) tracker.stop(other)
    tracker.startIfStopped(field)
  },
  state(state, _tracker, input) {
    state.weathering = enumName(input.meta.weather_state, WEATHER_STATES, 'UNAFFECTED')
    state.copperGolemState = enumName(input.meta.copper_golem_state, COPPER_GOLEM_STATES, 'IDLE')
    // the item on its antenna (the saddle slot), drawn as its block when it is a block item
    state.blockOnAntenna = input.equipment?.saddle ?? null
  }
}

// --- villagers ---

/** Villager: the unhappy counter (40 when it refuses to trade), counted down by the client too. */
const villager: EntityDriver = {
  tick(tracker, input) {
    countDown(tracker, 'unhappy_counter', input.meta.unhappy_counter)
  },
  state(state, tracker, input) {
    state.isUnhappy = counter(tracker, 'unhappy_counter') > 0
    state.villagerData = input.meta.villager_data
  }
}

/** WanderingTrader: the synched unhappy counter (the client does not count it down). */
const wanderingTrader: EntityDriver = {
  state(state, _tracker, input) {
    state.isUnhappy = numberOf(input.meta.unhappy_counter) > 0
  }
}

// --- illagers ---

const isCelebrating = (input: EntityAnimInput) => boolOf(input.meta.is_celebrating)
/** SpellcasterIllager.isCastingSpell on the client: the synched spell id is not NONE (0). */
const isCastingSpell = (input: EntityAnimInput) => numberOf(input.meta.spell_casting) > 0
const isAggressive = (input: EntityAnimInput) => bit(mobFlags(input), 4)
/** LivingEntity.isHolding(item): either hand */
const isHolding = (input: EntityAnimInput, item: string) => itemName(input.equipment?.mainhand) === item || itemName(input.equipment?.offhand) === item

type StatePart = (state: AnimState, tracker: EntityAnimTracker, input: EntityAnimInput) => void

/** IllagerRenderer.extractRenderState with the entity's getArmPose. */
const illager = (armPose: (input: EntityAnimInput) => string, more?: StatePart): EntityDriver => ({
  state(state, tracker, input) {
    state.isRiding = !!input.isPassenger
    state.armPose = armPose(input)
    // CrossbowItem.getChargeDuration: 1.25 s without Quick Charge (the scene does not know enchantments)
    state.maxCrossbowChargeDuration = state.armPose === 'CROSSBOW_CHARGE' ? 25 : 0
    more?.(state, tracker, input)
  }
})

/** SpellcasterIllager.getArmPose */
const evoker = illager(
  input => (isCastingSpell(input) ? 'SPELLCASTING' : isCelebrating(input) ? 'CELEBRATING' : 'CROSSED'),
  (state, _tracker, input) => {
    state.isCastingSpell = isCastingSpell(input)
  }
)

const vindicator = illager(input => (isAggressive(input) ? 'ATTACKING' : isCelebrating(input) ? 'CELEBRATING' : 'CROSSED'))

const pillager = illager(input => {
  if (boolOf(input.meta.is_charging_crossbow)) return 'CROSSBOW_CHARGE'
  if (isHolding(input, 'crossbow')) return 'CROSSBOW_HOLD'
  return isAggressive(input) ? 'ATTACKING' : 'NEUTRAL'
})

type Vec3 = { x: number; y: number; z: number }
const zeros = (): Vec3[] => [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0 }))

type IllusionMemory = { ticks: number; offsets: [Vec3[], Vec3[]] }

const illusionMemory = (tracker: EntityAnimTracker): IllusionMemory => {
  tracker.memory.illusion ??= { ticks: 0, offsets: [zeros(), zeros()] } satisfies IllusionMemory
  return tracker.memory.illusion as IllusionMemory
}

/** Illusioner.getIllusionOffsets(partialTicks) */
const illusionOffsets = (tracker: EntityAnimTracker): Vec3[] => {
  const { ticks, offsets } = illusionMemory(tracker)
  if (ticks <= 0) return offsets[1].map(offset => ({ ...offset }))
  const scale = f(f(ticks - tracker.partialTick) / 3)
  return offsets[1].map((offset, i) => {
    const old = offsets[0][i]!
    return { x: offset.x * (1 - scale) + old.x * scale, y: offset.y * (1 - scale) + old.y * scale, z: offset.z * (1 - scale) + old.z * scale }
  })
}

/** Illusioner: SpellcasterIllager casting or a bow while aggressive; its mirror images (Illusioner.aiStep, client, invisible). */
const illusioner: EntityDriver = {
  ...illager(
    input => (isCastingSpell(input) ? 'SPELLCASTING' : isAggressive(input) ? 'BOW_AND_ARROW' : 'CROSSED'),
    (state, tracker, input) => {
      state.isCastingSpell = isCastingSpell(input)
      state.illusionOffsets = illusionOffsets(tracker)
    }
  ),
  tick(tracker, input) {
    if (!bit(sharedFlags(input), 0x20)) return
    const memory = illusionMemory(tracker)
    memory.ticks = Math.max(0, memory.ticks - 1)
    const hurtTime = numberOf(extra(input).hurtTime)
    const hurtDuration = 10
    if (hurtTime !== 1 && tracker.tickCount % 1200 !== 0) {
      if (hurtTime === hurtDuration - 1) {
        memory.ticks = 3
        memory.offsets = [memory.offsets[1], zeros()]
      }
    } else {
      memory.ticks = 3
      const next: Vec3[] = []
      for (let i = 0; i < 4; i++) {
        const x = f(-6 + nextInt(tracker, 13)) * 0.5
        const y = Math.max(0, nextInt(tracker, 6) - 4)
        const z = f(-6 + nextInt(tracker, 13)) * 0.5
        next.push({ x, y, z })
      }
      memory.offsets = [memory.offsets[1], next]
    }
  }
}

// --- witch ---

/** WitchRenderer: its id (the nose wobble speed) and the item it holds (a potion while drinking). */
const witch: EntityDriver = {
  state(state, _tracker, input) {
    state.entityId = entityIdOf(input) ?? 0
    const mainHand = itemName(input.equipment?.mainhand)
    state.isHoldingItem = !!mainHand && mainHand !== 'air'
    state.isHoldingPotion = mainHand === 'potion'
  }
}

// --- warden ---

/** AngerLevel.ANGRY.getMinimumAnger() */
const ANGRY_MINIMUM_ANGER = 80

const WARDEN_POSE_ANIMATIONS: Record<string, string> = {
  EMERGING: 'emergeAnimationState',
  DIGGING: 'diggingAnimationState',
  ROARING: 'roarAnimationState',
  SNIFFING: 'sniffAnimationState'
}

type WardenMemory = { tendril: number; tendrilO: number; heart: number; heartO: number }

const wardenMemory = (tracker: EntityAnimTracker): WardenMemory => {
  tracker.memory.warden ??= { tendril: 0, tendrilO: 0, heart: 0, heartO: 0 } satisfies WardenMemory
  return tracker.memory.warden as WardenMemory
}

/** Warden: pose callbacks, events 4 (attack), 61 (tendrils), 62 (sonic boom), its client tick (heart beat, tendrils). */
const warden: EntityDriver = {
  tick(tracker, input) {
    const pose = input.pose ?? 'STANDING'
    if (synchedChanged(tracker, 'pose', pose, 'STANDING')) {
      const field = WARDEN_POSE_ANIMATIONS[pose]
      if (field) startAt(tracker, field, callbackTick(tracker))
    }
    const memory = wardenMemory(tracker)
    // getHeartBeatDelay
    const anger = f(numberOf(input.meta.client_anger_level) / ANGRY_MINIMUM_ANGER)
    const delay = 40 - Math.floor(f(Math.min(Math.max(anger, 0), 1) * 30))
    if (tracker.tickCount % delay === 0) memory.heart = 10
    memory.tendrilO = memory.tendril
    if (memory.tendril > 0) memory.tendril--
    memory.heartO = memory.heart
    if (memory.heart > 0) memory.heart--
  },
  event(tracker, id) {
    if (id === 4) {
      tracker.stop('roarAnimationState')
      tracker.start('attackAnimationState')
    } else if (id === 61) {
      wardenMemory(tracker).tendril = 10
    } else if (id === 62) {
      tracker.start('sonicBoomAnimationState')
    }
  },
  state(state, tracker) {
    const memory = wardenMemory(tracker)
    const pt = tracker.partialTick
    state.tendrilAnimation = f(lerp(pt, memory.tendrilO, memory.tendril) / 10)
    state.heartAnimation = f(lerp(pt, memory.heartO, memory.heart) / 10)
  }
}

// --- breeze ---

/** Breeze: pose callbacks (shoot, inhale, slide) and its tick (idle, long jump, slide back). */
const breeze: EntityDriver = {
  tick(tracker, input) {
    const pose = input.pose ?? 'STANDING'
    if (synchedChanged(tracker, 'pose', pose, 'STANDING')) {
      // onSyncedDataUpdated: resetAnimations, then the pose's animation
      const at = callbackTick(tracker)
      for (const field of ['shoot', 'idle', 'inhale', 'longJump']) tracker.stop(field)
      if (pose === 'SHOOTING') startIfStoppedAt(tracker, 'shoot', at)
      else if (pose === 'INHALING') startIfStoppedAt(tracker, 'inhale', at)
      else if (pose === 'SLIDING') startIfStoppedAt(tracker, 'slide', at)
    }
    if (pose === 'LONG_JUMPING') tracker.startIfStopped('longJump')
    tracker.startIfStopped('idle')
    if (pose !== 'SLIDING' && tracker.started('slide')) {
      tracker.start('slideBack')
      tracker.stop('slide')
    }
  }
}

// --- creaking ---

type CreakingMemory = {
  attackTicks: number
  invulnerabilityTicks: number
  deathTime: number
  eyesGlowing: boolean
  nextFlickerTime: number
  walk: WalkAnimation
  lastPosition?: Vec3
}

const creakingMemory = (tracker: EntityAnimTracker): CreakingMemory => {
  tracker.memory.creaking ??= { attackTicks: 0, invulnerabilityTicks: 0, deathTime: 0, eyesGlowing: false, nextFlickerTime: 0, walk: new WalkAnimation() } satisfies CreakingMemory
  return tracker.memory.creaking as CreakingMemory
}

const isDeadOrDying = (input: EntityAnimInput) => typeof input.meta.health === 'number' && input.meta.health <= 0

/**
 * Creaking: attack (event 4) and invulnerability (event 66) timers counted down in aiStep, the animation states they and
 * is_tearing_down drive, the eye flicker while it is torn down, and its own walk animation (Creaking.updateWalkAnimation:
 * 25 times the distance, up to 3).
 */
const creaking: EntityDriver = {
  tick(tracker, input) {
    const memory = creakingMemory(tracker)
    // LivingEntity.baseTick: tickDeath counts while dead (the creaking's own while heart bound and torn down)
    if (isDeadOrDying(input)) memory.deathTime++
    // calculateEntityAnimation (horizontal)
    const position = input.position
    if (position) {
      const last = memory.lastPosition ?? position
      const distance = f(Math.hypot(position.x - last.x, position.z - last.z))
      if (!input.isPassenger && !isDeadOrDying(input)) memory.walk.update(Math.min(f(distance * 25), 3), f(0.4), 1)
      else memory.walk.stop()
      memory.lastPosition = { x: position.x, y: position.y, z: position.z }
    }
    // aiStep
    if (memory.invulnerabilityTicks > 0) memory.invulnerabilityTicks--
    if (memory.attackTicks > 0) memory.attackTicks--
    // setupAnimationStates
    tracker.animateWhen('attackAnimationState', memory.attackTicks > 0)
    tracker.animateWhen('invulnerabilityAnimationState', memory.invulnerabilityTicks > 0)
    tracker.animateWhen('deathAnimationState', boolOf(input.meta.is_tearing_down))
    // checkEyeBlink
    if (memory.deathTime > memory.nextFlickerTime) {
      const min = memory.eyesGlowing ? 2 : Math.trunc(memory.deathTime / 4)
      const max = memory.eyesGlowing ? 8 : Math.trunc(memory.deathTime / 2)
      memory.nextFlickerTime = memory.deathTime + nextInt(tracker, max - min + 1) + min
      memory.eyesGlowing = !memory.eyesGlowing
    }
  },
  event(tracker, id) {
    const memory = creakingMemory(tracker)
    if (id === 66) memory.invulnerabilityTicks = 8
    else if (id === 4) memory.attackTicks = 15
  },
  state(state, tracker, input) {
    const memory = creakingMemory(tracker)
    const pt = tracker.partialTick
    if (!input.isPassenger) {
      state.walkAnimationPos = memory.walk.positionAt(pt)
      state.walkAnimationSpeed = memory.walk.speedAt(pt)
      state.wornHeadAnimationPos = state.walkAnimationPos
    }
    if (boolOf(input.meta.is_tearing_down)) {
      state.deathTime = 0
      state.hasRedOverlay = false
      state.eyesGlowing = memory.eyesGlowing
    } else {
      state.eyesGlowing = boolOf(input.meta.is_active)
    }
    state.canMove = boolOf(input.meta.can_move, true)
  }
}

// --- minecarts ---

/** Java's yaw / pitch in degrees from the prismarine angles. */
const entityRotations = (state: AnimState, input: EntityAnimInput) => {
  state.xRot = f(-input.pitch * RAD_TO_DEG)
  state.yRot = f(180 - input.bodyYaw * RAD_TO_DEG)
}

/** AbstractMinecartRenderer: the hurt wobble (hurt, damage counted down by the client too), the display offset. */
const minecart = (defaultDisplayOffset: number, more: EntityDriver = {}): EntityDriver => ({
  tick(tracker, input) {
    countDown(tracker, 'hurt', input.meta.hurt)
    countDown(tracker, 'damage', input.meta.damage)
    more.tick?.(tracker, input)
  },
  event: more.event,
  state(state, tracker, input) {
    const pt = tracker.partialTick
    entityRotations(state, input)
    const id = entityIdOf(input)
    if (id !== undefined) {
      const seed = BigInt.asIntN(64, BigInt(id) * 493_286_711n)
      state.offsetSeed = BigInt.asIntN(64, seed * seed * 4_392_167_121n + seed * 98_761n)
    }
    state.hurtTime = f(counter(tracker, 'hurt') - pt)
    state.hurtDir = numberOf(input.meta.hurtdir, 1)
    state.damageTime = Math.max(f(counter(tracker, 'damage') - pt), 0)
    state.displayOffset = numberOf(input.meta.display_offset, defaultDisplayOffset)
    more.state?.(state, tracker, input)
  }
})

/** MinecartTNT: primed by event 70 (10 in older versions; no other event of a minecart uses either), the fuse counts down. */
const tntMinecart = minecart(6, {
  tick(tracker) {
    const fuse = tracker.timers.fuse ?? -1
    if (fuse > 0) tracker.timers.fuse = fuse - 1
  },
  event(tracker, id) {
    if (id === 70 || id === 10) tracker.timers.fuse = 80
  },
  state(state, tracker) {
    const fuse = tracker.timers.fuse ?? -1
    state.fuseRemainingInTicks = fuse > -1 ? f(f(fuse - tracker.partialTick) + 1) : -1
  }
})

// --- arrows ---

/** ArrowRenderer: the shake (7 ticks) when it lands (in_ground set after its first tick, while not shaking). */
const arrow = (tippable: boolean): EntityDriver => ({
  tick(tracker, input) {
    const inGround = boolOf(input.meta.in_ground)
    // onSyncedDataUpdated(IN_GROUND): !firstTick && shakeTime <= 0 && inGround
    if (synchedChanged(tracker, 'in_ground', inGround, false) && inGround && callbackTick(tracker) >= 1 && numberOf(tracker.memory.shakeTime) <= 0) tracker.memory.shakeTime = 7
    if (numberOf(tracker.memory.shakeTime) > 0) tracker.memory.shakeTime--
  },
  state(state, tracker, input) {
    entityRotations(state, input)
    state.shake = f(numberOf(tracker.memory.shakeTime) - tracker.partialTick)
    // TippableArrowRenderer: Arrow.getColor() > 0
    if (tippable) state.isTipped = numberOf(input.meta.effect_color, -1) > 0
  }
})

/** ThrownTridentRenderer: its rotations and enchantment glint. */
const trident: EntityDriver = {
  state(state, _tracker, input) {
    entityRotations(state, input)
    state.isFoil = boolOf(input.meta.foil)
  }
}

/**
 * Leash knots and wind charges have no state of their own (EntityRenderState: the wind charge model turns with
 * ageInTicks, which the common state has), so they have no driver.
 */
export const MISC_DRIVERS: Record<string, EntityDriver> = {
  iron_golem: ironGolem,
  snow_golem: snowGolem,
  copper_golem: copperGolem,
  villager,
  wandering_trader: wanderingTrader,
  evoker,
  vindicator,
  pillager,
  illusioner,
  witch,
  warden,
  breeze,
  creaking,
  minecart: minecart(6),
  furnace_minecart: minecart(6),
  spawner_minecart: minecart(6),
  command_block_minecart: minecart(6),
  chest_minecart: minecart(8),
  hopper_minecart: minecart(1),
  tnt_minecart: tntMinecart,
  arrow: arrow(true),
  spectral_arrow: arrow(false),
  trident
}
