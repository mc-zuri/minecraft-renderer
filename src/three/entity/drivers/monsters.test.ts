import { describe, expect, it } from 'vitest'
import { EntityAnimTracker, entityAnimState, registerEntityDrivers, type EntityAnimInput } from '../entityAnimState'
import { f, lerp } from '../setupAnim/mth'
import { MONSTERS_DRIVERS, mthAtan2 } from './monsters'

registerEntityDrivers(MONSTERS_DRIVERS)

const VERSION = '26.3'

/** prismarine yaw (radians) whose game yRot is `degrees` */
const yawFor = (degrees: number) => ((180 - degrees) * Math.PI) / 180

const make = (name: string, meta: Record<string, unknown> = {}, extra: Partial<EntityAnimInput> & Record<string, unknown> = {}) => {
  const tracker = new EntityAnimTracker(name, VERSION)
  const input = { name, version: VERSION, meta, data: {}, bodyYaw: yawFor(0), headYaw: yawFor(0), pitch: 0, position: { x: 0.5, y: 64, z: 0.5 }, onGround: true, ...extra } as EntityAnimInput
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

describe('Mth.atan2', () => {
  it("is the game's table arctangent, bit for bit (values printed by the Java code)", () => {
    for (const [y, x, java] of [
      [0, 1, 0],
      [1, 0, 1.570_796_326_794_896_6],
      [1, 1, 0.785_398_136_641_139_8],
      [-0.3, 2, -0.148_890_067_308_500_8],
      [5, -7, 2.521_343_154_187_537_3],
      [-2, -0.01, -1.575_794_435_381_364_9],
      [0.001, 1000, 9.983_055_580_806_488e-7],
      [123.4, 0.5, 1.566_744_720_582_652_6],
      [10, 10, 0.785_398_113_893_345_9],
      [0.4, 0.3, 0.927_300_169_202_366]
    ] as const) {
      expect(mthAtan2(y, x)).toBe(java)
    }
    // (float) (atan2(1, 0) * 57.2957763671875) - 90.0F
    expect(f(f(mthAtan2(1, 0) * 57.295_776_367_187_5) - 90)).toBe(f(-7.629_394_5e-6))
  })
})

describe('creeper', () => {
  it('swells toward the synched direction, interpolated by the partial tick, over maxSwell - 2', () => {
    const { input, ticks, state } = make('creeper', { swell_dir: 1 })
    ticks(5)
    expect(state(0.5).swelling).toBe(f(f(4.5) / 28))
    input.meta.swell_dir = -1
    ticks(2)
    // 5 -> 4 -> 3
    expect(state(0).swelling).toBe(f(4 / 28))
    expect(state(1).swelling).toBe(f(3 / 28))
    ticks(10)
    expect(state(1).swelling).toBe(0)
  })

  it('stops at 30 and swells when ignited whatever the direction says', () => {
    const { ticks, state } = make('creeper', { swell_dir: -1, is_ignited: true, is_powered: true })
    ticks(40)
    expect(state(0.5).swelling).toBe(f(30 / 28))
    expect(state().isPowered).toBe(true)
  })

  it('stands still when dead', () => {
    const { input, ticks, state } = make('creeper', { swell_dir: 1 })
    ticks(3)
    input.meta.health = 0
    ticks(3)
    expect(state(1).swelling).toBe(f(3 / 28))
  })
})

describe('enderman', () => {
  it('reads the carried block state and creepy', () => {
    const { input, state } = make('enderman', { carry_state: 0, creepy: false })
    expect(state().carriedBlock).toBeUndefined()
    expect(state().isCreepy).toBe(false)
    input.meta.carry_state = 2104
    input.meta.creepy = true
    expect(state().carriedBlock).toBe(2104)
    expect(state().isCreepy).toBe(true)
  })
})

describe('slimes', () => {
  /** AbstractCubeMob.tick by hand */
  const expectedSquish = (grounds: boolean[], decrease: number) => {
    let squish = 0
    let oSquish = 0
    let target = 0
    let was = false
    for (const ground of grounds) {
      oSquish = squish
      squish = f(squish + f(f(target - squish) * 0.5))
      if (ground && !was) target = -0.5
      else if (!ground && was) target = 1
      was = ground
      target = f(target * f(decrease))
    }
    return { squish, oSquish }
  }

  it('slime: landing squashes (-0.5), leaving the ground stretches (1), the target shrinking by 0.6', () => {
    const { input, ticks, state } = make('slime', { size: 4 })
    ticks(3)
    input.onGround = false
    ticks(2)
    const { squish, oSquish } = expectedSquish([true, true, true, false, false], 0.6)
    // tick 1: target -0.3; tick 2: squish -0.15; tick 3: squish -0.165, target -0.108
    expect(expectedSquish([true, true], 0.6).squish).toBe(f(-0.15))
    expect(state(0.25).squish).toBe(lerp(0.25, oSquish, squish))
    expect(state().size).toBe(4)
    expect(squish).toBeGreaterThan(0)
  })

  it('magma cube: the target shrinks by 0.9', () => {
    const { ticks, state } = make('magma_cube', { size: 2 })
    ticks(2)
    // target -0.45 after tick 1, squish -0.225 at tick 2
    expect(state(1).squish).toBe(f(f(-0.5 * f(0.9)) * 0.5))
    expect(state(1).squish).toBe(expectedSquish([true, true], 0.9).squish)
  })

  it('sulfur cube: the fuse starts from MAX_FUSE and counts down; skulls are worn, other blocks contained', () => {
    const { input, ticks, state } = make('sulfur_cube', { size: 1, max_fuse: -1 }, { equipment: { body: 'tnt' } })
    ticks(2)
    expect(state(0.5).fuseRemainingTicks).toBe(0)
    expect(state().containedBlock).toBe('tnt')
    input.meta.max_fuse = 80
    ticks(1)
    expect(state(0.25).fuseRemainingTicks).toBe(f(f(79 - 0.25) + 1))
    ticks(9)
    expect(state(0).fuseRemainingTicks).toBe(71)
    input.equipment = { body: 'creeper_head' }
    expect(state().wornHeadType).toBe('CREEPER')
    expect(state().containedBlock).toBeUndefined()
  })

  it('sulfur cube: a primed spawn (max_fuse in the spawn data) starts the fuse', () => {
    const { ticks, state } = make('sulfur_cube', { max_fuse: 10 })
    ticks(10)
    expect(state(0).fuseRemainingTicks).toBe(1)
    ticks(5)
    expect(state(0.5).fuseRemainingTicks).toBe(0.5)
  })
})

describe('blaze, ghasts, phantom', () => {
  it('blaze: burns while charged', () => {
    const { input, state } = make('blaze', { flags: 0 })
    expect(state().displayFireAnimation).toBe(false)
    input.meta.flags = 1
    expect(state().displayFireAnimation).toBe(true)
  })

  it('ghast: charging', () => {
    expect(make('ghast', { is_charging: true }).state().isCharging).toBe(true)
  })

  it('happy ghast: body item, ridden, leash holder, a baby is 0.2375 of the size', () => {
    const { state } = make('happy_ghast', { baby: true, is_leash_holder: true }, { equipment: { body: 'white_harness' }, isVehicle: true })
    const s = state()
    expect(s.bodyItem).toBe('white_harness')
    expect(s.isRidden).toBe(true)
    expect(s.isLeashHolder).toBe(true)
    expect(s.ageScale).toBe(f(0.2375))
    expect(make('happy_ghast', { baby: false }).state().ageScale).toBe(1)
  })

  it('phantom: flapTime is id * 3 + ageInTicks', () => {
    const { ticks, state } = make('phantom', { size: 3 }, { entityId: 7 })
    ticks(10)
    const s = state(0.5)
    expect(s.flapTime).toBe(f(21 + 10.5))
    expect(s.size).toBe(3)
  })
})

describe('shulker', () => {
  it('peeks 0.05 a tick toward the synched peek / 100, and closes the same way', () => {
    const { input, ticks, state } = make('shulker', { peek: 100, attach_face: 1, color: 3 })
    ticks(1)
    expect(state(1).peekAmount).toBe(f(0.05))
    expect(state(0.5).peekAmount).toBe(lerp(0.5, 0, f(0.05)))
    ticks(30)
    expect(state(1).peekAmount).toBe(1)
    input.meta.peek = 30
    ticks(2)
    expect(state(1).peekAmount).toBe(f(f(1 - f(0.05)) - f(0.05)))
    expect(state().attachFace).toBe('UP')
    expect(state().color).toBe('LIGHT_BLUE')
    input.meta.color = 16
    expect(state().color).toBeNull()
  })

  it('a new block position closes it and draws it from the old position over 6 ticks', () => {
    const { tracker, input, ticks, state } = make('shulker', { peek: 100 })
    ticks(25)
    expect(state(1).peekAmount).toBe(1)
    input.position = { x: 3.5, y: 64, z: 0.5 }
    tracker.setInput(input)
    ticks(1)
    // setPos: interpolation 6, the tick's end: 5; the client's peek data is 0 now
    const offset = state(0).renderOffset
    expect(offset.x).toBeCloseTo(-3 * (5 / 6) ** 2, 12)
    expect(offset.y).toBe(-0)
    expect(state(1).peekAmount).toBe(f(1 - f(0.05)))
    ticks(5)
    expect(state(0).renderOffset).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('head and body rotations', () => {
    const { state } = make('shulker', {}, { headYaw: yawFor(30), bodyYaw: yawFor(10) })
    expect(state().yHeadRot).toBeCloseTo(30, 4)
    expect(state().yBodyRot).toBeCloseTo(10, 4)
  })
})

describe('shulker bullet', () => {
  it('turns halfway toward its movement each tick', () => {
    const { ticks, state } = make('shulker_bullet', {}, { velocity: { x: 1, y: 0, z: 0 } })
    ticks(1)
    // target yRot atan2(0, 1) + 90 = 90, xRot atan2(1, 0) - 90 = 0
    expect(state(1).yRot).toBe(45)
    // the table arctangent is a hair off: atan2(1, 0) * 57.2957763671875 - 90 = -7.6e-6, halved
    expect(state(1).xRot).toBe(f(-7.629_394_5e-6 / 2))
    ticks(1)
    expect(state(1).yRot).toBe(67.5)
    expect(state(0.5).yRot).toBe(f(45 + 0.5 * 22.5))
  })
})

describe('wither', () => {
  it('side heads follow the body 10 degrees a tick without a target', () => {
    const { ticks, state } = make('wither', {}, { bodyYaw: yawFor(45) })
    ticks(1)
    expect(state().yHeadRots[0]).toBeCloseTo(10, 4)
    ticks(4)
    expect(state().yHeadRots).toEqual([f(45), f(45)].map(v => expect.closeTo(v, 4)))
    expect(state().xHeadRots).toEqual([0, 0])
  })

  it('a known target turns its head toward the target eyes (yaw 10, pitch 40 a tick at most)', () => {
    const target = { x: 0.5 + 1.3 + 10, y: 64, z: 0.5, eyeY: 64 + f(2.2) + 10 }
    const { ticks, state } = make('wither', { target_b: 42 }, { lookupEntity: (id: number) => (id === 42 ? target : undefined) })
    ticks(1)
    // yaw -90 (east), pitch -45 (up): clamped to -10 and -40
    expect(state().yHeadRots[0]).toBe(-10)
    expect(state().xHeadRots[0]).toBe(-40)
    ticks(1)
    expect(state().xHeadRots[0]).toBeCloseTo(-45, 4)
    expect(state().yHeadRots[0]).toBe(-20)
    // the other head has no target: follows the body (0)
    expect(state().yHeadRots[1]).toBe(0)
  })

  it('invulnerable ticks and powered at half health', () => {
    const { input, state } = make('wither', { inv: 200, health: 151 })
    expect(state(0.5).invulnerableTicks).toBe(199.5)
    expect(state().isPowered).toBe(false)
    input.meta.health = 150
    expect(state().isPowered).toBe(true)
  })
})

describe('ender dragon', () => {
  it('flaps 0.2 / (horizontal speed * 10 + 1) * 2^ySpeed a tick when flying, and records its flight', () => {
    const { tracker, input, ticks, state } = make('ender_dragon', { phase: 0 }, { velocity: { x: 0.3, y: 0, z: 0.4 }, bodyYaw: yawFor(30) })
    ticks(3)
    const speed = f(f(0.2) / f(f(f(0.5) * 10) + 1))
    let flap = 0
    for (let i = 0; i < 3; i++) flap = f(flap + speed)
    const previous = f(flap - speed)
    expect(state(0.5).flapTime).toBe(lerp(0.5, previous, flap))
    const s = state(0.5)
    expect(s.flightHistory.head).toBe(2)
    expect(s.flightHistory.samples[2].y).toBe(64)
    expect(s.flightHistory.samples[2].yRot).toBeCloseTo(30, 4)
    // the first record filled every sample
    expect(s.flightHistory.samples[63].y).toBe(64)
    expect(s.isSitting).toBe(false)
    expect(s.partialTicks).toBe(0.5)
    input.position = { x: 0.5, y: 70, z: 0.5 }
    ;(input as any).velocity = { x: 0, y: 1, z: 0 }
    tracker.setInput(input)
    ticks(1)
    expect(state(1).flapTime).toBe(f(flap + f(f(0.2) * 2)))
    expect(state().flightHistory.samples[3].y).toBe(70)
  })

  it('sitting phases (and hovering, the default) flap 0.1 a tick; landing and takeoff phases', () => {
    const { input, ticks, state } = make('ender_dragon', {}, { velocity: { x: 1, y: 0, z: 0 } })
    ticks(2)
    expect(state(1).flapTime).toBe(f(f(0.1) + f(0.1)))
    expect(state().isSitting).toBe(true)
    input.meta.phase = 3
    expect(state().isLandingOrTakingOff).toBe(true)
    input.meta.phase = 6
    expect(state().isSitting).toBe(true)
  })

  it('without AI it holds its wings at 0.5 and records nothing', () => {
    const { ticks, state } = make('ender_dragon', { mob_flags: 1, phase: 0 })
    ticks(3)
    expect(state(0.3).flapTime).toBe(0.5)
    expect(state().flightHistory.head).toBe(-1)
  })

  it('dying: the death time counts, the flight history stops and partialTicks is 0', () => {
    const { input, ticks, state } = make('ender_dragon', { phase: 9 }, { velocity: { x: 0, y: 0, z: 0 } })
    ticks(2)
    input.meta.health = 0
    ticks(4)
    const s = state(0.25)
    expect(s.deathTime).toBe(4.25)
    expect(s.partialTicks).toBe(0)
    expect(s.flightHistory.head).toBe(1)
    expect(s.flapTime).toBe(f(f(0.2) + f(0.2)))
  })

  it('distance to the egg from the podium height', () => {
    const { state } = make('ender_dragon', {}, { position: { x: 0.5, y: 70.5, z: 0.5 }, podiumTopY: 64 })
    expect(state().distanceToEgg).toBe(36)
  })
})

describe('end crystal', () => {
  it('time counts ticks; shows its bottom by default; the beam points at the target block center', () => {
    const { input, ticks, state } = make('end_crystal', { beam_target: { x: 10, y: 70, z: -3 } })
    ticks(5)
    const s = state(0.5)
    expect(s.ageInTicks).toBe(5.5)
    expect(s.showsBottom).toBe(true)
    expect(s.beamOffset).toEqual({ x: 10, y: 6.5, z: -3 })
    input.meta.show_bottom = false
    input.meta.beam_target = undefined
    expect(state().showsBottom).toBe(false)
    expect(state().beamOffset).toBeNull()
  })
})
