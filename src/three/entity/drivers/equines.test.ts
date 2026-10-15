import { beforeAll, describe, expect, it } from 'vitest'
import { EntityAnimTracker, entityAnimState, registerEntityDrivers, type EntityAnimInput } from '../entityAnimState'
import { f } from '../setupAnim/mth'
import { EQUINES_DRIVERS } from './equines'

beforeAll(() => {
  registerEntityDrivers(EQUINES_DRIVERS)
})

type Extra = Partial<EntityAnimInput> & Record<string, unknown>

/** An entity fed one input, ticked by hand (no frame time: the partial tick is set directly). */
const entity = (name: string, meta: Record<string, unknown> = {}, extra: Extra = {}, version = '26.3') => {
  const tracker = new EntityAnimTracker(name, version)
  tracker.memory.random = () => 0.5
  const input: EntityAnimInput & Record<string, unknown> = { name, version, meta, data: {}, bodyYaw: 0, headYaw: 0, pitch: 0, onGround: true, ...extra }
  tracker.setInput(input)
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) tracker.tick()
  }
  const state = (partialTick = 0) => {
    tracker.walk.partialTick = partialTick
    return entityAnimState(tracker, input)
  }
  return { tracker, input, meta, tick, state }
}

/** Java's float easing, step by step. */
const easeUp = (value: number, factor: number) => Math.min(1, f(value + f(f(f(1 - value) * f(factor)) + f(0.05))))

describe('horses (AbstractHorse)', () => {
  it('eases the eat animation toward the eating flag and back', () => {
    const horse = entity('horse', { flags: 16 })
    let expected = 0
    for (let i = 0; i < 5; i++) {
      horse.tick()
      expected = easeUp(expected, 0.4)
      expect(horse.state(1).eatAnimation).toBe(expected)
    }
    expect(expected).toBe(1)
    expect(horse.state(1).standAnimation).toBe(0)
    horse.meta.flags = 0
    horse.tick()
    // 1 + (0 - 1) * 0.4 - 0.05
    expect(horse.state(1).eatAnimation).toBe(f(1 + f(f(-1 * f(0.4)) - f(0.05))))
  })

  it('interpolates the eat animation with the partial tick', () => {
    const horse = entity('horse', { flags: 16 })
    horse.tick(2)
    // lerp(0.5, 0.45, 0.72)
    expect(horse.state(0.5).eatAnimation).toBeCloseTo(0.585, 6)
  })

  it('rears: the stand animation rises, eating is cut, and it falls back with the cubic ease', () => {
    const horse = entity('horse', { flags: 16 })
    horse.tick(2)
    horse.meta.flags = 16 | 32
    horse.tick(5)
    expect(horse.state(1).standAnimation).toBe(1)
    expect(horse.state(0.5).eatAnimation).toBe(0)
    horse.meta.flags = 0
    horse.tick()
    // 1 + (0.8 - 1) * 0.6 - 0.05
    expect(horse.state(1).standAnimation).toBeCloseTo(0.83, 6)
    horse.tick()
    expect(horse.state(1).standAnimation).toBeCloseTo(0.83 + ((0.8 * 0.83 ** 3 - 0.83) * 0.6 - 0.05), 5)
  })

  it('opens its mouth with the open mouth flag (feedingAnimation)', () => {
    const horse = entity('zombie_horse', { flags: 64 })
    horse.tick()
    expect(horse.state(1).feedingAnimation).toBeCloseTo(0.75, 6)
  })

  it('swishes its tail for 7 ticks after the 1 in 200 roll', () => {
    const horse = entity('skeleton_horse')
    horse.tracker.memory.random = () => 0
    horse.tick()
    expect(horse.state().animateTail).toBe(true)
    horse.tracker.memory.random = () => 0.5
    horse.tick(6)
    expect(horse.state().animateTail).toBe(true)
    horse.tick()
    expect(horse.state().animateTail).toBe(false)
  })

  it('is ridden when it carries a passenger, saddled by equipment or (before 1.21.5) the saddled flag', () => {
    const ridden = entity('horse', {}, { isVehicle: true, equipment: { saddle: 'saddle', body: 'diamond_horse_armor' } })
    ridden.tick()
    expect(ridden.state()).toMatchObject({ isRidden: true, saddle: 'saddle', bodyArmorItem: 'diamond_horse_armor' })
    const legacy = entity('horse', { flags: 4 }, {}, '1.20.4')
    legacy.tick()
    expect(legacy.state()).toMatchObject({ isRidden: false, saddle: 'saddle' })
    const modern = entity('horse', { flags: 4 })
    modern.tick()
    expect(modern.state().saddle).toBeUndefined()
  })

  it('donkeys and mules carry their chest', () => {
    const donkey = entity('donkey', { chest: true })
    donkey.tick()
    expect(donkey.state().hasChest).toBe(true)
    const mule = entity('mule', { chest: false })
    mule.tick()
    expect(mule.state().hasChest).toBe(false)
  })
})

describe('camels', () => {
  it('restarts the idle animation every 80 + random(40) ticks', () => {
    const camel = entity('camel')
    camel.tracker.memory.random = () => 0
    camel.tick()
    expect(camel.state().idleAnimationState).toBe(1)
    camel.tick(80)
    expect(camel.state().idleAnimationState).toBe(1)
    camel.tick()
    expect(camel.state().idleAnimationState).toBe(82)
  })

  it('sits down, stays sat and stands up by the pose time from the game time', () => {
    const camel = entity('camel', { last_pose_change_tick: 0n })
    const gameTime = (tick: number) => 1000 + tick
    const tickTo = (tick: number) => {
      while (camel.tracker.tickCount < tick) {
        camel.input.gameTime = gameTime(camel.tracker.tickCount + 1)
        camel.tick()
      }
    }
    tickTo(4)
    expect(camel.state()).toMatchObject({ sitAnimationState: null, sitPoseAnimationState: null, sitUpAnimationState: null })
    // sitDown at tick 5: -gameTime
    camel.meta.last_pose_change_tick = BigInt(-gameTime(5))
    tickTo(5)
    expect(camel.state()).toMatchObject({ sitAnimationState: 5, sitPoseAnimationState: null })
    tickTo(44)
    expect(camel.state()).toMatchObject({ sitAnimationState: 5, sitPoseAnimationState: null })
    tickTo(45)
    expect(camel.state()).toMatchObject({ sitAnimationState: null, sitPoseAnimationState: 45 })
    // standUp at tick 100
    camel.meta.last_pose_change_tick = gameTime(100)
    tickTo(100)
    expect(camel.state()).toMatchObject({ sitAnimationState: null, sitPoseAnimationState: null, sitUpAnimationState: 100 })
    tickTo(151)
    expect(camel.state().sitUpAnimationState).toBe(100)
    tickTo(152)
    expect(camel.state().sitUpAnimationState).toBeNull()
  })

  it('without a game time: a pose seen at spawn is settled, later changes count from when they are seen', () => {
    const camel = entity('camel', { last_pose_change_tick: -500 })
    camel.tick()
    expect(camel.state()).toMatchObject({ sitAnimationState: null, sitPoseAnimationState: 1 })
    camel.tick(8)
    // standUp seen at tick 10
    camel.meta.last_pose_change_tick = 2000
    camel.tick()
    expect(camel.state()).toMatchObject({ sitPoseAnimationState: null, sitUpAnimationState: 10 })
    camel.tick(51)
    expect(camel.state().sitUpAnimationState).toBe(10)
    camel.tick()
    expect(camel.state().sitUpAnimationState).toBeNull()
    // sitDown seen at tick 100 (game time 2090)
    camel.tick(100 - 62 - 1)
    camel.meta.last_pose_change_tick = -2090
    camel.tick()
    expect(camel.tracker.tickCount).toBe(100)
    expect(camel.state().sitAnimationState).toBe(100)
    // standUpInstantly at tick 120 writes game time - 53: no standing up animation
    camel.tick(19)
    camel.meta.last_pose_change_tick = 2110 - 53
    camel.tick()
    expect(camel.state()).toMatchObject({ sitAnimationState: null, sitPoseAnimationState: null, sitUpAnimationState: null })
  })

  it('dashes: the cooldown starts with the dash flag, the client ends the dash on the ground under 50', () => {
    const camel = entity('camel', { dash: false })
    camel.tick(2)
    camel.meta.dash = true
    camel.tick()
    expect(camel.state()).toMatchObject({ dashAnimationState: 3, jumpCooldown: 54 })
    expect(camel.state(0.25).jumpCooldown).toBe(53.75)
    camel.tick(5)
    expect(camel.state()).toMatchObject({ dashAnimationState: 3, jumpCooldown: 49 })
    camel.tick()
    expect(camel.state()).toMatchObject({ dashAnimationState: null, jumpCooldown: 48 })
    // the server's own clear arrives later: the cooldown keeps running
    camel.meta.dash = false
    camel.tick()
    expect(camel.state().jumpCooldown).toBe(47)
    camel.tick(47)
    expect(camel.state().jumpCooldown).toBe(0)
  })

  it('keeps dashing in the air', () => {
    const camel = entity('camel', { dash: false }, { onGround: false })
    camel.tick()
    camel.meta.dash = true
    camel.tick(20)
    expect(camel.state().dashAnimationState).toBe(2)
  })

  it('walks 6 times the distance eased by 0.2, not while dashing; babies are 0.6 scale', () => {
    const camel = entity('camel', {}, { position: { x: 0, y: 64, z: 0 } })
    camel.tick()
    camel.input.position = { x: 0.1, y: 64, z: 0 }
    camel.tick()
    const speed = f(f(f(0.1) * 6) * f(0.2))
    expect(camel.state(1)).toMatchObject({ walkAnimationSpeed: speed, walkAnimationPos: speed, ageScale: 1 })
    const baby = entity('camel_husk', { baby: true })
    baby.tick()
    expect(baby.state().ageScale).toBe(f(0.6))
  })

  it('is ridden and saddled', () => {
    const camel = entity('camel', {}, { isVehicle: true, equipment: { saddle: 'saddle' } })
    camel.tick()
    expect(camel.state()).toMatchObject({ isRidden: true, saddle: 'saddle' })
  })
})

describe('sniffer', () => {
  it('starts the animation of its synched state at the tick the data came, stopping the others', () => {
    const sniffer = entity('sniffer', { state: 0 })
    sniffer.tick(3)
    expect(sniffer.state()).toMatchObject({ diggingAnimationState: null, isSearching: false })
    sniffer.meta.state = 5
    sniffer.tick()
    expect(sniffer.state().diggingAnimationState).toBe(3)
    sniffer.meta.state = 'searching'
    sniffer.tick()
    expect(sniffer.state()).toMatchObject({ diggingAnimationState: null, isSearching: true })
    sniffer.meta.state = 1
    sniffer.tick()
    expect(sniffer.state()).toMatchObject({ feelingHappyAnimationState: 5, isSearching: false })
  })

  it('a state other than idling at spawn starts its animation', () => {
    const sniffer = entity('sniffer', { state: 'RISING' })
    sniffer.tick()
    expect(sniffer.state().risingAnimationState).toBe(0)
  })
})

describe('armadillo', () => {
  it('rolls up, hides in its shell after 5 ticks', () => {
    const armadillo = entity('armadillo', { armadillo_state: 0 })
    armadillo.tick(2)
    expect(armadillo.state()).toMatchObject({ isHidingInShell: false, rollUpAnimationState: null })
    armadillo.meta.armadillo_state = 1
    armadillo.tick()
    expect(armadillo.state()).toMatchObject({ isHidingInShell: false, rollUpAnimationState: 3 })
    armadillo.tick(4)
    expect(armadillo.state().isHidingInShell).toBe(false)
    armadillo.tick()
    expect(armadillo.state().isHidingInShell).toBe(true)
  })

  it('peeks: fast forwarded when it became scared, restarted by entity event 64; rolls out', () => {
    const armadillo = entity('armadillo', { armadillo_state: 'rolling' })
    armadillo.tick(9)
    armadillo.meta.armadillo_state = 'scared'
    armadillo.tick()
    expect(armadillo.state()).toMatchObject({ peekAnimationState: 10 - 50, rollUpAnimationState: null, isHidingInShell: true })
    armadillo.tick(4)
    expect(armadillo.state().peekAnimationState).toBe(-40)
    armadillo.tracker.event(64)
    armadillo.tick()
    expect(armadillo.state().peekAnimationState).toBe(15)
    armadillo.tick(4)
    armadillo.meta.armadillo_state = 3
    armadillo.tick()
    expect(armadillo.state()).toMatchObject({ rollOutAnimationState: 20, peekAnimationState: null, isHidingInShell: true })
    armadillo.tick(24)
    expect(armadillo.state().isHidingInShell).toBe(true)
    armadillo.tick()
    expect(armadillo.state().isHidingInShell).toBe(false)
    armadillo.meta.armadillo_state = 0
    armadillo.tick()
    expect(armadillo.state()).toMatchObject({ rollOutAnimationState: null, isHidingInShell: false })
  })

  it('scared at spawn: the peek is fast forwarded; babies are 0.6 scale', () => {
    const armadillo = entity('armadillo', { armadillo_state: 2, baby: true })
    armadillo.tick()
    expect(armadillo.state()).toMatchObject({ peekAnimationState: 1 - 50, isHidingInShell: true, ageScale: f(0.6) })
  })
})

describe('strider', () => {
  it('is cold and shakes when suffocating, ridden with passengers', () => {
    const strider = entity('strider', { suffocating: true }, { isVehicle: true })
    strider.tick()
    expect(strider.state()).toMatchObject({ isSuffocating: true, isShaking: true, isRidden: true })
    strider.meta.suffocating = false
    expect(strider.state()).toMatchObject({ isSuffocating: false, isShaking: false })
  })

  it('is saddled by equipment, or the saddle flag before 1.21.5', () => {
    const legacy = entity('strider', { saddle: true }, {}, '1.21.4')
    expect(legacy.state().saddle).toBe('saddle')
    const modern = entity('strider', {}, { equipment: { saddle: 'saddle' } })
    expect(modern.state().saddle).toBe('saddle')
  })
})
