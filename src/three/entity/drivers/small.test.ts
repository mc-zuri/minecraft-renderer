import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntityAnimTracker, entityAnimState, registerEntityDrivers, type EntityAnimInput } from '../entityAnimState'
import { PI, doubleSinCos, f } from '../setupAnim/mth'
import { SMALL_DRIVERS } from './small'

registerEntityDrivers(SMALL_DRIVERS)

type Extra = Partial<EntityAnimInput> & Record<string, unknown>

const makeInput = (name: string, meta: Record<string, unknown> = {}, extra: Extra = {}): EntityAnimInput => ({
  name,
  version: '26.3',
  meta,
  data: {},
  bodyYaw: 0,
  headYaw: 0,
  pitch: 0,
  onGround: true,
  position: { x: 0, y: 64, z: 0 },
  ...extra
})

/** A tracker fed with the input, ticked n times (the input may be changed between calls); the state at the end of the last tick (partial tick 1) unless told. */
const setup = (input: EntityAnimInput) => {
  const tracker = new EntityAnimTracker(input.name, input.version)
  tracker.setInput(input)
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      tracker.setInput(input)
      tracker.tick()
    }
  }
  const state = (partialTick = 1) => {
    tracker.walk.partialTick = partialTick
    return entityAnimState(tracker, input)
  }
  return { tracker, tick, state }
}

/** x += (target - x) * 0.4 in floats */
const approach = (x: number, target: number) => f(x + f(f(target - x) * f(0.4)))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('wolf', () => {
  it('tilts the head while interested (interestedAngle eases by 0.4, roll 0.15 PI)', () => {
    const input = makeInput('wolf', { interested: true })
    const { tick, state } = setup(input)
    tick()
    const a1 = approach(0, 1)
    expect(a1).toBe(f(0.4))
    expect(state().headRollAngle).toBe(f(f(a1 * f(0.15)) * PI))
    tick()
    const a2 = approach(a1, 1)
    expect(state().headRollAngle).toBe(f(f(a2 * f(0.15)) * PI))
    // halfway between the two ticks
    expect(state(0.5).headRollAngle).toBe(f(f(f(a1 + f(0.5 * f(a2 - a1))) * f(0.15)) * PI))
    input.meta.interested = false
    tick()
    expect(state().headRollAngle).toBe(f(f(approach(a2, 0) * f(0.15)) * PI))
  })

  it('shakes from entity event 8: shakeAnim + 0.05 a tick until the previous value reaches 2', () => {
    const input = makeInput('wolf')
    const { tracker, tick, state } = setup(input)
    tick(3)
    expect(state().shakeAnim).toBe(0)
    tracker.event(8)
    let anim = 0
    let ticks = 0
    let previous = 0
    // simulate Wolf.tick's float steps
    while (true) {
      previous = anim
      anim = f(anim + f(0.05))
      ticks++
      if (previous >= 2) break
      tick()
      expect(state().shakeAnim).toBe(anim)
    }
    expect(ticks).toBe(42) // 0.05F added 40 times is still under 2: the reset comes on the 42nd tick
    tick()
    expect(state().shakeAnim).toBe(0)
    expect(tracker.memory.wolf.isShaking).toBe(false)
    // interpolated between ticks
    tracker.event(8)
    tick(2)
    expect(state(0.5).shakeAnim).toBe(f(f(0.05) + f(0.5 * f(f(f(0.05) + f(0.05)) - f(0.05)))))
  })

  it('event 56 cancels the shake; in water the client gets wet and the shake stops advancing', () => {
    const input = makeInput('wolf')
    const { tracker, tick, state } = setup(input)
    tracker.event(8)
    tick(5)
    tracker.event(56)
    expect(state().shakeAnim).toBe(0)
    tick(2)
    expect(state().shakeAnim).toBe(0)
    ;(input as any).isInWater = true
    tick()
    expect(state().wetShade).toBe(0.75)
    tracker.event(8)
    tick(3)
    expect(state().shakeAnim).toBe(0)
    ;(input as any).isInWater = false
    tick(4)
    // wet: 0.75 + shake / 2 * 0.25
    const s = state().shakeAnim
    expect(s).toBeCloseTo(0.2, 6)
    expect(state().wetShade).toBe(f(f(0.75) + f(f(s / 2) * f(0.25))))
  })

  it('sits from the tamable flags; tail from anger, health and taming', () => {
    const input = makeInput('wolf', { flags: 0, health: 8 })
    const { state } = setup(input)
    expect(state().isSitting).toBe(false)
    expect(state().tailAngle).toBe(f(0.628_318_55))
    input.meta.flags = 4 | 1
    input.meta.health = 20
    expect(state().isSitting).toBe(true)
    // tame: max health 40, half health: (0.55 - 0.5 * 0.4) * PI
    expect(state().tailAngle).toBe(f(f(f(0.55) - f(f(0.5) * f(0.4))) * PI))
    ;(input as any).maxHealth = 20
    expect(state().tailAngle).toBe(f(f(0.55) * PI))
    input.meta.anger_end_time = 1000
    ;(input as any).gameTime = 900
    expect(state().isAngry).toBe(true)
    expect(state().tailAngle).toBe(f(1.539_380_4))
    ;(input as any).gameTime = 1000
    expect(state().isAngry).toBe(false)
    input.meta.anger_end_time = -1
    delete (input as any).gameTime
    expect(state().isAngry).toBe(false)
    input.meta.anger_end_time = [0, 5000]
    expect(state().isAngry).toBe(true)
  })
})

describe('cat and ocelot', () => {
  it('lies down by 0.15 (tail 0.08) a tick and gets up by 0.22 (tail 0.13)', () => {
    const input = makeInput('cat', { is_lying: true })
    const { tick, state } = setup(input)
    tick(3)
    let amount = 0
    let tail = 0
    for (let i = 0; i < 3; i++) {
      amount = Math.min(1, f(amount + f(0.15)))
      tail = Math.min(1, f(tail + f(0.08)))
    }
    expect(state().lieDownAmount).toBe(amount)
    expect(state().lieDownAmountTail).toBe(tail)
    tick(10)
    expect(state().lieDownAmount).toBe(1)
    input.meta.is_lying = false
    tick()
    expect(state().lieDownAmount).toBe(f(1 - f(0.22)))
    expect(state(0.5).lieDownAmount).toBe(f(1 + f(0.5 * f(f(1 - f(0.22)) - 1))))
  })

  it('relaxes by 0.1 a tick, sits from the flags, sprints from shared flag 3, crouches from the pose', () => {
    const input = makeInput('cat', { relax_state_one: true, flags: 1, shared_flags: 0x08 })
    const { tick, state } = setup(input)
    tick(2)
    expect(state().relaxStateOneAmount).toBe(f(f(0.1) + f(0.1)))
    expect(state().isSitting).toBe(true)
    expect(state().isSprinting).toBe(true)
    expect(state().isCrouching).toBe(false)
    input.pose = 'CROUCHING'
    input.meta.shared_flags = 0
    expect(state().isCrouching).toBe(true)
    expect(state().isSprinting).toBe(false)
  })

  it('an ocelot crouches and sprints but never sits or lies', () => {
    const input = makeInput('ocelot', { shared_flags: 0x08, flags: 1 }, { pose: 'STANDING' })
    const { tick, state } = setup(input)
    tick(3)
    expect(state().isSprinting).toBe(true)
    expect(state().isSitting).toBe(false)
    expect(state().lieDownAmount).toBe(0)
    input.pose = 'CROUCHING'
    expect(state().isCrouching).toBe(true)
  })
})

describe('fox', () => {
  it('crouches by 0.2 a tick up to 5, back to 0 at once', () => {
    const input = makeInput('fox', { flags: 4 })
    const { tick, state } = setup(input)
    tick(3)
    const three = f(f(f(0.2) + f(0.2)) + f(0.2))
    expect(state().crouchAmount).toBe(three)
    expect(state().isCrouching).toBe(true)
    tick(30)
    expect(state().crouchAmount).toBe(5)
    input.meta.flags = 0
    tick()
    expect(state().crouchAmount).toBe(0)
    expect(state(0.5).crouchAmount).toBe(2.5)
    expect(state().isCrouching).toBe(false)
  })

  it('tilts the head while interested (0.11 PI) and reads the other flags', () => {
    const input = makeInput('fox', { flags: 8 })
    const { tick, state } = setup(input)
    tick()
    expect(state().headRollAngle).toBe(f(f(f(0.4) * f(0.11)) * PI))
    input.meta.flags = 1 | 16 | 32 | 64
    const s = state()
    expect([s.isSitting, s.isPouncing, s.isSleeping, s.isFaceplanted, s.isCrouching]).toEqual([true, true, true, true, false])
  })
})

describe('rabbit', () => {
  it('hops from entity event 1: the tick after, for the 15 jump ticks', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const input = makeInput('rabbit')
    const { tracker, tick, state } = setup(input)
    tick(5)
    tracker.event(1)
    tick() // tick 6: jumpTicks 0 when the states are set up, 1 after aiStep
    expect(state().hopAnimationState).toBeNull()
    expect(state(0.5).jumpCompletion).toBe(f(f(1.5) / 15))
    tick() // tick 7
    expect(state().hopAnimationState).toBe(7)
    tick(14) // ticks 8 - 21
    expect(state().hopAnimationState).toBe(7)
    expect(state().jumpCompletion).toBe(0)
    tick() // tick 22
    expect(state().hopAnimationState).toBeNull()
  })

  it('tilts the head when the idle timeout (180 + random 40) runs out, not while leashed or without AI', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const input = makeInput('rabbit')
    const { tracker, tick, state } = setup(input)
    tick(180)
    expect(state().idleHeadTiltAnimationState).toBeNull()
    tick()
    expect(state().idleHeadTiltAnimationState).toBe(181)
    // a hop stops it
    tracker.event(1)
    tick(2)
    expect(state().idleHeadTiltAnimationState).toBeNull()
    expect(state().hopAnimationState).toBe(183)

    const leashedInput = makeInput('rabbit', {}, { leashed: true })
    const leashed = setup(leashedInput)
    leashed.tick(300)
    expect(leashed.state().idleHeadTiltAnimationState).toBeNull()

    const noAi = setup(makeInput('rabbit', { mob_flags: 1 }))
    noAi.tick(300)
    expect(noAi.state().idleHeadTiltAnimationState).toBeNull()
  })
})

describe('chicken', () => {
  it('flaps off the ground: flapSpeed + 1.2 (clamped), flapping * 0.9, flap + flapping * 2', () => {
    const input = makeInput('chicken', {}, { onGround: false })
    const { tick, state } = setup(input)
    tick()
    expect(state().flapSpeed).toBe(1)
    expect(state().flap).toBe(f(f(f(1) * f(0.9)) * 2))
    tick()
    const flap2 = f(f(f(0.9) * 2) + f(f(1 * f(0.9)) * 2))
    expect(state().flap).toBe(flap2)
    input.onGround = true
    tick()
    // on the ground: flapSpeed - 0.3, flapping keeps decaying from 0.9
    expect(state().flapSpeed).toBe(f(1 + f(-1 * f(0.3))))
    const flap3 = f(flap2 + f(f(f(0.9) * f(0.9)) * 2))
    expect(state().flap).toBe(flap3)
    expect(state(0.5).flap).toBe(f(flap2 + f(0.5 * f(flap3 - flap2))))
  })
})

describe('parrot', () => {
  it('flies off the ground, stands on it, sits from the flags; flapAngle = (sin(flap) + 1) * flapSpeed', () => {
    const input = makeInput('parrot', {}, { onGround: false })
    const { tick, state } = setup(input)
    tick()
    const flap = f(f(1 * f(0.9)) * 2)
    expect(state().parrotPose).toBe('FLYING')
    expect(state().flapAngle).toBe(f(f(doubleSinCos.sin(flap) + 1) * 1))
    input.onGround = true
    expect(state().parrotPose).toBe('STANDING')
    input.meta.flags = 1
    expect(state().parrotPose).toBe('SITTING')
    // riding: the wings slow down even off the ground
    const riding = setup(makeInput('parrot', {}, { onGround: false, isPassenger: true }))
    riding.tick()
    expect(riding.state().flapAngle).toBe(0)
  })

  it('parties near the jukebox it was told about, until it leaves its range', () => {
    const input = makeInput('parrot', {}, { recordPlayingNearby: { x: 1, y: 64, z: 0 } })
    const { tick, state } = setup(input)
    expect(state().parrotPose).toBe('PARTY')
    tick()
    expect(state().parrotPose).toBe('PARTY')
    input.position = { x: 10, y: 64, z: 0 }
    tick()
    expect(state().parrotPose).toBe('STANDING')
    // back in range: forgotten until notified again
    input.position = { x: 1, y: 64, z: 0 }
    tick()
    expect(state().parrotPose).toBe('STANDING')
    ;(input as any).recordPlayingNearby = { x: 2, y: 64, z: 0 }
    tick()
    expect(state().parrotPose).toBe('PARTY')
    ;(input as any).recordPlayingNearby = undefined
    expect(state().parrotPose).toBe('STANDING')
  })
})

describe('bat', () => {
  it('runs the fly animation, or the rest animation while resting (flags & 1)', () => {
    const input = makeInput('bat', { flags: 0 })
    const { tick, state } = setup(input)
    tick()
    expect(state().flyAnimationState).toBe(1)
    expect(state().restAnimationState).toBeNull()
    tick(3)
    expect(state().flyAnimationState).toBe(1)
    input.meta.flags = 1
    tick()
    expect(state().isResting).toBe(true)
    expect(state().flyAnimationState).toBeNull()
    expect(state().restAnimationState).toBe(5)
  })
})

describe('bee', () => {
  it('rolls by 0.2 a tick while rolling (flags & 2), back by 0.24', () => {
    const input = makeInput('bee', { flags: 2 })
    const { tick, state } = setup(input)
    tick(2)
    expect(state().rollAmount).toBe(f(f(0.2) + f(0.2)))
    input.meta.flags = 0
    tick()
    const after = f(f(f(0.2) + f(0.2)) - f(0.24))
    expect(state().rollAmount).toBe(after)
    expect(state(0.5).rollAmount).toBe(f(f(f(0.2) + f(0.2)) + f(0.5 * f(after - f(f(0.2) + f(0.2))))))
  })

  it('stinger, nectar, anger, and on the ground only when still', () => {
    const input = makeInput('bee', { flags: 4 | 8, anger_end_time: 50 }, { gameTime: 10 })
    const { tick, state } = setup(input)
    tick(2)
    const s = state()
    expect([s.hasStinger, s.hasNectar, s.isAngry, s.isOnGround]).toEqual([false, true, true, true])
    input.position = { x: 0.5, y: 64, z: 0 }
    tick()
    expect(state().isOnGround).toBe(false)
    tick()
    expect(state().isOnGround).toBe(true)
    input.onGround = false
    expect(state().isOnGround).toBe(false)
  })
})

describe('allay', () => {
  it('raises the arms over 5 ticks while holding an item', () => {
    const input = makeInput('allay', {}, { equipment: { mainhand: 'amethyst_shard' } })
    const { tick, state } = setup(input)
    tick(2)
    expect(state().holdingAnimationProgress).toBe(f(2 / 5))
    expect(state(0.5).holdingAnimationProgress).toBe(f(f(1.5) / 5))
    tick(10)
    expect(state().holdingAnimationProgress).toBe(1)
    input.equipment = { mainhand: 'air' }
    tick()
    expect(state().holdingAnimationProgress).toBe(f(4 / 5))
  })

  it('dances: spins the first 15 of every 55 dancing ticks', () => {
    const input = makeInput('allay', { dancing: true })
    const { tick, state } = setup(input)
    tick(14)
    expect(state().isDancing).toBe(true)
    expect(state().isSpinning).toBe(true)
    expect(state().spinningProgress).toBe(f(14 / 15))
    tick()
    expect(state().isSpinning).toBe(false)
    expect(state().spinningProgress).toBe(f(13 / 15))
    tick(39) // dancing tick 54
    expect(state().spinningProgress).toBe(0)
    tick() // 55 % 55 = 0: spinning again
    expect(state().isSpinning).toBe(true)
    expect(state().spinningProgress).toBe(f(1 / 15))
    input.meta.dancing = false
    tick()
    expect(state().spinningProgress).toBe(0)
  })
})

describe('vex', () => {
  it('charges from flags & 1; items by arm', () => {
    const input = makeInput('vex', { flags: 1, mob_flags: 0 }, { equipment: { mainhand: 'iron_sword', offhand: 'air' } })
    const { state } = setup(input)
    const s = state()
    expect(s.isCharging).toBe(true)
    expect(s.rightHandItem).toBe('iron_sword')
    expect(s.leftHandItem).toBeUndefined()
    input.meta.mob_flags = 2 // left handed
    expect(state().leftHandItem).toBe('iron_sword')
    input.meta.flags = 0
    expect(state().isCharging).toBe(false)
  })
})
