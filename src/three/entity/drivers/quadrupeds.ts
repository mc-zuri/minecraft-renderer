import type { EntityAnimInput, EntityAnimTracker, EntityDriver } from '../entityAnimState'
import { isBaby } from '../entityAnimState'
import { DEG_TO_RAD, doubleSinCos, f, floatSinCos, lerp, wrapDegrees } from '../setupAnim/mth'
import { versionNumber } from '../setupAnim/types'

/**
 * Quadrupeds (26.3): the render state their renderers extract and the client side ticking feeding it. Sheep eat grass
 * (entity event 10, Sheep.eatAnimationTick), polar bears stand up (PolarBear.clientSideStandAnimation), pandas sit, lie
 * on their back, roll, sneeze and eat (Panda.tick runs on the client too and changes its own copy of the synched
 * counters and flags), goats lower their head to ram (entity events 58 / 59), hoglins and zoglins headbutt (event 4),
 * turtles lay eggs, llamas carry chests, ravagers attack, are stunned and roar (events 4 and 39, Ravager.aiStep), llama
 * spit flies along its rotation. Cows, mooshrooms and pigs only have their variant and saddle (the cold / warm cow and
 * pig of 26.x are variants of the same entities, not entity types).
 */

const numberOf = (value: unknown, fallback = 0) => (typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : fallback)

/** EntityDataSerializers.BOOLEAN as decoded (a boolean, or 0 / 1 from some decoders). */
const boolOf = (value: unknown, fallback = false) => (typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : fallback)

/** LivingEntity.isAlive for the client: health above 0 (the health synched data), alive when it is not known. */
const isAlive = (input: EntityAnimInput) => typeof input.meta.health !== 'number' || input.meta.health > 0

/** Mob.isNoAi: the mob flags' first bit. */
const isNoAi = (input: EntityAnimInput) => (numberOf(input.meta.mob_flags ?? input.meta.insentient) & 1) !== 0

/** Mth.sin of the version: the 65536 entry table read with doubles from 1.21.11 on, with floats before. */
const sinOf = (version: string) => (versionNumber(version) >= versionNumber('1.21.11') ? doubleSinCos.sin : floatSinCos.sin)

/** Entity.getXRot(partialTicks) in degrees (the frame's pitch, before the upside down flip of LivingEntityRenderer). */
const entityXRot = (input: EntityAnimInput) => f((-input.pitch * 180) / Math.PI)

/**
 * Entity.isInWater (a block lookup) and the level's thundering (a remote client knows it from the game event packets),
 * neither in EntityAnimInput: read from optional inputs, false when not given (out of water, no thunder).
 */
const isInWater = (input: EntityAnimInput) => !!(input as any).isInWater
const isThundering = (input: EntityAnimInput) => !!(input as any).isThundering

/**
 * A synched value the client's own ticking changes too (Panda's counters and flags): the server's value whenever it
 * sends one (a change of the decoded value), else the client's own copy as its ticks left it.
 */
const synced = (memory: { seen?: Record<string, unknown>; local?: Record<string, number> }, key: string, value: unknown, fallback: number) => {
  memory.seen ??= {}
  memory.local ??= {}
  if (!(key in memory.seen) || memory.seen[key] !== value) {
    memory.seen[key] = value
    memory.local[key] = numberOf(value, fallback)
  }
  return memory.local[key]!
}

const DYE_COLORS = ['WHITE', 'ORANGE', 'MAGENTA', 'LIGHT_BLUE', 'YELLOW', 'LIME', 'PINK', 'GRAY', 'LIGHT_GRAY', 'CYAN', 'PURPLE', 'BLUE', 'BROWN', 'GREEN', 'RED', 'BLACK']

// ---------------------------------------------------------------------------------------------------------------------
// Sheep

type SheepMemory = { eatAnimationTick: number }

const sheepMemory = (tracker: EntityAnimTracker): SheepMemory => (tracker.memory.sheep ??= { eatAnimationTick: 0 })

const sheepDriver: EntityDriver = {
  tick(tracker) {
    // Sheep.aiStep (client): the eat animation counts down
    const memory = sheepMemory(tracker)
    memory.eatAnimationTick = Math.max(0, memory.eatAnimationTick - 1)
  },
  event(tracker, id) {
    // Sheep.handleEntityEvent: 10 starts eating grass
    if (id === 10) sheepMemory(tracker).eatAnimationTick = 40
  },
  state(state, tracker, input) {
    const a = tracker.partialTick
    const tick = sheepMemory(tracker).eatAnimationTick
    // getHeadEatPositionScale
    if (tick <= 0) state.headEatPositionScale = 0
    else if (tick >= 4 && tick <= 36) state.headEatPositionScale = 1
    else state.headEatPositionScale = tick < 4 ? f(f(tick - a) / 4) : f(-f(tick - 40 - a) / 4)
    // getHeadEatAngleScale
    if (tick > 4 && tick <= 36) {
      const scale = f(f(tick - 4 - a) / 32)
      state.headEatAngleScale = f(f(0.628_318_55) + f(f(0.219_911_49) * sinOf(input.version)(f(scale * f(28.7)))))
    } else {
      state.headEatAngleScale = tick > 0 ? f(0.628_318_55) : f(entityXRot(input) * DEG_TO_RAD)
    }
    // DATA_WOOL_ID: the color in the low 4 bits, sheared in bit 16
    const wool = numberOf(input.meta.wool)
    state.isSheared = (wool & 16) !== 0
    state.woolColor = DYE_COLORS[wool & 15]
    state.isJebSheep = input.customName === 'jeb_'
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Polar bear

type PolarBearMemory = { stand: number; standO: number }

const polarBearMemory = (tracker: EntityAnimTracker): PolarBearMemory => (tracker.memory.polarBear ??= { stand: 0, standO: 0 })

const polarBearDriver: EntityDriver = {
  tick(tracker, input) {
    // PolarBear.tick (client): the stand animation goes 0 to 6 while DATA_STANDING_ID is set
    const memory = polarBearMemory(tracker)
    memory.standO = memory.stand
    memory.stand = Math.min(6, Math.max(0, f(memory.stand + (boolOf(input.meta.standing) ? 1 : -1))))
  },
  state(state, tracker) {
    // getStandingAnimationScale
    const memory = polarBearMemory(tracker)
    state.standScale = f(lerp(tracker.partialTick, memory.standO, memory.stand) / 6)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Panda

const GENES = ['NORMAL', 'LAZY', 'WORRIED', 'PLAYFUL', 'BROWN', 'WEAK', 'AGGRESSIVE'] as const
const RECESSIVE = new Set<string>(['BROWN', 'WEAK'])

/** Gene.byId (out of bounds: NORMAL) */
const gene = (value: unknown) => GENES[numberOf(value)] ?? 'NORMAL'

/** Panda.getVariant: Gene.getVariantFromGenes(main, hidden) */
const pandaVariant = (input: EntityAnimInput) => {
  const main = gene(input.meta.main_gene)
  const hidden = gene(input.meta.hidden_gene)
  if (RECESSIVE.has(main)) return main === hidden ? main : 'NORMAL'
  return main
}

type PandaMemory = {
  sitAmount: number
  sitAmountO: number
  onBackAmount: number
  onBackAmountO: number
  rollAmount: number
  rollAmountO: number
  rollCounter: number
  seen?: Record<string, unknown>
  local?: Record<string, number>
}

const pandaMemory = (tracker: EntityAnimTracker): PandaMemory =>
  (tracker.memory.panda ??= { sitAmount: 0, sitAmountO: 0, onBackAmount: 0, onBackAmountO: 0, rollAmount: 0, rollAmountO: 0, rollCounter: 0 })

/** The client's copies of the panda's synched data, taking the server's values when they come. */
const pandaData = (memory: PandaMemory, input: EntityAnimInput) => {
  synced(memory, 'flags', input.meta.flags, 0)
  synced(memory, 'unhappy', input.meta.unhappy_counter, 0)
  synced(memory, 'sneeze', input.meta.sneeze_counter, 0)
  synced(memory, 'eat', input.meta.eat_counter, 0)
  return memory.local as { flags: number; unhappy: number; sneeze: number; eat: number }
}

const pandaDriver: EntityDriver = {
  tick(tracker, input) {
    // Panda.tick, which the client runs on its own copy of the synched data
    const memory = pandaMemory(tracker)
    const data = pandaData(memory, input)
    const setFlag = (flag: number, on: boolean) => (data.flags = on ? data.flags | flag : data.flags & ~flag)
    if (pandaVariant(input) === 'WORRIED') {
      if (isThundering(input) && !isInWater(input)) {
        setFlag(8, true)
        data.eat = 0
      } else if (!(data.eat > 0)) {
        setFlag(8, false)
      }
    }
    if (data.unhappy > 0) data.unhappy--
    if (data.flags & 2) {
      data.sneeze++
      if (data.sneeze > 20) {
        // sneeze(false)
        setFlag(2, false)
        data.sneeze = 0
      }
    }
    if (data.flags & 4) {
      // handleRoll
      memory.rollCounter++
      if (memory.rollCounter > 32) setFlag(4, false)
    } else {
      memory.rollCounter = 0
    }
    // updateSitAmount
    memory.sitAmountO = memory.sitAmount
    memory.sitAmount = data.flags & 8 ? Math.min(1, f(memory.sitAmount + f(0.15))) : Math.max(0, f(memory.sitAmount - f(0.19)))
    // handleEating: the client's own random start (random.nextInt(80) == 1 on the client's random) can't be reproduced;
    // eating stops without a held item or when not sitting, and counts up while eating
    if (!input.equipment?.mainhand || !(data.flags & 8)) data.eat = 0
    if (data.eat > 0) data.eat++
    // updateOnBackAnimation
    memory.onBackAmountO = memory.onBackAmount
    memory.onBackAmount = data.flags & 16 ? Math.min(1, f(memory.onBackAmount + f(0.15))) : Math.max(0, f(memory.onBackAmount - f(0.19)))
    // updateRollAmount
    memory.rollAmountO = memory.rollAmount
    memory.rollAmount = data.flags & 4 ? Math.min(1, f(memory.rollAmount + f(0.15))) : Math.max(0, f(memory.rollAmount - f(0.19)))
  },
  state(state, tracker, input) {
    const memory = pandaMemory(tracker)
    const data = pandaData(memory, input)
    const pt = tracker.partialTick
    const variant = pandaVariant(input)
    state.variant = variant
    state.isUnhappy = data.unhappy > 0
    state.isSneezing = (data.flags & 2) !== 0
    state.sneezeTime = data.sneeze
    state.isEating = data.eat > 0
    state.isScared = variant === 'WORRIED' && isThundering(input)
    state.isSitting = (data.flags & 8) !== 0
    state.sitAmount = lerp(pt, memory.sitAmountO, memory.sitAmount)
    state.lieOnBackAmount = lerp(pt, memory.onBackAmountO, memory.onBackAmount)
    state.rollAmount = state.isBaby ? 0 : lerp(pt, memory.rollAmountO, memory.rollAmount)
    state.rollTime = memory.rollCounter > 0 ? f(memory.rollCounter + pt) : 0
    // Panda.tick sets the pitch to 0 while sitting (the server does too, so the pitch it sends is 0 as well)
    if (state.isSitting) state.xRot = 0
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Goat

type GoatMemory = { isLoweringHead: boolean; lowerHeadTick: number }

const goatMemory = (tracker: EntityAnimTracker): GoatMemory => (tracker.memory.goat ??= { isLoweringHead: false, lowerHeadTick: 0 })

const goatDriver: EntityDriver = {
  tick(tracker) {
    // Goat.aiStep
    const memory = goatMemory(tracker)
    if (memory.isLoweringHead) memory.lowerHeadTick++
    else memory.lowerHeadTick -= 2
    memory.lowerHeadTick = Math.min(20, Math.max(0, memory.lowerHeadTick))
  },
  event(tracker, id) {
    // Goat.handleEntityEvent: 58 lowers the head to ram, 59 raises it
    if (id === 58) goatMemory(tracker).isLoweringHead = true
    else if (id === 59) goatMemory(tracker).isLoweringHead = false
  },
  state(state, tracker, input) {
    state.hasLeftHorn = boolOf(input.meta.has_left_horn, true)
    state.hasRightHorn = boolOf(input.meta.has_right_horn, true)
    // getRammingXHeadRot
    const maxRammingXHeadRot = isBaby(input) ? f(52.5) : 30
    state.rammingXHeadRot = f(f(f(goatMemory(tracker).lowerHeadTick / 20) * maxRammingXHeadRot) * DEG_TO_RAD)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Hoglin, zoglin

const hoglinTicks = (tracker: EntityAnimTracker): number => (tracker.memory.attackAnimationRemainingTicks ??= 0)

const hoglinBaseDriver: EntityDriver = {
  tick(tracker) {
    // Hoglin / Zoglin.aiStep
    if (hoglinTicks(tracker) > 0) tracker.memory.attackAnimationRemainingTicks--
  },
  event(tracker, id) {
    // handleEntityEvent: 4 is the headbutt
    if (id === 4) tracker.memory.attackAnimationRemainingTicks = 10
  },
  state(state, tracker) {
    state.attackAnimationRemainingTicks = hoglinTicks(tracker)
  }
}

const hoglinDriver: EntityDriver = {
  ...hoglinBaseDriver,
  state(state, tracker, input) {
    hoglinBaseDriver.state!(state, tracker, input)
    // isConverting: !isImmuneToZombification() && !isNoAi() && the PIGLINS_ZOMBIFY environment attribute where it
    // stands (in vanilla: true outside the nether), which is not in EntityAnimInput: read from the optional
    // piglinsZombify input, not converting when not given
    state.isConverting = !boolOf(input.meta.immune_to_zombification) && !isNoAi(input) && !!(input as any).piglinsZombify
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Turtle

const turtleDriver: EntityDriver = {
  state(state, _tracker, input) {
    // isOnLand = !isInWater() && onGround()
    state.isOnLand = !isInWater(input) && !!input.onGround
    state.isLayingEgg = boolOf(input.meta.laying_egg)
    state.hasEgg = !isBaby(input) && boolOf(input.meta.has_egg)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Llama, trader llama

const LLAMA_VARIANTS = ['CREAMY', 'WHITE', 'BROWN', 'GRAY']

const llamaDriver: EntityDriver = {
  state(state, _tracker, input) {
    // Variant.byId clamps out of range ids
    state.variant = LLAMA_VARIANTS[Math.min(3, Math.max(0, numberOf(input.meta.variant)))]
    state.hasChest = !isBaby(input) && boolOf(input.meta.chest)
    // the body armor slot (a carpet); before 1.20.5 the carpet's color was the swag synched data (-1 none)
    const swag = numberOf(input.meta.swag, -1)
    state.bodyItem = input.equipment?.body ?? (swag >= 0 && swag < 16 ? `${DYE_COLORS[swag]!.toLowerCase()}_carpet` : undefined)
    state.isTraderLlama = input.name === 'trader_llama'
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ravager

type RavagerMemory = { attackTick: number; stunnedTick: number; roarTick: number }

const ravagerMemory = (tracker: EntityAnimTracker): RavagerMemory => (tracker.memory.ravager ??= { attackTick: 0, stunnedTick: 0, roarTick: 0 })

const ravagerDriver: EntityDriver = {
  tick(tracker, input) {
    // Ravager.aiStep, while alive
    if (!isAlive(input)) return
    const memory = ravagerMemory(tracker)
    if (memory.roarTick > 0) memory.roarTick--
    if (memory.attackTick > 0) memory.attackTick--
    if (memory.stunnedTick > 0) {
      memory.stunnedTick--
      if (memory.stunnedTick === 0) memory.roarTick = 20
    }
  },
  event(tracker, id) {
    // Ravager.handleEntityEvent: 4 attacks, 39 is stunned (69, the roar's knockback, has no animation)
    if (id === 4) ravagerMemory(tracker).attackTick = 10
    else if (id === 39) ravagerMemory(tracker).stunnedTick = 40
  },
  state(state, tracker) {
    const memory = ravagerMemory(tracker)
    const pt = tracker.partialTick
    state.stunnedTicksRemaining = memory.stunnedTick > 0 ? f(memory.stunnedTick - pt) : 0
    state.attackTicksRemaining = memory.attackTick > 0 ? f(memory.attackTick - pt) : 0
    state.roarAnimation = memory.roarTick > 0 ? f(f(20 - memory.roarTick + pt) / 20) : 0
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Llama spit

const llamaSpitDriver: EntityDriver = {
  state(state, _tracker, input) {
    // getYRot / getXRot(partialTicks): the projectile's own rotation (the input's yaw and pitch, the frame's)
    state.yRot = f(wrapDegrees(f(180 - (input.bodyYaw * 180) / Math.PI)))
    state.xRot = entityXRot(input)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Mooshroom, pig

const MUSHROOM_COW_VARIANTS = ['RED', 'BROWN']

const mooshroomDriver: EntityDriver = {
  state(state, _tracker, input) {
    // DATA_TYPE: an id since 1.21.5 (Variant.byId clamps), the name before
    const type = input.meta.type
    state.variant = typeof type === 'string' ? (type.toUpperCase() === 'BROWN' ? 'BROWN' : 'RED') : MUSHROOM_COW_VARIANTS[Math.min(1, Math.max(0, numberOf(type)))]
  }
}

const pigDriver: EntityDriver = {
  state(state, _tracker, input) {
    // the saddle slot (1.21.5+), the saddle synched data before
    state.saddle = input.equipment?.saddle ?? (boolOf(input.meta.saddle) ? 'saddle' : undefined)
  }
}

export const QUADRUPEDS_DRIVERS: Record<string, EntityDriver> = {
  sheep: sheepDriver,
  polar_bear: polarBearDriver,
  panda: pandaDriver,
  goat: goatDriver,
  hoglin: hoglinDriver,
  zoglin: hoglinBaseDriver,
  turtle: turtleDriver,
  llama: llamaDriver,
  trader_llama: llamaDriver,
  ravager: ravagerDriver,
  llama_spit: llamaSpitDriver,
  mooshroom: mooshroomDriver,
  pig: pigDriver
}
