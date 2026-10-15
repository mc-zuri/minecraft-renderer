import { beforeAll, describe, expect, it } from 'vitest'
import { EntityAnimTracker, entityAnimState, registerEntityDrivers, type EntityAnimInput } from '../entityAnimState'
import { WalkAnimation } from '../setupAnim/walkAnimation'
import { f } from '../setupAnim/mth'
import { MISC_DRIVERS } from './misc'

beforeAll(() => {
  registerEntityDrivers(MISC_DRIVERS)
})

type Extra = Partial<EntityAnimInput> & Record<string, unknown>

const make = (name: string, meta: Record<string, unknown> = {}, extra: Extra = {}) => {
  const tracker = new EntityAnimTracker(name, '26.3')
  const input = { name, version: '26.3', meta, data: {}, bodyYaw: 0, headYaw: 0, pitch: 0, ...extra } as EntityAnimInput & Record<string, unknown>
  tracker.setInput(input)
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) tracker.tick()
  }
  const state = (partialTick = 0) => {
    tracker.walk.partialTick = partialTick
    return entityAnimState(tracker, input)
  }
  return { tracker, input, ticks, state }
}

describe('iron golem', () => {
  it('attack timer from event 4 counts down in aiStep', () => {
    const { tracker, ticks, state } = make('iron_golem')
    ticks(2)
    tracker.event(4)
    expect(state().attackTicksRemaining).toBe(10)
    ticks(1)
    expect(state(0.25).attackTicksRemaining).toBe(8.75)
    ticks(8)
    expect(state(0.5).attackTicksRemaining).toBe(0.5)
    ticks(1)
    expect(state(0.5).attackTicksRemaining).toBe(0)
  })

  it('offers a flower for 400 ticks (event 11), takes it back on event 34', () => {
    const { tracker, ticks, state } = make('iron_golem', { health: 40 })
    expect(state().offerFlowerTick).toBe(0)
    expect(state().flowerBlock).toBeNull()
    tracker.event(11)
    ticks(3)
    expect(state().offerFlowerTick).toBe(397)
    expect(state().flowerBlock).toBe('minecraft:poppy')
    tracker.event(34)
    expect(state().offerFlowerTick).toBe(0)
    // 40 / 100 health
    expect(state().crackiness).toBe('MEDIUM')
  })
})

describe('snow golem', () => {
  it('wears its pumpkin by default, not when sheared', () => {
    expect(make('snow_golem').state().headBlock).toBe('minecraft:carved_pumpkin')
    expect(make('snow_golem', { pumpkin: 16 }).state().headBlock).toBe('minecraft:carved_pumpkin')
    expect(make('snow_golem', { pumpkin: 0 }).state().headBlock).toBeNull()
  })
})

describe('copper golem', () => {
  it('spins its head 200 to 239 ticks after the last spin while idle', () => {
    const { tracker, ticks, state } = make('copper_golem', { copper_golem_state: 0 })
    tracker.memory.random = () => 0
    ticks(1)
    // scheduled at tick 1 + 200
    expect(tracker.memory.idleAnimationStartTick).toBe(201)
    ticks(199)
    expect(state().idleAnimationState).toBeUndefined()
    ticks(1)
    expect(state().idleAnimationState).toBe(201)
    ticks(10)
    // at 211 the spin is over: rescheduled the next tick
    expect(tracker.memory.idleAnimationStartTick).toBe(0)
    ticks(1)
    expect(tracker.memory.idleAnimationStartTick).toBe(412)
    expect(state().idleAnimationState).toBe(201)
  })

  it('plays the chest interaction of its state', () => {
    const { input, ticks, state } = make('copper_golem', { copper_golem_state: 0 })
    ticks(5)
    input.meta.copper_golem_state = 1
    ticks(1)
    let s = state()
    expect(s.idleAnimationState).toBeNull()
    expect(s.interactionGetItem).toBe(6)
    ticks(3)
    expect(state().interactionGetItem).toBe(6)
    input.meta.copper_golem_state = 'dropping_no_item'
    ticks(1)
    s = state()
    expect(s.interactionGetItem).toBeNull()
    expect(s.interactionDropNoItem).toBe(10)
    expect(s.copperGolemState).toBe('DROPPING_NO_ITEM')
  })

  it('does not animate without AI', () => {
    const { ticks, state } = make('copper_golem', { copper_golem_state: 2, mob_flags: 1 })
    ticks(5)
    expect(state().interactionGetNoItem).toBeUndefined()
  })
})

describe('villagers', () => {
  it('a villager shakes its head while the unhappy counter, also counted down by the client, is above 0', () => {
    const { input, ticks, state } = make('villager')
    ticks(2)
    expect(state().isUnhappy).toBe(false)
    input.meta.unhappy_counter = 40
    ticks(1)
    expect(state().isUnhappy).toBe(true)
    ticks(38)
    expect(state().isUnhappy).toBe(true)
    ticks(1)
    expect(state().isUnhappy).toBe(false)
  })

  it('a newer server value replaces the count', () => {
    const { tracker, input, ticks } = make('villager', { unhappy_counter: 40 })
    ticks(30)
    input.meta.unhappy_counter = 20
    ticks(1)
    expect(tracker.memory['count:unhappy_counter']).toBe(19)
  })

  it('a wandering trader reads the synched counter', () => {
    expect(make('wandering_trader', { unhappy_counter: 5 }).state().isUnhappy).toBe(true)
    expect(make('wandering_trader', { unhappy_counter: 0 }).state().isUnhappy).toBe(false)
  })
})

describe('illagers', () => {
  it('vindicator: attacking when aggressive, celebrating, else arms crossed', () => {
    expect(make('vindicator', { mob_flags: 4 }).state().armPose).toBe('ATTACKING')
    expect(make('vindicator', { is_celebrating: true }).state().armPose).toBe('CELEBRATING')
    expect(make('vindicator').state().armPose).toBe('CROSSED')
  })

  it('pillager: charging, holding a crossbow, attacking, neutral', () => {
    const charging = make('pillager', { is_charging_crossbow: true }, { equipment: { mainhand: 'crossbow' } }).state()
    expect(charging.armPose).toBe('CROSSBOW_CHARGE')
    expect(charging.maxCrossbowChargeDuration).toBe(25)
    const holding = make('pillager', {}, { equipment: { offhand: 'crossbow' } }).state()
    expect(holding.armPose).toBe('CROSSBOW_HOLD')
    expect(holding.maxCrossbowChargeDuration).toBe(0)
    expect(make('pillager', { mob_flags: 4 }).state().armPose).toBe('ATTACKING')
    expect(make('pillager').state().armPose).toBe('NEUTRAL')
  })

  it('evoker: casting a spell, celebrating', () => {
    const casting = make('evoker', { spell_casting: 1, is_celebrating: true }).state()
    expect(casting.armPose).toBe('SPELLCASTING')
    expect(casting.isCastingSpell).toBe(true)
    expect(make('evoker', { spell_casting: 0, is_celebrating: true }).state().armPose).toBe('CELEBRATING')
  })

  it('illusioner: casting, a bow when aggressive, riding', () => {
    expect(make('illusioner', { spell_casting: 2 }).state().armPose).toBe('SPELLCASTING')
    const bow = make('illusioner', { mob_flags: 4 }, { isPassenger: true }).state()
    expect(bow.armPose).toBe('BOW_AND_ARROW')
    expect(bow.isRiding).toBe(true)
  })

  it('illusioner: its mirror images move when it is hurt while invisible', () => {
    const { tracker, input, ticks, state } = make('illusioner', { shared_flags: 0x20 })
    tracker.memory.random = () => 0.99
    input.hurtTime = 1
    ticks(1)
    // just moved: still at the old offsets
    expect(state().illusionOffsets[0]).toEqual({ x: 0, y: 0, z: 0 })
    input.hurtTime = 0
    ticks(1)
    const moving = state().illusionOffsets[0]
    expect(moving.x).toBeCloseTo(1, 6)
    expect(moving.y).toBeCloseTo(1 / 3, 6)
    ticks(2)
    expect(state().illusionOffsets[2]).toEqual({ x: 3, y: 1, z: 3 })
    // hurtDuration - 1: back to the illusioner
    input.hurtTime = 9
    ticks(1)
    input.hurtTime = 0
    ticks(3)
    expect(state().illusionOffsets[1]).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('witch', () => {
  it('holds an item, a potion while drinking; its id sets the nose wobble', () => {
    const drinking = make('witch', { using_item: true }, { equipment: { mainhand: 'potion' }, entityId: 7 }).state()
    expect(drinking.isHoldingItem).toBe(true)
    expect(drinking.isHoldingPotion).toBe(true)
    expect(drinking.entityId).toBe(7)
    const empty = make('witch').state()
    expect(empty.isHoldingItem).toBe(false)
    expect(empty.isHoldingPotion).toBe(false)
  })
})

describe('warden', () => {
  it('starts the pose animations at the tick the pose arrived', () => {
    const { input, ticks, state } = make('warden')
    ticks(5)
    input.pose = 'ROARING'
    ticks(1)
    expect(state().roarAnimationState).toBe(5)
    input.pose = 'SNIFFING'
    ticks(2)
    expect(state().sniffAnimationState).toBe(6)
  })

  it('emerges when it spawns emerging', () => {
    const { ticks, state } = make('warden', {}, { pose: 'EMERGING' })
    ticks(1)
    expect(state().emergeAnimationState).toBe(0)
  })

  it('attack (event 4) stops the roar, sonic boom on event 62', () => {
    const { tracker, input, ticks, state } = make('warden')
    input.pose = 'ROARING'
    ticks(3)
    tracker.event(4)
    let s = state()
    expect(s.roarAnimationState).toBeNull()
    expect(s.attackAnimationState).toBe(3)
    ticks(2)
    tracker.event(62)
    s = state()
    expect(s.sonicBoomAnimationState).toBe(5)
  })

  it('tendrils (event 61) and the heart beat, faster with anger', () => {
    const { tracker, input, ticks, state } = make('warden')
    ticks(2)
    tracker.event(61)
    ticks(1)
    expect(state().tendrilAnimation).toBe(1)
    expect(state(0.5).tendrilAnimation).toBe(f(9.5 / 10))
    // calm: every 40 ticks
    ticks(37)
    expect(state(0.5).heartAnimation).toBe(f(9.5 / 10))
    // angry: every 10 ticks
    input.meta.client_anger_level = 80
    ticks(10)
    expect(state().heartAnimation).toBe(1)
    ticks(1)
    expect(state().heartAnimation).toBe(f(0.9))
    // half angry: 40 - 15
    input.meta.client_anger_level = 40
    ticks(25 * 3 - 51)
    expect(state().heartAnimation).toBe(1)
  })
})

describe('breeze', () => {
  it('drives its six animation states from its poses', () => {
    const { input, ticks, state } = make('breeze')
    ticks(1)
    expect(state().idle).toBe(1)
    ticks(2)
    input.pose = 'SHOOTING'
    ticks(1)
    let s = state()
    expect(s.shoot).toBe(3)
    // resetAnimations stopped it, the tick starts it again
    expect(s.idle).toBe(4)
    ticks(1)
    input.pose = 'SLIDING'
    ticks(1)
    s = state()
    expect(s.shoot).toBeNull()
    expect(s.slide).toBe(5)
    ticks(2)
    input.pose = 'STANDING'
    ticks(1)
    s = state()
    expect(s.slide).toBeNull()
    expect(s.slideBack).toBe(9)
    expect(s.idle).toBe(9)
    ticks(1)
    input.pose = 'INHALING'
    ticks(1)
    expect(state().inhale).toBe(10)
    input.pose = 'LONG_JUMPING'
    ticks(1)
    s = state()
    expect(s.inhale).toBeNull()
    expect(s.longJump).toBe(12)
    expect(s.slideBack).toBe(9)
  })
})

describe('creaking', () => {
  it('attack (event 4) and invulnerability (event 66) animations last while their timers run', () => {
    const { tracker, ticks, state } = make('creaking')
    ticks(2)
    tracker.event(4)
    ticks(1)
    expect(state().attackAnimationState).toBe(3)
    ticks(13)
    expect(state().attackAnimationState).toBe(3)
    ticks(1)
    expect(state().attackAnimationState).toBeNull()
    tracker.event(66)
    ticks(7)
    expect(state().invulnerabilityAnimationState).toBe(18)
    ticks(1)
    expect(state().invulnerabilityAnimationState).toBeNull()
  })

  it('tearing down: the death animation, no red overlay, flickering eyes', () => {
    const { tracker, ticks, state } = make('creaking', { is_tearing_down: true, health: 0, is_active: true, can_move: false })
    tracker.memory.random = () => 0
    ticks(1)
    let s = state()
    expect(s.deathAnimationState).toBe(1)
    expect(s.deathTime).toBe(0)
    expect(s.hasRedOverlay).toBe(false)
    expect(s.canMove).toBe(false)
    // deathTime 1 > 0: on until 1 + 0
    expect(s.eyesGlowing).toBe(true)
    // 2 > 1: off until 2 + 2
    ticks(1)
    expect(state().eyesGlowing).toBe(false)
    ticks(2)
    expect(state().eyesGlowing).toBe(false)
    // 5 > 4: on until 5 + 1
    ticks(1)
    expect(state().eyesGlowing).toBe(true)
  })

  it('walks with its own walk animation (25 times the distance, up to 3)', () => {
    const { input, ticks, state } = make('creaking', { is_active: true }, { position: { x: 0, y: 0, z: 0 } })
    ticks(1)
    const walk = new WalkAnimation()
    walk.update(0, f(0.4), 1)
    let previous = 0
    for (const x of [0.1, 0.2, 0.3]) {
      input.position = { x, y: 0, z: 0 }
      ticks(1)
      walk.update(Math.min(f(f(x - previous) * 25), 3), f(0.4), 1)
      previous = x
    }
    const s = state(1)
    expect(s.walkAnimationSpeed).toBe(1)
    expect(s.walkAnimationPos).toBeCloseTo(walk.positionAt(1), 4)
    expect(s.walkAnimationPos).toBeGreaterThan(4)
    expect(s.eyesGlowing).toBe(true)
    expect(s.canMove).toBe(true)
  })
})

describe('minecarts', () => {
  it('the hurt wobble counts down hurt and damage like the client', () => {
    const { ticks, state } = make('minecart', { hurt: 10, damage: 20, hurtdir: -1 }, { entityId: 1 })
    ticks(1)
    const s = state(0.5)
    expect(s.hurtTime).toBe(8.5)
    expect(s.damageTime).toBe(18.5)
    expect(s.hurtDir).toBe(-1)
    expect(s.displayOffset).toBe(6)
    expect(s.offsetSeed).toBe(-4_132_653_469_018_943_280n)
    ticks(10)
    expect(state(0.5).hurtTime).toBe(-0.5)
  })

  it('display offsets by type', () => {
    expect(make('chest_minecart').state().displayOffset).toBe(8)
    expect(make('hopper_minecart').state().displayOffset).toBe(1)
    expect(make('minecart', { display_offset: 3 }).state().displayOffset).toBe(3)
    expect(make('minecart', {}, { entityId: 123_456 }).state().offsetSeed).toBe(7_048_117_368_726_575_552n)
  })

  it('a TNT minecart primed by event 70 counts its fuse down', () => {
    const { tracker, ticks, state } = make('tnt_minecart')
    expect(state().fuseRemainingInTicks).toBe(-1)
    tracker.event(70)
    ticks(1)
    expect(state(0.25).fuseRemainingInTicks).toBe(79.75)
  })
})

describe('arrows', () => {
  it('shakes when it lands, not when it spawns in the ground', () => {
    const landed = make('arrow', { in_ground: true })
    landed.ticks(3)
    expect(landed.state().shake).toBeLessThanOrEqual(0)
    const { input, ticks, state } = make('arrow', { in_ground: false, effect_color: 0xff_00_00 })
    ticks(4)
    input.meta.in_ground = true
    ticks(1)
    const s = state(0.5)
    expect(s.shake).toBe(5.5)
    expect(s.isTipped).toBe(true)
    ticks(6)
    expect(state().shake).toBe(0)
    expect(make('arrow', { effect_color: -1 }).state().isTipped).toBe(false)
  })

  it('a trident glints when enchanted', () => {
    const s = make('trident', { foil: true }, { pitch: -Math.PI / 4 }).state()
    expect(s.isFoil).toBe(true)
    expect(s.xRot).toBe(45)
  })
})
