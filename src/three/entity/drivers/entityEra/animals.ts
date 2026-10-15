import type { EntityAnimInput, EntityAnimTracker, EntityEraAdapter } from '../../entityAnimState'
import { clamp, f, floatSinCos, lerp } from '../../setupAnim/mth'
import { versionNumber, type AnimState } from '../../setupAnim/types'

/**
 * What the animals' models of 1.8.9 - 1.21.1 read of the entity (see entityEraState): their client side fields
 * (`entity.<field>`: Mojang names from 1.14.4, legacy Yarn names before), the age their renderer passes instead of the
 * entity's (LivingEntityRenderer.getBob: a chicken's or parrot's flap, a wolf's tail angle, a squid's tentacle angle),
 * the client's own copies of synched data it changes itself (a panda's counters and flags) and synched enums by their
 * constant names (a sniffer's or armadillo's state).
 *
 * Quantities the 26.3 drivers keep and the old versions compute the same way are read from `tracker.memory` (the
 * drivers see the entity events: a sheep eating, a goat ramming, a ravager attacking, a wolf shaking, a rabbit jumping,
 * a squid's tentacle restart...), converted where the old code differs (a rabbit's 10 tick jump, a fox's crouch capped
 * at 3). The rest is the version's own client ticking, run here tick by tick up to the tracker's tick count (catching up
 * the ticks since the state was last built, with the latest input): horses (whose synched flags the drivers read by
 * 26.3's names), pandas, polar bears, camels, a wolf's head tilt, chickens' and parrots' flapping (in doubles before
 * 1.18), bats' and 1.19.4 sniffers' animation states, a 1.19 frog's walk and swim, the last tick's motion and rotations.
 *
 * Inputs a client does not have get what the game's client has without them: not thundering (a scared panda: unless
 * the scene gives `isThundering`), no jukebox (a parrot's party: unless the scene gives `recordPlayingNearby`), not in a
 * bubble column, not under water, the tail swish unseeded (the client's own random), the panda's random start of eating
 * left to the server.
 */

const MAX_CATCH_UP = 100

const atLeast = (input: EntityAnimInput, version: string) => versionNumber(input.version) >= versionNumber(version)

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : typeof value === 'boolean' ? Number(value) : fallback

const bool = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : fallback)

const random = (tracker: EntityAnimTracker): number => ((tracker.memory.random as (() => number) | undefined) ?? Math.random)()

/** The index of the synched data of that name in the export's names (index -> name), the last one when asked. */
const dataIndex = (state: AnimState, name: string, last = false): string | undefined => {
  let found: string | undefined
  for (const [index, other] of Object.entries((state.dataNames ?? {}) as Record<string, string>)) {
    if (other !== name) continue
    if (!last) return index
    found = index
  }
  return found
}

/**
 * A synched value: by the export's name for the version (1.14+), then by its index in the legacy versions (no names
 * before 1.14), then by minecraft-data's key.
 */
const synched = (state: AnimState, input: EntityAnimInput, name: string, legacyIndex?: number, last = false): unknown => {
  const index = dataIndex(state, name, last)
  if (index !== undefined && input.data[Number(index)] !== undefined) return input.data[Number(index)]
  if (legacyIndex !== undefined && !atLeast(input, '1.14')) return input.data[legacyIndex]
  return input.meta[name]
}

/** Overrides the synched value the state holds (the client's own copy, an enum by name). */
const setData = (state: AnimState, name: string, value: unknown) => {
  const index = dataIndex(state, name)
  if (index !== undefined) state[`data.${index}`] = value
}

/** A synched enum by its constant name (numbers are ordinals; names as given). */
const enumName = (value: unknown, names: readonly string[], fallback: string) => {
  if (typeof value === 'string') return Number.isNaN(Number(value)) ? value.toUpperCase() : (names[Number(value)] ?? fallback)
  if (typeof value === 'number' || typeof value === 'bigint') return names[Number(value)] ?? fallback
  return fallback
}

/** A Vec3 the models read either way: as [x, y, z] and as {x, y, z}. */
const vec3 = (x: number, y: number, z: number) => {
  const vector = [x, y, z] as number[] & { x: number; y: number; z: number }
  vector.x = x
  vector.y = y
  vector.z = z
  return vector
}

const isAlive = (input: EntityAnimInput) => typeof input.meta.health !== 'number' || input.meta.health > 0

// ---------------------------------------------------------------------------------------------------------------------
// tick catch-up, animation states

type Ticked = { eraTick: number }

/**
 * The entity's own client ticking, run here: `step` once per client tick the tracker counted since the last run (the
 * first run starts at most MAX_CATCH_UP ticks back), with the tick's count (the entity's tickCount during it).
 */
const ticked = <M extends object>(tracker: EntityAnimTracker, key: string, init: () => M, step: (memory: M, tickCount: number) => void): M => {
  const slot = `era:${key}`
  let memory = tracker.memory[slot] as (M & Ticked) | undefined
  if (!memory) {
    memory = init() as M & Ticked
    memory.eraTick = Math.max(0, tracker.tickCount - MAX_CATCH_UP)
    tracker.memory[slot] = memory
  }
  while (memory.eraTick < tracker.tickCount) {
    memory.eraTick++
    step(memory, memory.eraTick)
  }
  return memory
}

/** AnimationState.updateTime's time: Mth.lfloor(ageInTicks * 1000.0F / 20.0F) (as the ported models compute it). */
const animationTime = (ageInTicks: number) => Math.floor(f(f(ageInTicks * 1000) / 20))

/**
 * An AnimationState before 1.21.2 ({lastTime, accumulatedTime} in ms, null when stopped) from the tick it started at:
 * start(tickCount) sets lastTime to tickCount * 50 and the accumulated time to 0, each frame's updateTime(ageInTicks,
 * speed) adds (now - lastTime) * speed. The state is brought up to this frame (the model's own updateTime then adds 0),
 * so a speed that changes from frame to frame (a 1.19.4 sniffer's walk, a 1.19 frog's) accumulates as in the game.
 */
const animationState = (tracker: EntityAnimTracker, key: string, start: number | null | undefined, ageInTicks: number, speed = 1) => {
  const slot = `era:animation:${key}`
  if (start === null || start === undefined) {
    delete tracker.memory[slot]
    return null
  }
  let memory = tracker.memory[slot] as { start: number; lastTime: number; accumulatedTime: number } | undefined
  if (!memory || memory.start !== start) memory = tracker.memory[slot] = { start, lastTime: start * 50, accumulatedTime: 0 }
  const now = animationTime(ageInTicks)
  memory.accumulatedTime += Math.trunc(f(f(now - memory.lastTime) * speed))
  memory.lastTime = now
  return { lastTime: memory.lastTime, accumulatedTime: memory.accumulatedTime }
}

/** Converts the animation states the drivers keep (start ticks by field) into entity fields of the same names. */
const driverAnimationStates = (state: AnimState, tracker: EntityAnimTracker, fields: string[]) => {
  for (const field of fields) state[`entity.${field}`] = animationState(tracker, field, tracker.animationStates[field], state.ageInTicks)
}

// ---------------------------------------------------------------------------------------------------------------------
// what every animal has: the last tick's motion and rotations, legacy field names

type History = { x: number; y: number; z: number; xOld: number; yOld: number; zOld: number; yRot: number; yRotO: number; xRot: number; xRotO: number; seen: boolean }

const RAD_TO_DEG = 180 / Math.PI

/** Entity.setOldPosAndRot then the tick's movement: the position and rotations of this tick and of the last one. */
const history = (tracker: EntityAnimTracker, input: EntityAnimInput) =>
  ticked<History>(
    tracker,
    'history',
    () => ({ x: 0, y: 0, z: 0, xOld: 0, yOld: 0, zOld: 0, yRot: 0, yRotO: 0, xRot: 0, xRotO: 0, seen: false }),
    m => {
      const p = input.position ?? { x: m.x, y: m.y, z: m.z }
      const yRot = f(180 - input.bodyYaw * RAD_TO_DEG)
      const xRot = f(-input.pitch * RAD_TO_DEG)
      if (!m.seen) {
        m.x = p.x
        m.y = p.y
        m.z = p.z
        m.yRot = yRot
        m.xRot = xRot
        m.seen = true
      }
      m.xOld = m.x
      m.yOld = m.y
      m.zOld = m.z
      m.yRotO = m.yRot
      m.xRotO = m.xRot
      m.x = p.x
      m.y = p.y
      m.z = p.z
      m.yRot = yRot
      m.xRot = xRot
    }
  )

/** Entity.getDeltaMovement: the velocity the server sent, else the last tick's movement. */
const deltaMovement = (tracker: EntityAnimTracker, input: EntityAnimInput) => {
  const h = history(tracker, input)
  if (input.velocity) return vec3(input.velocity.x, input.velocity.y, input.velocity.z)
  return vec3(h.x - h.xOld, h.y - h.yOld, h.z - h.zOld)
}

/** AgeableEntity's baby data before names: 1.8 the age byte at 12 (negative), 1.9 a boolean at 11, 1.10+ at 12. */
const legacyBaby = (input: EntityAnimInput) => {
  if (!atLeast(input, '1.9')) return num(input.data[12]) < 0
  return bool(input.data[atLeast(input, '1.10') ? 12 : 11])
}

const AGEABLE = new Set([
  'cow',
  'mushroom_cow',
  'mooshroom',
  'pig',
  'sheep',
  'polar_bear',
  'llama',
  'entity_horse',
  'horse',
  'donkey',
  'mule',
  'skeleton_horse',
  'zombie_horse',
  'wolf',
  'ozelot',
  'ocelot',
  'rabbit',
  'chicken',
  'parrot',
  'turtle'
])

/**
 * The fields every animal's model may read: Entity.isVehicle, the delta movement ([x, y, z] and {x, y, z}: the server's
 * velocity, else the last tick's movement), not in a bubble column, and before 1.14 the legacy Yarn names of the
 * entity's fields (pitch, yaw, bodyYaw, headYaw and their prev*, touchingWater / insideWater, rider (1.8) /
 * hasPassengers, velocityX/Y/Z) and the model's child field (AgeableEntity's data).
 */
const common: EntityEraAdapter = (state, tracker, input) => {
  const motion = deltaMovement(tracker, input)
  state['entity.deltaMovement'] = motion
  state['entity.isVehicle'] = !!input.isVehicle
  state['entity.isInBubbleColumn'] = false
  if (atLeast(input, '1.14')) return
  const xRot = state['entity.xRot'] as number
  state['entity.pitch'] = xRot
  state['entity.prevPitch'] = state['entity.xRotO'] ?? xRot
  state['entity.yaw'] = state['entity.yBodyRot']
  state['entity.prevYaw'] = state['entity.yBodyRotO']
  state['entity.bodyYaw'] = state['entity.yBodyRot']
  state['entity.prevBodyYaw'] = state['entity.yBodyRotO']
  state['entity.headYaw'] = state['entity.yHeadRot']
  state['entity.prevHeadYaw'] = state['entity.yHeadRotO']
  state['entity.touchingWater'] = !!input.isInWater
  state['entity.insideWater'] = !!input.isInWater
  state['entity.hasPassengers'] = !!input.isVehicle
  state['entity.rider'] = input.isVehicle ? true : null
  state['entity.velocityX'] = motion.x
  state['entity.velocityY'] = motion.y
  state['entity.velocityZ'] = motion.z
  if (AGEABLE.has(input.name)) {
    const baby = legacyBaby(input)
    state['model.child'] = baby
    state['model.young'] = baby
  }
}

/** An adapter that fills the common fields first. */
const animal =
  (adapter?: EntityEraAdapter): EntityEraAdapter =>
  (state, tracker, input, renderState) => {
    common(state, tracker, input, renderState)
    adapter?.(state, tracker, input, renderState)
  }

// ---------------------------------------------------------------------------------------------------------------------
// quadrupeds

/** Sheep.eatAnimationTick (SheepEntity.eatGrassTimer): entity event 10 sets 40, aiStep counts down (the driver's). */
const sheep = animal((state, tracker) => {
  const tick = (tracker.memory.sheep?.eatAnimationTick as number | undefined) ?? 0
  state['entity.eatAnimationTick'] = tick
  state['entity.eatGrassTimer'] = tick
})

/**
 * PolarBear.tick (client): the stand animation goes 0 to 6 while DATA_STANDING_ID is set (1.10 - 1.13: field_15034 and
 * its last tick's field_15033; the standing boolean at 13).
 */
const polarBear = animal((state, tracker, input) => {
  const m = ticked(
    tracker,
    'polar_bear',
    () => ({ stand: 0, standO: 0 }),
    m => {
      m.standO = m.stand
      m.stand = clamp(m.stand + (bool(synched(state, input, 'standing', 13)) ? 1 : -1), 0, 6)
    }
  )
  state['entity.clientSideStandAnimation'] = m.stand
  state['entity.clientSideStandAnimationO'] = m.standO
  state['entity.field_15034'] = m.stand
  state['entity.field_15033'] = m.standO
})

const PANDA_GENES = ['NORMAL', 'LAZY', 'WORRIED', 'PLAYFUL', 'BROWN', 'WEAK', 'AGGRESSIVE']

/** Panda.getVariant: a recessive main gene shows only when the hidden gene is the same. */
const pandaVariant = (state: AnimState, input: EntityAnimInput) => {
  const main = PANDA_GENES[num(synched(state, input, 'main_gene'))] ?? 'NORMAL'
  const hidden = PANDA_GENES[num(synched(state, input, 'hidden_gene'))] ?? 'NORMAL'
  if (main === 'BROWN' || main === 'WEAK') return main === hidden ? main : 'NORMAL'
  return main
}

type PandaData = { flags: number; unhappy: number; sneeze: number; eat: number }

type PandaMemory = {
  sitAmount: number
  sitAmountO: number
  onBackAmount: number
  onBackAmountO: number
  rollAmount: number
  rollAmountO: number
  rollCounter: number
  received: Record<string, unknown>
  local: PandaData
}

const PANDA_DATA = [
  ['flags', 'id_flags'],
  ['unhappy', 'unhappy_counter'],
  ['sneeze', 'sneeze_counter'],
  ['eat', 'eat_counter']
] as const

/**
 * Panda.tick (1.14+), which the client runs on its own copy of the synched counters and flags (a value the server sends
 * replaces the copy): the unhappy counter counts down, a sneeze counts up to 20, a roll ends after 32 ticks, sitting,
 * lying on the back and rolling ease their amounts, eating stops without a held item or when not sitting. The id flags:
 * 2 sneezing, 4 rolling, 8 sitting, 16 on its back. Thunder is a level state the client has but EntityAnimInput not
 * (`isThundering` when the scene gives it): a worried panda isn't scared without it. The client's random start of eating
 * (random.nextInt(80) == 1) can't be reproduced: eating is the server's.
 */
const panda = animal((state, tracker, input) => {
  const thundering = !!(input as { isThundering?: boolean }).isThundering
  const worried = pandaVariant(state, input) === 'WORRIED'
  const read = (memory: PandaMemory) => {
    for (const [key, name] of PANDA_DATA) {
      const value = synched(state, input, name) ?? (name === 'id_flags' ? input.meta.flags : undefined)
      if (!(key in memory.received) || memory.received[key] !== value) {
        memory.received[key] = value
        memory.local[key] = num(value)
      }
    }
    return memory.local
  }
  const m = ticked<PandaMemory>(
    tracker,
    'panda',
    () => ({
      sitAmount: 0,
      sitAmountO: 0,
      onBackAmount: 0,
      onBackAmountO: 0,
      rollAmount: 0,
      rollAmountO: 0,
      rollCounter: 0,
      received: {},
      local: { flags: 0, unhappy: 0, sneeze: 0, eat: 0 }
    }),
    m => {
      const d = read(m)
      const setFlag = (flag: number, on: boolean) => (d.flags = on ? d.flags | flag : d.flags & ~flag)
      if (worried) {
        if (thundering && !input.isInWater) {
          setFlag(8, true)
          d.eat = 0
        } else if (!(d.eat > 0)) {
          setFlag(8, false)
        }
      }
      if (d.unhappy > 0) d.unhappy--
      if (d.flags & 2) {
        d.sneeze++
        if (d.sneeze > 20) {
          setFlag(2, false)
          d.sneeze = 0
        }
      }
      if (d.flags & 4) {
        m.rollCounter++
        if (m.rollCounter > 32) setFlag(4, false)
      } else {
        m.rollCounter = 0
      }
      m.sitAmountO = m.sitAmount
      m.sitAmount = d.flags & 8 ? Math.min(1, f(m.sitAmount + f(0.15))) : Math.max(0, f(m.sitAmount - f(0.19)))
      if (!input.equipment?.mainhand || !(d.flags & 8)) d.eat = 0
      if (d.eat > 0) d.eat++
      m.onBackAmountO = m.onBackAmount
      m.onBackAmount = d.flags & 16 ? Math.min(1, f(m.onBackAmount + f(0.15))) : Math.max(0, f(m.onBackAmount - f(0.19)))
      m.rollAmountO = m.rollAmount
      m.rollAmount = d.flags & 4 ? Math.min(1, f(m.rollAmount + f(0.15))) : Math.max(0, f(m.rollAmount - f(0.19)))
    }
  )
  const d = read(m)
  setData(state, 'id_flags', d.flags)
  setData(state, 'unhappy_counter', d.unhappy)
  setData(state, 'sneeze_counter', d.sneeze)
  setData(state, 'eat_counter', d.eat)
  state['entity.sitAmount'] = m.sitAmount
  state['entity.sitAmountO'] = m.sitAmountO
  state['entity.onBackAmount'] = m.onBackAmount
  state['entity.onBackAmountO'] = m.onBackAmountO
  state['entity.rollAmount'] = m.rollAmount
  state['entity.rollAmountO'] = m.rollAmountO
  state['entity.isScared'] = worried && thundering
  // Panda.tick: xRot = 0 while sitting (the head pitch the renderer passes, lerped from xRotO, is 0)
  if (d.flags & 8) {
    state.xRot = 0
    state['entity.xRot'] = 0
    state['entity.xRotO'] = 0
  }
})

/** Goat.lowerHeadTick (entity events 58 / 59, aiStep: the driver's). */
const goat = animal((state, tracker) => {
  state['entity.lowerHeadTick'] = (tracker.memory.goat?.lowerHeadTick as number | undefined) ?? 0
})

/** Hoglin / Zoglin.attackAnimationRemainingTicks (entity event 4 sets 10, aiStep counts down: the driver's). */
const hoglin = animal((state, tracker) => {
  state['entity.attackAnimationRemainingTicks'] = (tracker.memory.attackAnimationRemainingTicks as number | undefined) ?? 0
})

/** Ravager attackTick, stunnedTick and roarTick (entity events 4 and 39, aiStep: the driver's, the same since 1.14). */
const ravager = animal((state, tracker) => {
  const m = (tracker.memory.ravager ?? {}) as { attackTick?: number; stunnedTick?: number; roarTick?: number }
  state['entity.attackTick'] = m.attackTick ?? 0
  state['entity.stunnedTick'] = m.stunnedTick ?? 0
  state['entity.roarTick'] = m.roarTick ?? 0
})

// ---------------------------------------------------------------------------------------------------------------------
// horses

type HorseMemory = { tail: number; eat: number; eatO: number; stand: number; standO: number; mouth: number; mouthO: number }

/**
 * AbstractHorse (HorseBaseEntity before 1.11): aiStep's tail swish (1 in 200 each tick, the client's own random), tick's
 * tail counter, and the eat, stand (angry before 1.11) and mouth animations eased toward the synched flags. The flags:
 * an int at 16 (1.8), a byte at 12 (1.9) / 13 (1.10 - 1.13), id_flags since; eating 32, standing 64, open mouth 128
 * before 1.11, 16, 32, 64 since. The fields: eatingGrassAnimationProgress / angryAnimationProgress /
 * eatingAnimationProgress (and their last*) with field_6897 as the tail counter before 1.11, field_15502 - field_15507
 * and field_15509 in 1.11 - 1.13, eatAnim / standAnim / mouthAnim (and their *O) and tailCounter since.
 */
const horse = animal((state, tracker, input) => {
  const new111 = atLeast(input, '1.11')
  const [eatBit, standBit, mouthBit] = new111 ? [16, 32, 64] : [32, 64, 128]
  const legacyIndex = atLeast(input, '1.10') ? 13 : atLeast(input, '1.9') ? 12 : 16
  const m = ticked<HorseMemory>(
    tracker,
    'horse',
    () => ({ tail: 0, eat: 0, eatO: 0, stand: 0, standO: 0, mouth: 0, mouthO: 0 }),
    m => {
      const flags = num(synched(state, input, 'id_flags', legacyIndex) ?? input.meta.flags)
      // aiStep (inside super.tick): moveTail
      if (Math.floor(random(tracker) * 200) === 0) m.tail = 1
      if (m.tail > 0 && ++m.tail > 8) m.tail = 0
      m.eatO = m.eat
      if (flags & eatBit) {
        m.eat = f(m.eat + f(f(f(1 - m.eat) * f(0.4)) + f(0.05)))
        if (m.eat > 1) m.eat = 1
      } else {
        m.eat = f(m.eat + f(f(f(0 - m.eat) * f(0.4)) - f(0.05)))
        if (m.eat < 0) m.eat = 0
      }
      m.standO = m.stand
      if (flags & standBit) {
        m.eat = 0
        m.eatO = 0
        m.stand = f(m.stand + f(f(f(1 - m.stand) * f(0.4)) + f(0.05)))
        if (m.stand > 1) m.stand = 1
      } else {
        const s = m.stand
        m.stand = f(s + f(f(f(f(f(f(f(0.8) * s) * s) * s) - s) * f(0.6)) - f(0.05)))
        if (m.stand < 0) m.stand = 0
      }
      m.mouthO = m.mouth
      if (flags & mouthBit) {
        m.mouth = f(m.mouth + f(f(f(1 - m.mouth) * f(0.7)) + f(0.05)))
        if (m.mouth > 1) m.mouth = 1
      } else {
        m.mouth = f(m.mouth + f(f(f(0 - m.mouth) * f(0.7)) - f(0.05)))
        if (m.mouth < 0) m.mouth = 0
      }
    }
  )
  if (atLeast(input, '1.14')) {
    state['entity.eatAnim'] = m.eat
    state['entity.eatAnimO'] = m.eatO
    state['entity.standAnim'] = m.stand
    state['entity.standAnimO'] = m.standO
    state['entity.mouthAnim'] = m.mouth
    state['entity.mouthAnimO'] = m.mouthO
    state['entity.tailCounter'] = m.tail
  } else if (new111) {
    state['entity.field_15502'] = m.eat
    state['entity.field_15503'] = m.eatO
    state['entity.field_15504'] = m.stand
    state['entity.field_15505'] = m.standO
    state['entity.field_15506'] = m.mouth
    state['entity.field_15507'] = m.mouthO
    state['entity.field_15509'] = m.tail
  } else {
    state['entity.eatingGrassAnimationProgress'] = m.eat
    state['entity.lastEatingGrassAnimationProgress'] = m.eatO
    state['entity.angryAnimationProgress'] = m.stand
    state['entity.lastAngryAnimationProgress'] = m.standO
    state['entity.eatingAnimationProgress'] = m.mouth
    state['entity.lastEatingAnimationProgress'] = m.mouthO
    state['entity.field_6897'] = m.tail
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// camels, sniffers, armadillos

const CAMEL_ANIMATIONS = ['sitAnimationState', 'sitPoseAnimationState', 'sitUpAnimationState', 'idleAnimationState', 'dashAnimationState']

type CamelMemory = {
  dashing: boolean
  dashCooldown: number
  idleAnimationTimeout: number
  starts: Record<string, number | null>
  gameTimeOffset?: number
  receivedDash?: boolean
  receivedPoseChange?: number
}

/**
 * Camel (1.19.4 - 1.21.1): the dash flag (synched; the client ends it itself once landed, which runs the data callback
 * too) and the dash cooldown its callback starts (not on the first tick), and setupAnimationStates: the idle every 80 to
 * 119 ticks, sitting down, sat and standing up by the pose time (game time minus the last pose change tick: the
 * `gameTime` input, else worked out from the pose changes seen), the dash. The dash ends below a cooldown of 55 on the
 * ground or in water in 1.19.4, below 50 on the ground, in water or riding in 1.20 - 1.20.2, in any liquid since 1.20.3.
 */
const camel = animal((state, tracker, input) => {
  const dash = bool(synched(state, input, 'dash'))
  const lastPoseChange = num(synched(state, input, 'last_pose_change_tick'))
  const inWater = !!input.isInWater
  const inLiquid = inWater || !!(input as { isInLava?: boolean }).isInLava || !!(input as { isInLiquid?: boolean }).isInLiquid
  const m = ticked<CamelMemory>(
    tracker,
    'camel',
    () => ({ dashing: false, dashCooldown: 0, idleAnimationTimeout: 0, starts: {} }),
    (m, tickCount) => {
      const started = (field: string) => m.starts[field] !== null && m.starts[field] !== undefined
      const start = (field: string) => (m.starts[field] = tickCount)
      const startIfStopped = (field: string) => started(field) || start(field)
      const stop = (field: string) => (m.starts[field] = null)
      const animateWhen = (field: string, on: boolean) => (on ? startIfStopped(field) : stop(field))
      const dashChanged = () => (m.dashCooldown = m.dashCooldown === 0 ? 55 : m.dashCooldown)
      // the synched data received before this tick: the client's value changes when it differs (the callback runs,
      // except during the first tick)
      if (m.receivedDash !== dash) {
        const first = m.receivedDash === undefined
        m.receivedDash = dash
        if (m.dashing !== dash) {
          m.dashing = dash
          if (!first) dashChanged()
        }
      }
      if (m.receivedPoseChange !== lastPoseChange) {
        const first = m.receivedPoseChange === undefined
        m.receivedPoseChange = lastPoseChange
        if (!first) {
          // the change happened now (the game time is its magnitude) or before (standUpInstantly writes game time - 53)
          const offset = Math.abs(lastPoseChange) - tickCount
          m.gameTimeOffset = m.gameTimeOffset === undefined ? offset : Math.max(m.gameTimeOffset, offset)
        }
      }
      // Camel.tick
      const ends = atLeast(input, '1.20')
        ? m.dashCooldown < 50 && (!!input.onGround || (atLeast(input, '1.20.3') ? inLiquid : inWater) || !!input.isPassenger)
        : m.dashCooldown < 55 && (!!input.onGround || inWater)
      if (m.dashing && ends) {
        m.dashing = false
        dashChanged()
      }
      if (m.dashCooldown > 0) m.dashCooldown--
      // setupAnimationStates
      if (m.idleAnimationTimeout <= 0) {
        m.idleAnimationTimeout = Math.floor(random(tracker) * 40) + 80
        start('idleAnimationState')
      } else {
        m.idleAnimationTimeout--
      }
      const sitting = lastPoseChange < 0
      const gameTime = (input as { gameTime?: number }).gameTime
      const poseTime =
        typeof gameTime === 'number'
          ? gameTime - Math.abs(lastPoseChange)
          : m.gameTimeOffset === undefined
            ? Number.MAX_SAFE_INTEGER
            : tickCount + m.gameTimeOffset - Math.abs(lastPoseChange)
      if (poseTime < 0 !== sitting) {
        stop('sitUpAnimationState')
        stop('dashAnimationState')
        if (sitting && poseTime < 40 && poseTime >= 0) {
          startIfStopped('sitAnimationState')
          stop('sitPoseAnimationState')
        } else {
          stop('sitAnimationState')
          startIfStopped('sitPoseAnimationState')
        }
      } else {
        stop('sitAnimationState')
        stop('sitPoseAnimationState')
        animateWhen('dashAnimationState', m.dashing)
        animateWhen('sitUpAnimationState', poseTime < (sitting ? 40 : 52) && poseTime >= 0)
      }
    }
  )
  for (const field of CAMEL_ANIMATIONS) state[`entity.${field}`] = animationState(tracker, `camel:${field}`, m.starts[field], state.ageInTicks)
  state['entity.dashCooldown'] = m.dashCooldown
})

const SNIFFER_STATES = ['IDLING', 'FEELING_HAPPY', 'SCENTING', 'SNIFFING', 'SEARCHING', 'DIGGING', 'RISING']
const SNIFFER_ANIMATIONS = ['diggingAnimationState', 'sniffingAnimationState', 'risingAnimationState', 'feelingHappyAnimationState', 'scentingAnimationState']
/** 1.19.4: the searching state had its own animation state too (stopped with the others) */
const SNIFFER_STARTS_1_19_4: Record<string, string> = {
  FEELING_HAPPY: 'feelingHappyAnimationState',
  SCENTING: 'scentingAnimationState',
  SNIFFING: 'sniffingAnimationState',
  SEARCHING: 'searchingAnimationState',
  DIGGING: 'diggingAnimationState',
  RISING: 'risingAnimationState'
}

/**
 * Sniffer: its synched state by name (the model compares it), and the animation states. 1.20+: the state's callback
 * (the driver's). 1.19.4: the callback stops every state animation (searching too) and starts the new state's, and
 * Sniffer.tick plays the walk while moving on land or in water (on the ground or in water, horizontally faster than
 * 1.0E-3 per tick; in water faster than 3.2E-3); its panic walk is a server brain memory (never on the client). The
 * walk and searching animations run at the speed the model gives them (from the horizontal motion).
 */
const sniffer = animal((state, tracker, input) => {
  const name = enumName(synched(state, input, 'state'), SNIFFER_STATES, 'IDLING')
  setData(state, 'state', name)
  if (atLeast(input, '1.20')) {
    driverAnimationStates(state, tracker, SNIFFER_ANIMATIONS)
    return
  }
  const motion = state['entity.deltaMovement'] as { x: number; z: number }
  const m = ticked(
    tracker,
    'sniffer',
    () => ({ state: undefined as string | undefined, starts: {} as Record<string, number | null> }),
    (m, tickCount) => {
      if (m.state !== name) {
        const first = m.state === undefined
        m.state = name
        if (!first || name !== 'IDLING') {
          for (const field of Object.values(SNIFFER_STARTS_1_19_4)) m.starts[field] = null
          const field = SNIFFER_STARTS_1_19_4[name]
          // the callback ran when the data arrived, between ticks: at the last tick's tickCount
          if (field) m.starts[field] = tickCount - 1
        }
      }
      const inWater = !!input.isInWater
      const horizontal = motion.x * motion.x + motion.z * motion.z
      const moving = (!!input.onGround || inWater) && horizontal > 1e-6
      const movingOnLand = moving && !inWater
      const movingInWater = moving && inWater && horizontal > 9.999_999_999_999_999e-6
      m.starts.panicAnimationState = null
      if (movingOnLand || movingInWater) m.starts.walkingAnimationState ??= tickCount
      else m.starts.walkingAnimationState = null
    }
  )
  const speed = Math.min(f(f(motion.x * motion.x + motion.z * motion.z) * 9000), 1)
  const speeds: Record<string, number> = { walkingAnimationState: speed, panicAnimationState: f(speed * 2), searchingAnimationState: speed }
  for (const field of [...SNIFFER_ANIMATIONS, 'searchingAnimationState', 'walkingAnimationState', 'panicAnimationState']) {
    state[`entity.${field}`] = animationState(tracker, `sniffer:${field}`, m.starts[field], state.ageInTicks, speeds[field] ?? 1)
  }
})

const ARMADILLO_STATES = ['IDLE', 'ROLLING', 'SCARED', 'UNROLLING']

/** Armadillo: its state by name, the ticks in it and the roll up / peek / roll out animation states (the driver's). */
const armadillo = animal((state, tracker, input) => {
  setData(state, 'armadillo_state', enumName(synched(state, input, 'armadillo_state'), ARMADILLO_STATES, 'IDLE'))
  state['entity.inStateTicks'] = (tracker.memory.armadillo?.inStateTicks as number | undefined) ?? 0
  driverAnimationStates(state, tracker, ['rollUpAnimationState', 'rollOutAnimationState', 'peekAnimationState'])
})

// ---------------------------------------------------------------------------------------------------------------------
// small animals

/**
 * Wolf: the renderer passes the tail angle as the age (WolfRenderer.getBob = getTailAngle): angry 1.5393804, tame
 * (0.55 - (maxHealth - health) * 0.02) * PI — the wolf's own synched health before 1.15 (1.8: a float at 18, 1.9: 14,
 * 1.10 - 1.14: 15 / its second `health`), the living health after; (0.55 - (maxHealth - health) / maxHealth * 0.4) * PI
 * from 1.20.5 — else PI / 5. Angry: the tameable flags' 2 before 1.16, the remaining anger time since. The max health
 * is an attribute: the input's when given, else a tame wolf's (20, 40 from 1.20.5).
 * The head tilt (interestedAngle; legacy field_3727 / field_3728) eases toward the synched interest (1.8: the byte at
 * 19 equal to 1, 1.9: 15, 1.10 - 1.13: 16; only while alive since 1.14). The shake (shakeAnim; legacy field_3731 /
 * field_3732) is the driver's (entity event 8): before 1.16 the client itself stops it while wet (`isInWater`), not
 * the server's event 56.
 */
const wolf = animal((state, tracker, input) => {
  const legacy = !atLeast(input, '1.14')
  const flags = num(synched(state, input, 'flags', atLeast(input, '1.10') ? 13 : atLeast(input, '1.9') ? 12 : 16))
  const interestedValue = synched(state, input, 'interested', atLeast(input, '1.10') ? 16 : atLeast(input, '1.9') ? 15 : 19)
  const interested = atLeast(input, '1.9') ? bool(interestedValue) : num(interestedValue) === 1
  const m = ticked(
    tracker,
    'wolf',
    () => ({ interestedAngle: 0, interestedAngleO: 0, shakeCancelled: false, lastShake: 0 }),
    m => {
      if (!legacy && !isAlive(input)) return
      m.interestedAngleO = m.interestedAngle
      if (interested) m.interestedAngle = f(m.interestedAngle + f(f(1 - m.interestedAngle) * f(0.4)))
      else m.interestedAngle = f(m.interestedAngle + f(f(0 - m.interestedAngle) * f(0.4)))
    }
  )
  // the shake
  const driver = (tracker.memory.wolf ?? {}) as { isShaking?: boolean; shakeAnim?: number; shakeAnimO?: number }
  let shake = driver.shakeAnim ?? 0
  let shakeO = driver.shakeAnimO ?? 0
  if (!atLeast(input, '1.16')) {
    // a new shake (event 8) starts from 0 again; being wet stops the current one on the client
    if (!driver.isShaking || shake < m.lastShake) m.shakeCancelled = false
    if (driver.isShaking && input.isInWater) m.shakeCancelled = true
    m.lastShake = shake
    if (m.shakeCancelled) {
      shake = 0
      shakeO = 0
    }
  }
  // the tail angle
  const angry = atLeast(input, '1.16') ? num(synched(state, input, 'remaining_anger_time')) > 0 : (flags & 2) !== 0
  let tail: number
  if (angry) {
    tail = f(1.539_380_4)
  } else if (flags & 4) {
    const maxHealth = f(input.maxHealth ?? (atLeast(input, '1.20.5') ? 40 : 20))
    if (atLeast(input, '1.20.5')) {
      const health = f(num(synched(state, input, 'health'), maxHealth))
      tail = f(f(f(0.55) - f(f(f(maxHealth - health) / maxHealth) * f(0.4))) * f(Math.PI))
    } else {
      const health = atLeast(input, '1.15')
        ? synched(state, input, 'health')
        : synched(state, input, 'health', atLeast(input, '1.10') ? 15 : atLeast(input, '1.9') ? 14 : 18, true)
      tail = f(f(f(0.55) - f(f(maxHealth - f(num(health, maxHealth))) * f(0.02))) * f(Math.PI))
    }
  } else {
    tail = f(Math.PI / 5)
  }
  state.ageInTicks = tail
  if (legacy) {
    state['entity.field_3727'] = m.interestedAngle
    state['entity.field_3728'] = m.interestedAngleO
    state['entity.field_3731'] = shake
    state['entity.field_3732'] = shakeO
  } else {
    state['entity.interestedAngle'] = m.interestedAngle
    state['entity.interestedAngleO'] = m.interestedAngleO
    state['entity.shakeAnim'] = shake
    state['entity.shakeAnimO'] = shakeO
  }
})

/** Cat: the lie down and relax amounts of Cat.handleLieDown (the driver's, the same since 1.14). */
const cat = animal((state, tracker) => {
  const m = (tracker.memory.cat ?? {}) as Record<string, number | undefined>
  for (const field of ['lieDownAmount', 'lieDownAmountO', 'lieDownAmountTail', 'lieDownAmountOTail', 'relaxStateOneAmount', 'relaxStateOneAmountO']) {
    state[`entity.${field}`] = m[field] ?? 0
  }
})

/**
 * Fox: the head tilt (interestedAngle, the driver's) and the crouch amount, which grows by 0.2 a tick up to 3 before
 * 1.21.2 (the driver's goes up to 5: the same values, capped at 3).
 */
const fox = animal((state, tracker) => {
  const m = (tracker.memory.fox ?? {}) as { interestedAngle?: number; interestedAngleO?: number; crouchAmount?: number; crouchAmountO?: number }
  state['entity.interestedAngle'] = m.interestedAngle ?? 0
  state['entity.interestedAngleO'] = m.interestedAngleO ?? 0
  state['entity.crouchAmount'] = Math.min(m.crouchAmount ?? 0, 3)
  state['entity.crouchAmountO'] = Math.min(m.crouchAmountO ?? 0, 3)
})

/**
 * Rabbit: entity event 1 starts a jump of 10 ticks before 1.21.2 (the driver's lasts 15): jumpTicks counts up to 10,
 * then both reset — the driver's ticks while they are at most 10.
 */
const rabbit = animal((state, tracker) => {
  const m = (tracker.memory.rabbit ?? {}) as { jumpTicks?: number; jumpDuration?: number }
  const ticks = m.jumpTicks ?? 0
  const jumping = (m.jumpDuration ?? 0) !== 0 && ticks <= 10
  state['entity.jumpTicks'] = jumping ? ticks : 0
  state['entity.jumpDuration'] = jumping ? 10 : 0
})

type FlapMemory = { flap: number; oFlap: number; flapSpeed: number; oFlapSpeed: number; flapping: number }

/**
 * Chicken.aiStep / Parrot.calculateFlapping: the wings speed up while `flying`, in doubles before 1.18 (floats after).
 * The renderer passes (sin(flap) + 1) * flapSpeed, lerped, as the age.
 */
const flapAge = (tracker: EntityAnimTracker, input: EntityAnimInput, state: AnimState, key: string, flying: () => boolean) => {
  const doubles = !atLeast(input, '1.18')
  const m = ticked<FlapMemory>(
    tracker,
    key,
    () => ({ flap: 0, oFlap: 0, flapSpeed: 0, oFlapSpeed: 0, flapping: 1 }),
    m => {
      const onGround = input.onGround !== false
      m.oFlap = m.flap
      m.oFlapSpeed = m.flapSpeed
      m.flapSpeed = doubles ? f(m.flapSpeed + (flying() ? 4 : -1) * 0.3) : f(m.flapSpeed + f((flying() ? 4 : -1) * f(0.3)))
      m.flapSpeed = clamp(m.flapSpeed, 0, 1)
      if (!onGround && m.flapping < 1) m.flapping = 1
      m.flapping = doubles ? f(m.flapping * 0.9) : f(m.flapping * f(0.9))
      m.flap = f(m.flap + f(m.flapping * 2))
    }
  )
  const pt = state.partialTick as number
  return f(f(floatSinCos.sin(lerp(pt, m.oFlap, m.flap)) + 1) * lerp(pt, m.oFlapSpeed, m.flapSpeed))
}

/** Chicken: the flap (flying: off the ground) as the age. */
const chicken = animal((state, tracker, input) => {
  state.ageInTicks = flapAge(tracker, input, state, 'chicken', () => input.onGround === false)
})

/**
 * Parrot: the flap (flying: off the ground in 1.12 - 1.13, off the ground and not riding since) as the age, and the
 * party (dancing to a jukebox: field_15567, partyParrot) — the jukebox the driver keeps from the scene's
 * `recordPlayingNearby`, none without it.
 */
const parrot = animal((state, tracker, input) => {
  const ridingStops = atLeast(input, '1.14')
  state.ageInTicks = flapAge(tracker, input, state, 'parrot', () => input.onGround === false && !(ridingStops && input.isPassenger))
  const party = !!tracker.memory.parrotJukebox
  state['entity.partyParrot'] = party
  state['entity.field_15567'] = party
})

/**
 * Bat (1.20.3+): setupAnimationStates each tick, resting (the id flags' 1) runs the rest animation, else the fly
 * animation (the driver reads 26.3's `flags`, the export names them id_flags).
 */
const bat = animal((state, tracker, input) => {
  if (!atLeast(input, '1.20.3')) return
  const m = ticked(
    tracker,
    'bat',
    () => ({ fly: null as number | null, rest: null as number | null }),
    (m, tickCount) => {
      if ((num(synched(state, input, 'id_flags') ?? input.meta.flags) & 1) !== 0) {
        m.fly = null
        m.rest ??= tickCount
      } else {
        m.rest = null
        m.fly ??= tickCount
      }
    }
  )
  state['entity.flyAnimationState'] = animationState(tracker, 'bat:fly', m.fly, state.ageInTicks)
  state['entity.restAnimationState'] = animationState(tracker, 'bat:rest', m.rest, state.ageInTicks)
})

/** Bee: Bee.rollAmount (the driver's, the same since 1.15); the delta movement is the common one. */
const bee = animal((state, tracker) => {
  const m = (tracker.memory.bee ?? {}) as { rollAmount?: number; rollAmountO?: number }
  state['entity.rollAmount'] = m.rollAmount ?? 0
  state['entity.rollAmountO'] = m.rollAmountO ?? 0
})

/** Allay: the holding, dancing and spinning counters of Allay.tick (the driver's; 1.19 has no dancing data: never). */
const allay = animal((state, tracker) => {
  const m = (tracker.memory.allay ?? {}) as Record<string, number | undefined>
  for (const field of ['holdingItemAnimationTicks', 'holdingItemAnimationTicks0', 'dancingAnimationTicks', 'spinningAnimationTicks', 'spinningAnimationTicks0']) {
    state[`entity.${field}`] = m[field] ?? 0
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// aquatic

/** Squid / GlowSquid: the renderer passes the tentacle angle as the age (lerped; Squid.aiStep is the driver's). */
const squid = animal((state, tracker) => {
  const s = tracker.memory.squid as { tentacleAngle: number; oldTentacleAngle: number } | undefined
  state.ageInTicks = s ? lerp(state.partialTick as number, s.oldTentacleAngle, s.tentacleAngle) : 0
})

/**
 * Axolotl: the rotations and position of this tick and the last one (xRot / xRotO, yRot / yRotO, x / xOld, z / zOld:
 * whether it turned or moved this tick).
 */
const axolotl = animal((state, tracker, input) => {
  const h = history(tracker, input)
  state['entity.xRot'] = h.xRot
  state['entity.xRotO'] = h.xRotO
  state['entity.yRot'] = h.yRot
  state['entity.yRotO'] = h.yRotO
  state['entity.x'] = h.x
  state['entity.xOld'] = h.xOld
  state['entity.z'] = h.z
  state['entity.zOld'] = h.zOld
})

const FROG_POSE_ANIMATIONS = ['jumpAnimationState', 'croakAnimationState', 'tongueAnimationState']

/**
 * Frog: the pose's jump, croak and tongue animations (Frog.onSyncedDataUpdated: the driver's). 1.19.4+: the swim idle
 * while in water and not walking (the driver's), the walk by the frog's own walk animation (the render state's). 1.19 -
 * 1.19.2: Frog.tick plays the walk while moving on land, the swim while moving in water, the swim idle while still in
 * water (moving: horizontally faster than 1.0E-3 per tick); the walk runs at the speed the model gives it.
 */
const frog = animal((state, tracker, input) => {
  driverAnimationStates(state, tracker, FROG_POSE_ANIMATIONS)
  if (atLeast(input, '1.19.4')) {
    driverAnimationStates(state, tracker, ['swimIdleAnimationState'])
    return
  }
  const motion = state['entity.deltaMovement'] as { x: number; y: number; z: number }
  const m = ticked(
    tracker,
    'frog',
    () => ({ walk: null as number | null, swim: null as number | null, swimIdle: null as number | null }),
    (m, tickCount) => {
      const inWater = !!input.isInWater
      const horizontal = motion.x * motion.x + motion.z * motion.z
      if (!!input.onGround && horizontal > 1e-6 && !inWater) m.walk ??= tickCount
      else m.walk = null
      if (horizontal > 1e-6 && inWater) {
        m.swimIdle = null
        m.swim ??= tickCount
      } else if (inWater) {
        m.swim = null
        m.swimIdle ??= tickCount
      } else {
        m.swim = null
        m.swimIdle = null
      }
    }
  )
  const walkSpeed = Math.min(f(f(motion.x * motion.x + motion.y * motion.y + motion.z * motion.z) * 200), 8)
  state['entity.walkAnimationState'] = animationState(tracker, 'frog:walk', m.walk, state.ageInTicks, walkSpeed)
  state['entity.swimAnimationState'] = animationState(tracker, 'frog:swim', m.swim, state.ageInTicks)
  state['entity.swimIdleAnimationState'] = animationState(tracker, 'frog:swimIdle', m.swimIdle, state.ageInTicks)
})

// ---------------------------------------------------------------------------------------------------------------------

/** Cows, pigs, turtles, llamas, striders, ocelots, fish, dolphins, tadpoles: the common fields are all they read. */
const plain = animal()

export const ENTITY_ERA_ANIMALS_ADAPTERS: Record<string, EntityEraAdapter> = {
  cow: plain,
  mooshroom: plain,
  mushroom_cow: plain,
  pig: plain,
  sheep,
  polar_bear: polarBear,
  panda,
  goat,
  hoglin,
  zoglin: hoglin,
  turtle: plain,
  llama: plain,
  trader_llama: plain,
  ravager,
  horse,
  donkey: horse,
  mule: horse,
  skeleton_horse: horse,
  zombie_horse: horse,
  entity_horse: horse,
  camel,
  sniffer,
  armadillo,
  strider: plain,
  wolf,
  cat,
  ocelot: plain,
  ozelot: plain,
  fox,
  rabbit,
  chicken,
  parrot,
  bat,
  bee,
  allay,
  cod: plain,
  salmon: plain,
  pufferfish: plain,
  tropical_fish: plain,
  dolphin: plain,
  squid,
  glow_squid: squid,
  axolotl,
  frog,
  tadpole: plain
}
