import { ENTITY_DRIVERS, registerEntityDrivers, type EntityAnimInput, type EntityAnimTracker, type EntityDriver, type EntityEraAdapter } from '../../entityAnimState'
import { animContext, versionNumber, type AnimState } from '../../setupAnim/types'
import { PI, clamp, f, wrapDegrees, type SinCos } from '../../setupAnim/mth'
import { HUMANOID_DRIVERS } from '../humanoid'
import { MISC_DRIVERS } from '../misc'
import { MONSTERS_DRIVERS, mthAtan2 } from '../monsters'
import { BOAT_NAMES } from '../boats'

/**
 * What the models of 1.8.9 - 1.21.1 read of the monsters, golems, villagers, illagers, armor stands, minecarts and boats
 * (the entity era's setupAnim/entityEra ports, Mojang names, from 1.14.4; the legacy ports, Yarn names, before), from what
 * a client knows of the entity: the keys entityEraState leaves to the entity (each adapter below says which keys and
 * where they come from).
 *
 * Client ticking: what the 26.3 drivers keep is read where the old code does the same (the iron golem's timers, the
 * wither's side heads in the entity era, the slimes' squish, the villager's unhappy counter, the warden's tendrils and
 * animation states, the breeze's animation states). What the old versions compute otherwise, or what the drivers can't
 * see in the old versions (synched data have no names before 1.14, and the export's names, not minecraft-data's, until
 * 1.21: id_moving, id_paddle_left...), is ticked here, once for each client tick the tracker made since the last frame
 * (`catchUp`): the fall flying ticks, 1.13's swim amount, the shulker's peek, the guardian's tail and spikes, the legacy
 * wither's side heads, the boat's paddles.
 *
 * The old versions' entity names (1.8 - 1.12: pig_zombie / zombie_pigman, lava_slime, villager_golem, snow_man / snowman,
 * wither_boss, ender_crystal, minecart_*, evocation_illager...) get the drivers of their 26.3 entities
 * (ENTITY_ERA_MOBS_DRIVER_ALIASES, registered with this module) so that their client ticking and entity events run.
 */

// ---- versions, synched data ----------------------------------------------------------------------------------------

const atLeast = (input: EntityAnimInput, version: string) => versionNumber(input.version) >= versionNumber(version)

/** a version before the entity era (1.8.9 - 1.13.2: legacy ports, synched data by index only) */
const isLegacy = (input: EntityAnimInput) => !atLeast(input, '1.14')

type Version = '1.8' | '1.9' | '1.10' | '1.11' | '1.12' | '1.13'

/** The value of the newest version the input is at least (tables newest first). */
const byVersion = <T>(input: EntityAnimInput, table: Array<[Version, T]>): T | undefined => {
  for (const [version, value] of table) if (atLeast(input, version)) return value
  return undefined
}

/** A synched data index of the entity era, by the state's data names (the export's). */
const indexOf = (state: AnimState, names: readonly string[]): string | undefined => {
  const dataNames = (state.dataNames ?? {}) as Record<string, string>
  for (const name of names) for (const [index, other] of Object.entries(dataNames)) if (other === name) return index
  return undefined
}

type LegacyIndex = (input: EntityAnimInput) => number | undefined

/**
 * A synched data value: in the entity era by its names (the export's data names, then minecraft-data's keys), before by
 * its index in that version (legacyIndex); undefined when the client has none.
 */
const synched = (state: AnimState, input: EntityAnimInput, names: readonly string[], legacyIndex?: LegacyIndex): unknown => {
  if (isLegacy(input)) {
    const index = legacyIndex?.(input)
    return index === undefined ? undefined : input.data[index]
  }
  const index = indexOf(state, names)
  if (index !== undefined && input.data[Number(index)] !== undefined) return input.data[Number(index)]
  for (const name of names) if (input.meta[name] !== undefined) return input.meta[name]
  return undefined
}

/** Overwrites a synched data value the model reads by name (the client's own copy, which its ticking changes). */
const setSynched = (state: AnimState, names: readonly string[], value: unknown) => {
  const index = indexOf(state, names)
  if (index !== undefined) state[`data.${index}`] = value
}

const numberOf = (value: unknown, fallback = 0) =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : typeof value === 'boolean' ? Number(value) : fallback
const isTrue = (value: unknown) => value === true || (typeof value === 'number' && value !== 0)

/** Entity flags (synched data 0 in every version): 2 sneaking, 0x10 swimming (1.13+), 0x80 fall flying (1.9+). */
const sharedFlags = (state: AnimState, input: EntityAnimInput) => numberOf(synched(state, input, ['shared_flags', 'entity_flags'], () => 0))

/** prismarine yaw (radians, 0 north, counterclockwise) as the game's yRot in degrees */
const RAD_TO_DEG = 180 / Math.PI
const toDegrees = (yaw: number) => f(wrapDegrees(f(180 - yaw * RAD_TO_DEG)))

const sinCosCache = new Map<string, SinCos>()
/** Mth.sin / Mth.cos of the version */
const sinCos = (version: string): SinCos => {
  let value = sinCosCache.get(version)
  if (!value) {
    const context = animContext(version)
    value = { sin: context.sin, cos: context.cos }
    sinCosCache.set(version, value)
  }
  return value
}

/** The client's random (tracker.memory.random, which the drivers draw from too), Math.random when unset. */
const nextFloat = (tracker: EntityAnimTracker) => f(((tracker.memory.random as (() => number) | undefined) ?? Math.random)())

// ---- legacy synched data indices (Entity 0 - 4 (5 from 1.10), LivingEntity's after, MobEntity's flags after) ---------

const LEGACY = {
  /** LivingEntity health */
  health: (input: EntityAnimInput) =>
    byVersion(input, [
      ['1.10', 7],
      ['1.8', 6]
    ]),
  /** ZombieEntity child (1.8: a byte, 1 = child): zombies, husks, zombie pigmen, zombie villagers (1.11+) */
  zombieBaby: (input: EntityAnimInput) =>
    byVersion(input, [
      ['1.10', 12],
      ['1.9', 11],
      ['1.8', 12]
    ]),
  /** PassiveEntity child (1.8: the age byte, negative = child) */
  passiveBaby: (input: EntityAnimInput) =>
    byVersion(input, [
      ['1.10', 12],
      ['1.9', 11],
      ['1.8', 12]
    ]),
  /** EndermanEntity carried block (1.8: a short block id, 0 = air; an Optional<BlockState> after) */
  endermanCarried: (input: EntityAnimInput) =>
    byVersion(input, [
      ['1.10', 12],
      ['1.9', 11],
      ['1.8', 16]
    ]),
  /** EndermanEntity angry (1.8: a byte, > 0 angry) */
  endermanAngry: (input: EntityAnimInput) =>
    byVersion(input, [
      ['1.10', 13],
      ['1.9', 12],
      ['1.8', 18]
    ]),
  /** ShulkerEntity peek amount (a byte, 0 - 100), 1.9+ */
  shulkerPeek: (input: EntityAnimInput) =>
    byVersion(input, [
      ['1.10', 14],
      ['1.9', 13]
    ]),
  /** WitherEntity side head targets: heads 1 and 2 track the second and third entity ids */
  witherTarget: (input: EntityAnimInput, head: 0 | 1) =>
    byVersion(input, [
      ['1.10', 13 + head],
      ['1.9', 12 + head],
      ['1.8', 18 + head]
    ]),
  /** GuardianEntity flags (2 spikes retracted / moving, 4 elder; 1.8 an int, a byte to 1.10), a moving boolean from 1.11 */
  guardianFlags: (input: EntityAnimInput) =>
    byVersion(input, [
      ['1.10', 12],
      ['1.9', 11],
      ['1.8', 16]
    ]),
  /** GuardianEntity beam target id */
  guardianTarget: (input: EntityAnimInput) =>
    byVersion(input, [
      ['1.10', 13],
      ['1.9', 12],
      ['1.8', 17]
    ]),
  /** ArmorStandEntity flags (1 small, 4 arms, 8 no base plate) */
  armorStandFlags: (input: EntityAnimInput) =>
    byVersion(input, [
      ['1.10', 11],
      ['1.8', 10]
    ]),
  /** BoatEntity paddle states (left, right), 1.9+ */
  boatPaddle: (input: EntityAnimInput, side: 0 | 1) =>
    byVersion(input, [
      ['1.10', 10 + side],
      ['1.9', 9 + side]
    ])
}

// ---- client ticks between frames -----------------------------------------------------------------------------------

/** What the entity's client ticking keeps here (per tracker). */
type EraMemory = {
  /** the tracker tick the memory was last advanced to */
  tick: number
  /** LivingEntity.fallFlyTicks (field_14548 before 1.14) */
  fallFlyTicks: number
  /** 1.13's LivingEntity swim amount (field_16813) and its previous value (field_16814) */
  swim: number
  swimO: number
  /** LivingEntity.swingingArm (mainHand in 1.9 - 1.13): the hand of the last swing, null before any */
  swungHand: 'MAIN_HAND' | 'OFF_HAND' | null
  [key: string]: any
}

const memoryOf = (tracker: EntityAnimTracker): EraMemory => {
  tracker.memory.entityEra ??= { tick: 0, fallFlyTicks: 0, swim: 0, swimO: 0, swungHand: null } satisfies EraMemory
  return tracker.memory.entityEra as EraMemory
}

/** the most ticks a frame catches up (the tracker advances at most a second a frame) */
const MAX_CATCH_UP = 200

/**
 * Runs `tick` once for each client tick the tracker made since the last frame (the ticks of a frame all see the frame's
 * input, as the tracker's own ticks do), then returns the memory.
 */
const catchUp = (tracker: EntityAnimTracker, tick: (m: EraMemory) => void): EraMemory => {
  const m = memoryOf(tracker)
  const ticks = tracker.tickCount - m.tick
  for (let i = Math.max(0, ticks - MAX_CATCH_UP); i < ticks; i++) tick(m)
  m.tick = tracker.tickCount
  return m
}

/** LivingEntity's client ticking the humanoid models read: the fall flying ticks, 1.13's swim amount. */
const livingTick = (state: AnimState, input: EntityAnimInput, m: EraMemory) => {
  const flags = sharedFlags(state, input)
  // LivingEntity.tick (tickMovement before 1.14): ++fallFlyTicks while fall flying (shared flag 7), else 0
  if (atLeast(input, '1.9') && (flags & 0x80) !== 0) m.fallFlyTicks++
  else m.fallFlyTicks = 0
  // 1.13 LivingEntity.method_15649: the swim amount follows the swimming flag (from 1.14 the tracker's, by the pose)
  m.swimO = m.swim
  m.swim = atLeast(input, '1.13') && (flags & 0x10) !== 0 ? Math.min(1, f(m.swim + f(0.09))) : Math.max(0, f(m.swim - f(0.09)))
}

// ---- living entities -----------------------------------------------------------------------------------------------

type Baby = 'zombie' | 'passive' | 'none'

/** Is the entity a baby: the common state's in the entity era, from the version's synched data before. */
const babyOf = (state: AnimState, input: EntityAnimInput, renderState: AnimState, kind: Baby) => {
  if (!isLegacy(input) || kind === 'none') return !!renderState.isBaby
  if (kind === 'zombie') return isTrue(synched(state, input, [], LEGACY.zombieBaby))
  const value = synched(state, input, [], LEGACY.passiveBaby)
  // 1.8: the age byte (negative: a baby); 1.9+: a boolean
  return atLeast(input, '1.9') ? isTrue(value) : numberOf(value) < 0
}

/**
 * LivingEntityRenderer draws a baby's walk position three times as fast (`if (entity.isBaby()) limbSwing *= 3.0F`, in
 * every version 1.8.9 - 1.21.1). The tracker scales it from 1.19.4 (its positionScale); before, it is done here, unless
 * the tracker already did.
 */
const babyWalk = (state: AnimState, tracker: EntityAnimTracker, baby: boolean) => {
  if (baby && tracker.walk.walk.positionScale === 1) state.walkAnimationPos = f(state.walkAnimationPos * 3)
}

/**
 * LivingEntity.getTicksUsingItem: the use duration minus the ticks remaining, which the synched data callback starts
 * (0) and each tick counts (1 after the first tick; the tracker's useTicks is 0 then).
 */
const ticksUsingItem = (tracker: EntityAnimTracker) => (tracker.using ? tracker.useTicks + 1 : 0)

/**
 * CrossbowItem.getChargeDuration: 25 ticks, 5 less per Quick Charge level. Enchantments aren't in EntityAnimInput: the
 * scene's `quickChargeLevel` when it gives one, else none.
 */
const crossbowChargeDuration = (input: EntityAnimInput) => Math.max(0, 25 - 5 * numberOf((input as { quickChargeLevel?: unknown }).quickChargeLevel))

/**
 * What the humanoid models (zombies, skeletons, piglins, endermen, vexes) read beyond the common state:
 * - entity era: entity.fallFlyTicks, entity.swingingArm (the last swing's hand, null before any), entity.ticksUsingItem,
 *   item.crossbowChargeDuration, item.chest;
 * - legacy: model.child (a baby, from the version's synched data), model.sneaking (entity flag 2), 1.8's int arm poses
 *   (model.leftArmPose / rightArmPose 0: the renderer sets them for players only), entity.field_14548 (fall flying ticks),
 *   entity.mainHand (the last swing's hand), entity.velocityX/Y/Z, entity.field_16813 / field_16814 (1.13's swim amount);
 * and the baby walk (babyWalk).
 */
const humanoid = (state: AnimState, tracker: EntityAnimTracker, input: EntityAnimInput, renderState: AnimState, baby: Baby, m: EraMemory) => {
  if (tracker.swing.swinging) m.swungHand = tracker.swing.hand
  const isBaby = babyOf(state, input, renderState, baby)
  babyWalk(state, tracker, isBaby)
  if (!isLegacy(input)) {
    state['entity.fallFlyTicks'] = m.fallFlyTicks
    state['entity.swingingArm'] = m.swungHand
    state['entity.ticksUsingItem'] = ticksUsingItem(tracker)
    state['item.crossbowChargeDuration'] = crossbowChargeDuration(input)
    state['item.chest'] = input.equipment?.chest ?? null
    return
  }
  const velocity = input.velocity ?? { x: 0, y: 0, z: 0 }
  state['model.child'] = isBaby
  state['model.sneaking'] = (sharedFlags(state, input) & 2) !== 0
  if (!atLeast(input, '1.9')) {
    state['model.leftArmPose'] = 0
    state['model.rightArmPose'] = 0
  }
  state['entity.field_14548'] = m.fallFlyTicks
  state['entity.mainHand'] = m.swungHand
  state['entity.velocityX'] = velocity.x
  state['entity.velocityY'] = velocity.y
  state['entity.velocityZ'] = velocity.z
  state['entity.field_16813'] = m.swim
  state['entity.field_16814'] = m.swimO
}

/** An adapter of a humanoid-modelled mob, with more of its own. */
const humanoidMob =
  (baby: Baby, more?: EntityEraAdapter): EntityEraAdapter =>
  (state, tracker, input, renderState) => {
    const m = catchUp(tracker, memory => livingTick(state, input, memory))
    humanoid(state, tracker, input, renderState, baby, m)
    more?.(state, tracker, input, renderState)
  }

// ---- piglins, endermen -----------------------------------------------------------------------------------------------

/** PiglinModel poses piglins, brutes and zombified piglins by the entity type (state.entityType). */
const piglinType: EntityEraAdapter = (state, _tracker, input) => {
  state.entityType = input.name
}

/**
 * EndermanRenderer: model.carrying (the carried block data holds a block) and model.creepy (1.14+); legacy
 * model.carryingBlock and model.angry.
 */
const enderman: EntityEraAdapter = (state, _tracker, input) => {
  const carried = synched(state, input, ['carry_state', 'carried_block'], LEGACY.endermanCarried)
  const carrying = (typeof carried === 'number' && carried > 0) || (carried !== null && typeof carried === 'object')
  if (isLegacy(input)) {
    state['model.carryingBlock'] = carrying
    const angry = synched(state, input, [], LEGACY.endermanAngry)
    state['model.angry'] = atLeast(input, '1.9') ? isTrue(angry) : numberOf(angry) > 0
  } else {
    state['model.carrying'] = carrying
    state['model.creepy'] = isTrue(synched(state, input, ['creepy']))
  }
}

// ---- villagers, witches, illagers ------------------------------------------------------------------------------------

/**
 * Villager: a baby (legacy model.child) walks three times as fast; Villager.tick counts the unhappy counter down on the
 * client too (the villager driver's count, written over the synched value the model reads).
 */
const villager: EntityEraAdapter = (state, tracker, input, renderState) => {
  const baby = babyOf(state, input, renderState, 'passive')
  babyWalk(state, tracker, baby)
  if (isLegacy(input)) {
    state['model.child'] = baby
    return
  }
  const counted = tracker.memory['count:unhappy_counter']
  if (typeof counted === 'number') setSynched(state, ['unhappy_counter'], counted)
}

/** WanderingTrader: the synched unhappy counter as it is (its tick doesn't count it down); a baby's walk. */
const wanderingTrader: EntityEraAdapter = (state, tracker, input, renderState) => {
  babyWalk(state, tracker, babyOf(state, input, renderState, 'none'))
}

/**
 * WitchRenderer: the model holds an item while the main hand isn't empty: model.holdingItem (1.14+), model.field_5133
 * (1.8 - 1.12), model.field_20606 (1.13).
 */
const witch: EntityEraAdapter = (state, _tracker, input) => {
  const mainHand = input.equipment?.mainhand?.replace(/^minecraft:/, '')
  const holding = !!mainHand && mainHand !== 'air'
  if (!isLegacy(input)) state['model.holdingItem'] = holding
  else if (atLeast(input, '1.13')) state['model.field_20606'] = holding
  else state['model.field_5133'] = holding
}

/**
 * Illagers: the entity era's IllagerModel reads entity.ticksUsingItem and entity.crossbowChargeDuration (a pillager
 * charging its crossbow; the entity class is entityEraState's); the legacy illager model the entity type (entityType).
 */
const illager: EntityEraAdapter = (state, tracker, input) => {
  if (isLegacy(input)) {
    state.entityType = input.name
    return
  }
  state['entity.ticksUsingItem'] = ticksUsingItem(tracker)
  state['entity.crossbowChargeDuration'] = crossbowChargeDuration(input)
}

// ---- golems ----------------------------------------------------------------------------------------------------------

/**
 * IronGolem's attack and flower timers (the iron golem driver's: entity events 4 and 11 (34 from 1.13), counted down in
 * aiStep / tickMovement as in every version): entity.attackAnimationTick / offerFlowerTick, legacy
 * entity.attackTicksLeft / lookingAtVillagerTicksLeft.
 */
const ironGolem: EntityEraAdapter = (state, tracker, input) => {
  const attack = tracker.timers.attackAnimationTick ?? 0
  const flower = tracker.timers.offerFlowerTick ?? 0
  if (isLegacy(input)) {
    state['entity.attackTicksLeft'] = attack
    state['entity.lookingAtVillagerTicksLeft'] = flower
  } else {
    state['entity.attackAnimationTick'] = attack
    state['entity.offerFlowerTick'] = flower
  }
}

// ---- slimes, shulkers, withers, guardians ----------------------------------------------------------------------------

/**
 * Slime.tick (every version 1.8.9 - 1.21.1): squish eases toward the target, then oSquish = squish, so the two are equal
 * (no interpolation, unlike 26.3's). The squish is the magma cube driver's (the same update): entity.squish / oSquish,
 * legacy entity.stretch / lastStretch.
 */
const magmaCube: EntityEraAdapter = (state, tracker, input) => {
  const squish = numberOf(tracker.memory.squish)
  if (isLegacy(input)) {
    state['entity.stretch'] = squish
    state['entity.lastStretch'] = squish
  } else {
    state['entity.squish'] = squish
    state['entity.oSquish'] = squish
  }
}

/**
 * Shulker's peek, ticked here (the driver can't see the legacy data, and resets it on teleports from 1.17 only): it eases
 * toward the synched peek by 0.05 a tick; from 1.17, Shulker.setPos zeroes the client's copy of the peek when the block
 * position changes. entity.currentPeekAmountO / currentPeekAmount, legacy entity.field_14767 / field_14768.
 */
const shulker: EntityEraAdapter = (state, tracker, input) => {
  const m = catchUp(tracker, memory => {
    const raw = numberOf(synched(state, input, ['peek'], LEGACY.shulkerPeek))
    if (raw !== memory.rawPeekData) {
      memory.rawPeekData = raw
      memory.rawPeek = raw
    }
    if (atLeast(input, '1.17') && input.position) {
      const { x, y, z } = input.position
      const pos = `${Math.floor(x)},${Math.floor(y + 0.5)},${Math.floor(z)}`
      if (memory.blockPos !== undefined && memory.blockPos !== pos) memory.rawPeek = 0
      memory.blockPos = pos
    }
    memory.peek ??= 0
    memory.peekO = memory.peek
    const target = f(numberOf(memory.rawPeek) * f(0.01))
    if (memory.peek > target) memory.peek = clamp(f(memory.peek - f(0.05)), target, 1)
    else if (memory.peek < target) memory.peek = clamp(f(memory.peek + f(0.05)), 0, target)
  })
  if (isLegacy(input)) {
    state['entity.field_14767'] = m.peekO ?? 0
    state['entity.field_14768'] = m.peek ?? 0
  } else {
    state['entity.currentPeekAmountO'] = m.peekO ?? 0
    state['entity.currentPeekAmount'] = m.peek ?? 0
  }
}

/** WitherEntity.getNextAngle / WitherBoss.rotlerp */
const witherRotlerp = (a: number, b: number, max: number) => {
  let diff = wrapDegrees(f(b - a))
  if (diff > max) diff = max
  if (diff < -max) diff = -max
  return f(a + diff)
}

/** (float) Math.PI, the double the legacy code divides by */
const PI_F = f(Math.PI)

/**
 * The wither's side heads. The entity era reads the wither driver's (WitherBoss.aiStep, the same code from 1.14):
 * entity.yRotHeads / xRotHeads. Before, the driver can't see the targets (no data names): WitherEntity.tickMovement is
 * ticked here with the legacy math (degrees as atan2 * 180 / (float) PI; 1.8 turns the head angle by / 180F * PI):
 * entity.sideHeadYaws / sideHeadPitches ([head 1, head 2], degrees), and entity.bodyYaw.
 */
const wither: EntityEraAdapter = (state, tracker, input) => {
  if (!isLegacy(input)) {
    state['entity.yRotHeads'] = [...((tracker.memory.yHeadRots as number[] | undefined) ?? [0, 0])]
    state['entity.xRotHeads'] = [...((tracker.memory.xHeadRots as number[] | undefined) ?? [0, 0])]
    return
  }
  const m = catchUp(tracker, memory => {
    const yaws = (memory.sideHeadYaws ??= [0, 0]) as number[]
    const pitches = (memory.sideHeadPitches ??= [0, 0]) as number[]
    const { sin, cos } = sinCos(input.version)
    const bodyYaw = toDegrees(input.bodyYaw)
    const position = input.position ?? { x: 0, y: 0, z: 0 }
    for (const i of [0, 1] as const) {
      const id = numberOf(synched(state, input, [], v => LEGACY.witherTarget(v, i)))
      const target = id > 0 ? input.lookupEntity?.(id) : undefined
      if (target) {
        // getHeadX / getHeadY / getHeadZ of head i + 1
        const turn = f(bodyYaw + 180 * i)
        const angle = atLeast(input, '1.9') ? f(turn * f(Math.PI / 180)) : f(f(turn / 180) * PI)
        const dx = target.x - (position.x + cos(angle) * 1.3)
        const dy = target.eyeY - (position.y + 2.2)
        const dz = target.z - (position.z + sin(angle) * 1.3)
        const horizontal = f(Math.sqrt(dx * dx + dz * dz))
        const yaw = f(f((mthAtan2(dz, dx) * 180) / PI_F) - 90)
        const pitch = f(-((mthAtan2(dy, horizontal) * 180) / PI_F))
        pitches[i] = witherRotlerp(pitches[i]!, pitch, 40)
        yaws[i] = witherRotlerp(yaws[i]!, yaw, 10)
      } else {
        yaws[i] = witherRotlerp(yaws[i]!, bodyYaw, 10)
      }
    }
  })
  state['entity.sideHeadYaws'] = [...((m.sideHeadYaws as number[] | undefined) ?? [0, 0])]
  state['entity.sideHeadPitches'] = [...((m.sideHeadPitches as number[] | undefined) ?? [0, 0])]
  state['entity.bodyYaw'] = toDegrees(input.bodyYaw)
}

type Vec3 = { x: number; y: number; z: number }

/** Is the guardian an elder: the elder guardian (1.11+), a flag (4) of the guardian's before. */
const isElder = (state: AnimState, input: EntityAnimInput) =>
  input.name === 'elder_guardian' || (!atLeast(input, '1.11') && (numberOf(synched(state, input, [], LEGACY.guardianFlags)) & 4) !== 0)

/**
 * Guardian.aiStep / GuardianEntity.tickMovement, client side (the same in every version), ticked here (the aquatic
 * driver reads minecraft-data's moving / attack_target keys, which the export names id_moving / id_attack_target until
 * 1.21): the tail speeds up when moving in water and flails out of it, the spikes draw in while moving, stick out while
 * still and jitter out of water. The constructor starts the tail at a random angle.
 *
 * Entity era: entity.clientSideTailAnimation(O), entity.clientSideSpikesAnimation(O), eyePosition (the guardian's eye),
 * cameraEyePosition (the camera's, when the scene gives it), attackTargetEyePosition (the attack target's eye, null when
 * the client doesn't have it). Legacy (Yarn swaps the names: spikesExtension is the tail, tailAngle the spikes):
 * entity.spikesExtension / prevSpikesExtension, entity.tailAngle / prevTailAngle, entity.prevPitch, entity.prevHeadYaw,
 * cameraOffset and beamTargetOffset (the camera's / the beam target's eye minus the guardian's).
 */
const guardian: EntityEraAdapter = (state, tracker, input) => {
  const start = memoryOf(tracker)
  if (start.tail === undefined) {
    start.tail = nextFloat(tracker)
    start.tailO = start.tail
    start.tailSpeed = 0
    start.spikes = 0
    start.spikesO = 0
  }
  const m = catchUp(tracker, memory => {
    const health = synched(state, input, ['health'], LEGACY.health)
    if (typeof health === 'number' && health <= 0) return
    const inWater = !!input.isInWater
    const flags = synched(state, input, ['id_moving', 'moving'], LEGACY.guardianFlags)
    const moving = !isLegacy(input) || atLeast(input, '1.11') ? isTrue(flags) : (numberOf(flags) & 2) !== 0
    memory.tailO = memory.tail
    if (!inWater) memory.tailSpeed = 2
    else if (moving) memory.tailSpeed = memory.tailSpeed < 0.5 ? 4 : f(memory.tailSpeed + f(f(0.5 - memory.tailSpeed) * f(0.1)))
    else memory.tailSpeed = f(memory.tailSpeed + f(f(0.125 - memory.tailSpeed) * f(0.2)))
    memory.tail = f(memory.tail + memory.tailSpeed)
    memory.spikesO = memory.spikes
    if (!inWater) memory.spikes = nextFloat(tracker)
    else if (moving) memory.spikes = f(memory.spikes + f(f(0 - memory.spikes) * 0.25))
    else memory.spikes = f(memory.spikes + f(f(1 - memory.spikes) * f(0.06)))
  })
  const position = input.position ?? { x: 0, y: 0, z: 0 }
  // getEyeHeight: half the height (0.85, the elder's 1.9975)
  const eye: Vec3 = { x: position.x, y: position.y + (isElder(state, input) ? f(0.998_75) : f(0.425)), z: position.z }
  const targetId = numberOf(synched(state, input, ['id_attack_target', 'attack_target'], LEGACY.guardianTarget))
  const target = targetId !== 0 ? input.lookupEntity?.(targetId) : undefined
  const targetEye = target ? { x: target.x, y: target.eyeY, z: target.z } : null
  const camera = input.cameraEyePosition
  if (!isLegacy(input)) {
    state['entity.clientSideTailAnimation'] = m.tail
    state['entity.clientSideTailAnimationO'] = m.tailO
    state['entity.clientSideSpikesAnimation'] = m.spikes
    state['entity.clientSideSpikesAnimationO'] = m.spikesO
    state.eyePosition = eye
    if (camera) state.cameraEyePosition = { x: camera.x, y: camera.y, z: camera.z }
    state.attackTargetEyePosition = targetEye
    return
  }
  state['entity.spikesExtension'] = m.tail
  state['entity.prevSpikesExtension'] = m.tailO
  state['entity.tailAngle'] = m.spikes
  state['entity.prevTailAngle'] = m.spikesO
  state['entity.prevPitch'] = state.xRot
  state['entity.prevHeadYaw'] = toDegrees(input.headYaw)
  if (camera) state.cameraOffset = [camera.x - eye.x, camera.y - eye.y, camera.z - eye.z]
  if (targetEye) state.beamTargetOffset = [targetEye.x - eye.x, targetEye.y - eye.y, targetEye.z - eye.z]
}

// ---- warden, breeze --------------------------------------------------------------------------------------------------

/**
 * An AnimationState of 1.19 - 1.21.1 started at a tick: AnimationState.start(tick) set lastTime = tick * 1000 / 20 and
 * accumulatedTime 0, and each updateTime(ageInTicks, speed) adds (now - lastTime) * speed. Given as {lastTime: now,
 * accumulatedTime: the ms since the start}, the model's updateTime adds nothing more and plays it at that time.
 */
const animationState = (start: number | null | undefined, ageInTicks: number) => {
  if (start === null || start === undefined) return null
  const now = Math.floor(f(f(ageInTicks * 1000) / 20))
  return { lastTime: now, accumulatedTime: now - start * 50 }
}

const WARDEN_ANIMATIONS = ['attackAnimationState', 'sonicBoomAnimationState', 'diggingAnimationState', 'emergeAnimationState', 'roarAnimationState', 'sniffAnimationState']

/**
 * Warden (1.19+, the same client code as 26.3's driver): the animation states its pose changes and entity events start
 * (entity.<state>AnimationState), the tendrils (entity.tendrilAnimation / tendrilAnimationO, ints: the model divides by 10).
 */
const warden: EntityEraAdapter = (state, tracker) => {
  for (const field of WARDEN_ANIMATIONS) state[`entity.${field}`] = animationState(tracker.animationStates[field], state.ageInTicks)
  const memory = tracker.memory.warden as { tendril?: number; tendrilO?: number } | undefined
  state['entity.tendrilAnimation'] = memory?.tendril ?? 0
  state['entity.tendrilAnimationO'] = memory?.tendrilO ?? 0
}

/** Breeze (1.20.4 experimental, 1.20.5+; the same client code as 26.3's driver): entity.shoot, slide, slideBack, longJump. */
const breeze: EntityEraAdapter = (state, tracker) => {
  for (const field of ['shoot', 'slide', 'slideBack', 'longJump', 'idle', 'inhale']) state[`entity.${field}`] = animationState(tracker.animationStates[field], state.ageInTicks)
}

// ---- armor stands, minecarts, boats ----------------------------------------------------------------------------------

/**
 * ArmorStand: the base plate turns by the stand's own yaw (entity.yRot / yRotO, legacy entity.yaw: the body yaw, which
 * is the stand's yRot); a small stand is a baby (legacy model.child; the entity era's from the driver's isBaby).
 */
const armorStand: EntityEraAdapter = (state, _tracker, input) => {
  const yaw = toDegrees(input.bodyYaw)
  if (!isLegacy(input)) {
    state['entity.yRot'] = yaw
    state['entity.yRotO'] = yaw
    return
  }
  state['entity.yaw'] = yaw
  state['model.child'] = (numberOf(synched(state, input, [], LEGACY.armorStandFlags)) & 1) !== 0
}

/** MinecartRenderer: setupAnim(entity, 0, 0, -0.1F, 0, 0) (1.15 - 1.17; render(..., -0.1F, ...) in 1.14.4), all 0 from 1.18. */
const minecart: EntityEraAdapter = (state, _tracker, input) => {
  state.walkAnimationPos = 0
  state.walkAnimationSpeed = 0
  state.ageInTicks = atLeast(input, '1.18') ? 0 : f(-0.1)
  state.yRot = 0
  state.xRot = 0
}

/** (float) (Math.PI / 8): the paddles' step a tick from 1.12 */
const PADDLE_STEP = f(Math.PI / 8)

/** Mth.clampedLerp(double start, double end, double delta) */
const clampedLerpDouble = (start: number, end: number, delta: number) => (delta < 0 ? start : delta > 1 ? end : start + delta * (end - start))

/**
 * Boat.getPaddleState: the synched paddle state while someone controls the boat (the client's own boat: what it is
 * paddled with, the boatPaddleLeft / boatPaddleRight render hints).
 */
const paddleState = (state: AnimState, input: EntityAnimInput, side: 0 | 1) => {
  const hints = input.renderHints
  if (hints && (hints.boatPaddleLeft !== undefined || hints.boatPaddleRight !== undefined)) return !!(side === 0 ? hints.boatPaddleLeft : hints.boatPaddleRight)
  const names = side === 0 ? ['id_paddle_left', 'paddle_left'] : ['id_paddle_right', 'paddle_right']
  const value = synched(state, input, names, v => LEGACY.boatPaddle(v, side))
  const passengers = hints?.passengerIds ?? hints?.boatPassengerIds
  return isTrue(value) && (!passengers || passengers.length > 0)
}

/**
 * Boats (1.9+; 1.8's has no paddles). Boat.tick turns each paddle while its state holds, else back to 0: by
 * (float) (PI / 8) a tick from 1.12, by 0.01 (double) before (the 1.9 - 1.11 model multiplies the phase by 40), ticked
 * here (the boat driver's paddle state reads minecraft-data's keys, which the export names id_paddle_left /
 * id_paddle_right until 1.21).
 * - 1.15+: BoatRenderer calls setupAnim(boat, partialTicks, 0, -0.1F, 0, 0): walkAnimationPos is the partial tick;
 *   BoatModel reads entity.paddlePositions and the synched paddle states (written with the controlling passenger
 *   condition of getPaddleState).
 * - 1.9 - 1.14.4: the paddles are posed in the model's render (BoatEntityModel.method_12219 / BoatModel.animatePaddle),
 *   not setAngles: entity.paddlePositions (legacy entity.paddlePhases) and entity.rowingTimes ([left, right]:
 *   Boat.getRowingTime / BoatEntity.interpolatePaddlePhase at the partial tick, what that code reads) are given for it.
 */
const boat: EntityEraAdapter = (state, tracker, input) => {
  if (!atLeast(input, '1.9')) return
  const step = atLeast(input, '1.12') ? PADDLE_STEP : 0.01
  const m = catchUp(tracker, memory => {
    const positions = (memory.paddlePositions ??= [0, 0]) as number[]
    for (const side of [0, 1] as const) positions[side] = paddleState(state, input, side) ? f(positions[side]! + step) : 0
  })
  const positions = [...((m.paddlePositions as number[] | undefined) ?? [0, 0])]
  const pt = tracker.partialTick
  if (atLeast(input, '1.15')) {
    state.walkAnimationPos = pt
    state.walkAnimationSpeed = 0
    state.ageInTicks = f(-0.1)
    state.yRot = 0
    state.xRot = 0
    state['entity.paddlePositions'] = positions
    setSynched(state, ['id_paddle_left', 'paddle_left'], paddleState(state, input, 0))
    setSynched(state, ['id_paddle_right', 'paddle_right'], paddleState(state, input, 1))
    return
  }
  state[isLegacy(input) ? 'entity.paddlePhases' : 'entity.paddlePositions'] = positions
  state['entity.rowingTimes'] = ([0, 1] as const).map(side => (paddleState(state, input, side) ? f(clampedLerpDouble(positions[side]! - step, positions[side]!, pt)) : 0))
}

// ---- the adapters ----------------------------------------------------------------------------------------------------

const zombie = humanoidMob('zombie')
const piglin = humanoidMob('none', piglinType)
const undead = humanoidMob('none')

const MINECARTS = [
  'minecart',
  'chest_minecart',
  'furnace_minecart',
  'hopper_minecart',
  'spawner_minecart',
  'tnt_minecart',
  'command_block_minecart',
  // 1.11 - 1.12
  'commandblock_minecart',
  // 1.8 - 1.10
  'minecart_rideable',
  'minecart_chest',
  'minecart_furnace',
  'minecart_hopper',
  'minecart_spawner',
  'minecart_tnt',
  'minecart_command_block'
]

/**
 * By entity name, every version's (minecraft-data's, snake cased, as the export names them). The entities whose models
 * read nothing beyond the common state have none: creeper, spider, cave spider, slime, blaze, ghast, phantom (entity.id is
 * common), silverfish, endermite, shulker bullet (its yaw and pitch are the driver's render state), snow golem, ender
 * dragon and end crystal (posed in render; the crystal's age is its driver's).
 */
export const ENTITY_ERA_MOBS_ADAPTERS: Record<string, EntityEraAdapter> = {
  // zombies: babies from the zombie child data
  zombie,
  husk: zombie,
  drowned: zombie,
  zombie_villager: zombie,
  pig_zombie: zombie,
  zombie_pigman: zombie,
  giant: undead,
  // PiglinModel (1.16+)
  zombified_piglin: piglin,
  piglin,
  piglin_brute: piglin,
  skeleton: undead,
  stray: undead,
  wither_skeleton: undead,
  bogged: undead,
  enderman: humanoidMob('none', enderman),
  vex: undead,
  magma_cube: magmaCube,
  lava_slime: magmaCube,
  shulker,
  wither,
  wither_boss: wither,
  guardian,
  elder_guardian: guardian,
  iron_golem: ironGolem,
  villager_golem: ironGolem,
  // 1.13.2's minecraft-data name
  'iron_golem}': ironGolem,
  villager,
  wandering_trader: wanderingTrader,
  witch,
  evoker: illager,
  vindicator: illager,
  pillager: illager,
  illusioner: illager,
  evocation_illager: illager,
  vindication_illager: illager,
  illusion_illager: illager,
  warden,
  breeze,
  armor_stand: armorStand,
  armorstand: armorStand,
  ...Object.fromEntries(MINECARTS.map(name => [name, minecart])),
  ...Object.fromEntries(BOAT_NAMES.map(name => [name, boat]))
}

/** The old versions' entity names, with the drivers of their 26.3 entities (client ticking and entity events). */
export const ENTITY_ERA_MOBS_DRIVER_ALIASES: Record<string, EntityDriver | undefined> = {
  pig_zombie: HUMANOID_DRIVERS.zombie,
  zombie_pigman: HUMANOID_DRIVERS.zombie,
  armorstand: HUMANOID_DRIVERS.armor_stand,
  lava_slime: MONSTERS_DRIVERS.magma_cube,
  wither_boss: MONSTERS_DRIVERS.wither,
  ender_crystal: MONSTERS_DRIVERS.end_crystal,
  endercrystal: MONSTERS_DRIVERS.end_crystal,
  villager_golem: MISC_DRIVERS.iron_golem,
  'iron_golem}': MISC_DRIVERS.iron_golem,
  snow_man: MISC_DRIVERS.snow_golem,
  snowman: MISC_DRIVERS.snow_golem,
  evocation_illager: MISC_DRIVERS.evoker,
  vindication_illager: MISC_DRIVERS.vindicator,
  illusion_illager: MISC_DRIVERS.illusioner,
  commandblock_minecart: MISC_DRIVERS.command_block_minecart,
  minecart_rideable: MISC_DRIVERS.minecart,
  minecart_chest: MISC_DRIVERS.chest_minecart,
  minecart_furnace: MISC_DRIVERS.furnace_minecart,
  minecart_hopper: MISC_DRIVERS.hopper_minecart,
  minecart_spawner: MISC_DRIVERS.spawner_minecart,
  minecart_tnt: MISC_DRIVERS.tnt_minecart,
  minecart_command_block: MISC_DRIVERS.command_block_minecart
}

registerEntityDrivers(
  Object.fromEntries(
    Object.entries(ENTITY_ERA_MOBS_DRIVER_ALIASES).filter((entry): entry is [string, EntityDriver] => !!entry[1] && !ENTITY_DRIVERS[entry[0]])
  )
)
