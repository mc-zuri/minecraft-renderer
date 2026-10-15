import { beforeAll, describe, expect, test } from 'vitest'
import { EntityAnimTracker, entityAnimState, registerEntityDrivers, type EntityAnimInput } from '../entityAnimState'
import { PI, doubleSinCos, f, lerp, makeEase } from '../setupAnim/mth'
import { AQUATIC_DRIVERS, mthAtan2 } from './aquatic'

beforeAll(() => {
  registerEntityDrivers(AQUATIC_DRIVERS)
})

type Input = EntityAnimInput & Record<string, unknown>

const input = (name: string, extra: Partial<Input> = {}): Input => ({
  name,
  version: '26.3',
  meta: {},
  data: {},
  bodyYaw: 0,
  headYaw: 0,
  pitch: 0,
  position: { x: 0, y: 64, z: 0 },
  onGround: false,
  ...extra
})

const tracker = (entity: Input, random?: () => number) => {
  const t = new EntityAnimTracker(entity.name, entity.version)
  if (random) t.memory.random = random
  t.setInput(entity)
  return t
}

/** sets the input, then one client tick */
const tick = (t: EntityAnimTracker, entity: Input) => {
  t.setInput(entity)
  t.tick()
}

const stateAt = (t: EntityAnimTracker, entity: Input, partialTick = 0) => {
  t.walk.partialTick = partialTick
  return entityAnimState(t, entity)
}

const { sin } = doubleSinCos
const ease = makeEase(doubleSinCos)

describe('fish', () => {
  test('isInWater from the input, out of water without it', () => {
    const cod = input('cod')
    expect(stateAt(tracker(cod), cod).isInWater).toBe(false)
    const swimming = input('cod', { isInWater: true })
    expect(stateAt(tracker(swimming), swimming).isInWater).toBe(true)
    const tadpole = input('tadpole', { isInWater: true })
    expect(stateAt(tracker(tadpole), tadpole).isInWater).toBe(true)
  })

  test('salmon variant by id (clamped), medium by default', () => {
    const variant = (type: unknown) => {
      const salmon = input('salmon', { meta: type === undefined ? {} : { type } })
      return stateAt(tracker(salmon), salmon).variant
    }
    expect(variant(undefined)).toBe('MEDIUM')
    expect(variant(0)).toBe('SMALL')
    expect(variant(1)).toBe('MEDIUM')
    expect(variant(2)).toBe('LARGE')
    expect(variant(7)).toBe('LARGE')
    expect(variant('small')).toBe('SMALL')
  })

  test('pufferfish puff state', () => {
    const puffer = input('pufferfish', { meta: { puff_state: 2 } })
    expect(stateAt(tracker(puffer), puffer).puffState).toBe(2)
    const deflated = input('pufferfish')
    expect(stateAt(tracker(deflated), deflated).puffState).toBe(0)
  })

  test('tropical fish pattern and colors from the packed variant', () => {
    // GLITTER (LARGE, index 2) | red << 16 | black << 24
    const packed = (1 | (2 << 8)) | (14 << 16) | (15 << 24)
    const fish = input('tropical_fish', { meta: { type_variant: packed } })
    const state = stateAt(tracker(fish), fish)
    expect(state.pattern).toBe('GLITTER')
    expect(state.patternBase).toBe('LARGE')
    expect(state.baseColor).toBe(0xff_b0_2e_26 | 0) // RED 11546150, opaque, a Java int
    expect(state.patternColor).toBe(0xff_1d_1d_21 | 0) // BLACK 1908001
    // an unknown pattern id is KOB, an out of range dye white
    const unknown = input('tropical_fish', { meta: { type_variant: 7 | (200 << 16) } })
    const fallback = stateAt(tracker(unknown), unknown)
    expect(fallback.pattern).toBe('KOB')
    expect(fallback.patternBase).toBe('SMALL')
    expect(fallback.baseColor).toBe(0xff_f9_ff_fe | 0) // WHITE 16383998
  })
})

describe('dolphin', () => {
  test('isMoving from the horizontal movement, heldItem the main hand', () => {
    const at = (x: number) => input('dolphin', { position: { x, y: 64, z: 0 }, equipment: { mainhand: 'cod' } })
    const t = tracker(at(0))
    tick(t, at(0))
    expect(stateAt(t, at(0)).isMoving).toBe(false)
    tick(t, at(0.1))
    const state = stateAt(t, at(0.1))
    expect(state.isMoving).toBe(true)
    expect(state.heldItem).toBe('cod')
    tick(t, at(0.1))
    expect(stateAt(t, at(0.1)).isMoving).toBe(false)
    // a velocity input wins: 0.0003 a tick is 9e-8 squared, under 1e-7
    const slow = input('dolphin', { velocity: { x: 0.0003, y: 1, z: 0 } })
    const s = tracker(slow)
    tick(s, slow)
    expect(stateAt(s, slow).isMoving).toBe(false)
  })
})

describe('squid', () => {
  test('Mth.atan2: the game values (its code run on a JVM)', () => {
    expect(mthAtan2(0.1, 0)).toBe(1.570_796_326_794_896_6)
    expect(mthAtan2(1, 1)).toBe(0.785_398_136_641_139_8)
    expect(mthAtan2(-0.3, 0.7)).toBe(-0.404_892_693_924_404_8)
    expect(mthAtan2(0.2, -1.5)).toBe(3.009_040_288_234_061)
    expect(mthAtan2(-2, -0.01)).toBe(-1.575_794_435_381_364_9)
    expect(mthAtan2(0.05, -0.08)).toBe(2.582_991_514_115_959)
    expect(mthAtan2(0, 0)).toBe(0)
  })

  test('tentacles beat in water over the first half turn, the body spins once past 3/4 of it', () => {
    const squid = input('squid', { isInWater: true })
    const t = tracker(squid, () => 0) // tentacleSpeed = 1 / (0 + 1) * 0.2
    const speed = f(0.2)
    let movement = 0
    let rotateSpeed = 0
    let zBodyRot = 0
    let angle = 0
    let oldAngle = 0
    let oldZBodyRot = 0
    for (let i = 1; i <= 15; i++) {
      tick(t, squid)
      oldAngle = angle
      oldZBodyRot = zBodyRot
      movement = f(movement + speed)
      if (movement < PI) {
        const scale = f(movement / PI)
        angle = f(f(sin(f(f(scale * scale) * PI)) * PI) * f(0.25))
        rotateSpeed = scale > 0.75 ? 1 : f(rotateSpeed * f(0.8))
      } else {
        angle = 0
        rotateSpeed = f(rotateSpeed * f(0.99))
      }
      zBodyRot = f(zBodyRot + f(f(PI * rotateSpeed) * f(1.5)))
      const state = stateAt(t, squid, 1)
      // the renderer's Mth.lerp(partialTicks, old, new), at 1
      expect(state.tentacleAngle).toBe(lerp(1, oldAngle, angle))
      expect(state.zBodyRot).toBe(lerp(1, oldZBodyRot, zBodyRot))
      // still: no pitch
      expect(state.xBodyRot).toBe(0)
    }
    // 15 ticks: 3.0000002 < PI, scale > 0.75 from tick 12 (2.4)
    expect(rotateSpeed).toBe(1)
    expect(zBodyRot).toBeGreaterThan(0)
    expect(stateAt(t, squid, 0.5).tentacleAngle).toBe(lerp(0.5, oldAngle, angle))
  })

  test('the body pitches toward the movement', () => {
    const squid = input('squid', { isInWater: true, velocity: { x: 0.1, y: 0, z: 0 } })
    const t = tracker(squid, () => 0)
    tick(t, squid)
    // (-((float) Mth.atan2(0.1, 0)) * 57.295776F - 0) * 0.1F on a JVM: -9.0
    expect(stateAt(t, squid, 1).xBodyRot).toBe(lerp(1, 0, -9))
    expect(t.memory.squid.xBodyRot).toBe(-9)
    const other = input('squid', { isInWater: true, velocity: { x: -0.08, y: 0.05, z: 0 } })
    const u = tracker(other, () => 0)
    tick(u, other)
    // horizontal length 0.08, y 0.05: the JVM gives -5.7994514
    expect(u.memory.squid.xBodyRot).toBe(f(-5.799_451_4))
  })

  test('out of water the tentacles flap and the body tips toward -90', () => {
    const squid = input('glow_squid')
    const t = tracker(squid, () => 1) // tentacleSpeed = 1 / 2 * 0.2
    tick(t, squid)
    const movement = f(f(1 / 2) * f(0.2))
    const state = stateAt(t, squid, 1)
    expect(state.tentacleAngle).toBe(f(f(Math.abs(sin(movement)) * PI) * f(0.25)))
    expect(state.xBodyRot).toBe(f(-90 * f(0.02)))
  })

  test('the movement holds at a full turn on the client until entity event 19', () => {
    const squid = input('squid', { isInWater: true })
    const t = tracker(squid, () => 0)
    for (let i = 0; i < 40; i++) tick(t, squid)
    expect(t.memory.squid.tentacleMovement).toBe(f(Math.PI * 2))
    expect(stateAt(t, squid, 1).tentacleAngle).toBe(0)
    t.event(19)
    tick(t, squid)
    expect(t.memory.squid.tentacleMovement).toBe(f(0.2))
    expect(stateAt(t, squid, 1).tentacleAngle).toBeGreaterThan(0)
  })
})

describe('guardian', () => {
  test('tail and spikes: flailing out of water, easing in water', () => {
    const dry = input('guardian')
    const t = tracker(dry, () => 0.5)
    tick(t, dry)
    let state = stateAt(t, dry, 1)
    expect(state.tailAnimation).toBe(2.5) // 0.5 + 2
    expect(state.spikesAnimation).toBe(0.5) // random
    expect(stateAt(t, dry, 0).tailAnimation).toBe(0.5)

    const swimming = input('guardian', { isInWater: true, meta: { moving: true } })
    tick(t, swimming)
    let speed = f(2 + f(f(0.5 - 2) * f(0.1)))
    let tail = f(2.5 + speed)
    let spikes = f(0.5 + f(f(0 - 0.5) * 0.25))
    state = stateAt(t, swimming, 1)
    expect(state.tailAnimation).toBe(tail)
    expect(state.spikesAnimation).toBe(spikes)

    const still = input('guardian', { isInWater: true, meta: { moving: false } })
    tick(t, still)
    speed = f(speed + f(f(0.125 - speed) * f(0.2)))
    tail = f(tail + speed)
    spikes = f(spikes + f(f(1 - spikes) * f(0.06)))
    state = stateAt(t, still, 1)
    expect(state.tailAnimation).toBe(tail)
    expect(state.spikesAnimation).toBe(spikes)

    // moving again from a slow tail: 4
    for (let i = 0; i < 40; i++) tick(t, still)
    const before = t.memory.guardian.tail
    tick(t, swimming)
    expect(t.memory.guardian.tail).toBe(f(before + 4))
  })

  test('a dead guardian stops ticking its tail', () => {
    const dead = input('guardian', { meta: { health: 0 } })
    const t = tracker(dead, () => 0.25)
    tick(t, dead)
    expect(stateAt(t, dead, 1).tailAnimation).toBe(0.25)
  })

  test('attack time counts from the attack target data change, 80 at most', () => {
    const target = { position: { x: 0, y: 64, z: 5 }, eyeHeight: 1.62, height: 1.8 }
    const none = input('guardian', { isInWater: true })
    const attacking = input('guardian', { isInWater: true, meta: { attack_target: 42 }, attackTarget: target, headYaw: Math.PI })
    const t = tracker(none, () => 0)
    tick(t, none)
    tick(t, attacking)
    let state = stateAt(t, attacking, 0.25)
    expect(state.attackTime).toBe(f(1 + 0.25))
    expect(state.attackScale).toBe(f(f(1 + 0.25) / 80))
    expect(state.attackTargetPosition).toEqual({ x: 0, y: 64 + 0.9, z: 5 })
    expect(state.lookAtPosition).toEqual({ x: 0, y: 65.62, z: 5 })
    expect(state.eyePosition).toEqual({ x: 0, y: 64 + f(0.425), z: 0 })
    // head yRot 0: looking south (+z)
    expect(state.lookDirection.x).toBeCloseTo(0, 6)
    expect(state.lookDirection.y).toBeCloseTo(0, 6)
    expect(state.lookDirection.z).toBeCloseTo(1, 6)
    for (let i = 0; i < 100; i++) tick(t, attacking)
    expect(stateAt(t, attacking, 0).attackTime).toBe(80)
    // a new target: from 0 again
    const other = { ...attacking, meta: { attack_target: 43 } }
    tick(t, other)
    expect(stateAt(t, other, 0).attackTime).toBe(1)
    // no target: the beam is gone, the eye looks at the camera
    const camera = { ...none, cameraEyePosition: { x: 3, y: 70, z: 0 } }
    tick(t, camera)
    state = stateAt(t, camera, 0)
    expect(t.memory.guardian.attackTime).toBe(0)
    expect(state.attackTargetPosition).toBeNull()
    expect(state.lookAtPosition).toEqual({ x: 3, y: 70, z: 0 })
    expect(state.lookDirection).not.toBeNull()
  })

  test('an attack target the client does not know: no look target, no beam (the time still counts)', () => {
    const unknown = input('guardian', { isInWater: true, meta: { attack_target: 42 }, cameraEyePosition: { x: 3, y: 70, z: 0 } })
    const t = tracker(unknown, () => 0)
    tick(t, unknown)
    const state = stateAt(t, unknown, 0)
    expect(state.lookAtPosition).toBeNull()
    expect(state.lookDirection).toBeNull()
    expect(state.attackTargetPosition).toBeNull()
    expect(t.memory.guardian.attackTime).toBe(1)
  })

  test('the elder guardian eye height', () => {
    const elder = input('elder_guardian')
    expect(stateAt(tracker(elder, () => 0), elder).eyePosition).toEqual({ x: 0, y: 64 + f(0.998_75), z: 0 })
  })
})

describe('axolotl', () => {
  const STATES = [
    'swimAnimation',
    'walkAnimationState',
    'walkUnderWaterAnimationState',
    'idleUnderWaterAnimationState',
    'idleUnderWaterOnGroundAnimationState',
    'idleOnGroundAnimationState',
    'playDeadAnimationState'
  ]
  const playing = (state: Record<string, unknown>) => STATES.filter(field => state[field] !== null && state[field] !== undefined)

  test('baby: one of seven animation states, by water, ground, moving and playing dead', () => {
    const baby = (extra: Partial<Input>, meta: Record<string, unknown> = {}) => input('axolotl', { ...extra, meta: { baby: true, ...meta } })
    const t = tracker(baby({}))
    const water = baby({ isInWater: true })
    tick(t, water)
    let state = stateAt(t, water)
    expect(playing(state)).toEqual(['idleUnderWaterAnimationState'])
    expect(state.idleUnderWaterAnimationState).toBe(1)
    tick(t, water)
    expect(stateAt(t, water).idleUnderWaterAnimationState).toBe(1) // startIfStopped keeps it

    // the walk speed this tick is read by the next baseTick
    t.walk.walk.speed = 0.5
    tick(t, water)
    expect(playing(stateAt(t, water))).toEqual(['idleUnderWaterAnimationState'])
    tick(t, water)
    state = stateAt(t, water)
    expect(playing(state)).toEqual(['swimAnimation'])
    expect(state.swimAnimation).toBe(4)

    const walkUnderWater = baby({ isInWater: true, onGround: true })
    tick(t, walkUnderWater)
    expect(playing(stateAt(t, walkUnderWater))).toEqual(['walkUnderWaterAnimationState'])
    const walk = baby({ onGround: true })
    tick(t, walk)
    expect(playing(stateAt(t, walk))).toEqual(['walkAnimationState'])
    const falling = baby({})
    tick(t, falling)
    expect(playing(stateAt(t, falling))).toEqual(['walkUnderWaterAnimationState'])

    t.walk.walk.speed = 0
    tick(t, falling)
    tick(t, falling)
    expect(playing(stateAt(t, falling))).toEqual(['idleOnGroundAnimationState'])
    const restingUnderWater = baby({ isInWater: true, onGround: true })
    tick(t, restingUnderWater)
    expect(playing(stateAt(t, restingUnderWater))).toEqual(['idleUnderWaterOnGroundAnimationState'])
    const resting = baby({ onGround: true })
    tick(t, resting)
    expect(playing(stateAt(t, resting))).toEqual(['idleOnGroundAnimationState'])

    // turning is moving
    const turning = baby({ onGround: true, bodyYaw: 1 })
    tick(t, turning)
    expect(playing(stateAt(t, turning))).toEqual(['walkAnimationState'])

    const dead = baby({ isInWater: true }, { playing_dead: true })
    tick(t, dead)
    state = stateAt(t, dead)
    expect(playing(state)).toEqual(['playDeadAnimationState'])
    expect(state.playDeadAnimationState).toBe(t.tickCount)
  })

  test('adult: the factors ease over 10 ticks (in out sine)', () => {
    const water = input('axolotl', { isInWater: true })
    const t = tracker(water)
    tick(t, water)
    let state = stateAt(t, water, 0.5)
    expect(state.inWaterFactor).toBe(ease.inOutSine(f(lerp(0.5, 0, 1) / 10)))
    expect(state.onGroundFactor).toBeCloseTo(0, 10) // -0: Ease.inOutSine(0)
    for (let i = 0; i < 4; i++) tick(t, water)
    expect(stateAt(t, water, 1).inWaterFactor).toBeCloseTo(0.5, 6)
    for (let i = 0; i < 10; i++) tick(t, water)
    expect(stateAt(t, water, 1).inWaterFactor).toBe(1)
    expect(stateAt(t, water, 1).movingFactor).toBeCloseTo(0, 10)

    const dead = input('axolotl', { isInWater: true, meta: { playing_dead: true, variant: 4 } })
    tick(t, dead)
    state = stateAt(t, dead, 1)
    expect(state.playingDeadFactor).toBe(ease.inOutSine(f(1 / 10)))
    expect(state.inWaterFactor).toBe(ease.inOutSine(f(9 / 10)))
    expect(state.variant).toBe('BLUE')
    expect(playing(state)).toEqual([])

    const ground = input('axolotl', { onGround: true, pitch: 0.3 })
    tick(t, ground)
    state = stateAt(t, ground, 1)
    expect(state.onGroundFactor).toBe(ease.inOutSine(f(1 / 10)))
    expect(state.movingFactor).toBe(ease.inOutSine(f(1 / 10))) // the pitch changed
  })
})

describe('frog', () => {
  test('jump, croak and tongue start from the pose data, at the tick count it arrived at', () => {
    const standing = input('frog')
    const t = tracker(standing)
    for (let i = 0; i < 4; i++) tick(t, standing)
    const jumping = input('frog', { pose: 'LONG_JUMPING' })
    tick(t, jumping)
    let state = stateAt(t, jumping)
    expect(state.jumpAnimationState).toBe(4)
    expect(state.croakAnimationState).toBeNull()
    tick(t, jumping)
    expect(stateAt(t, jumping).jumpAnimationState).toBe(4)
    const croaking = input('frog', { pose: 'CROAKING' })
    tick(t, croaking)
    state = stateAt(t, croaking)
    expect(state.jumpAnimationState).toBeNull()
    expect(state.croakAnimationState).toBe(6)
    const tongue = input('frog', { pose: 'USING_TONGUE' })
    tick(t, tongue)
    state = stateAt(t, tongue)
    expect(state.croakAnimationState).toBeNull()
    expect(state.tongueAnimationState).toBe(7)
    tick(t, standing)
    state = stateAt(t, standing)
    expect(state.tongueAnimationState).toBeNull()
    expect(state.jumpAnimationState).toBeNull()
  })

  test('swim idle in water while the walk is still; swimming walk speed from distance * 25', () => {
    const at = (x: number) => input('frog', { isInWater: true, position: { x, y: 64, z: 0 } })
    const t = tracker(at(0))
    tick(t, at(0))
    let state = stateAt(t, at(0), 1)
    expect(state.swimIdleAnimationState).toBe(1)
    expect(state.isSwimming).toBe(true)
    expect(state.isInWater).toBe(true)
    // 0.1 a tick: target min(0.1 * 25, 1) = 1, speed 0 + 1 * 0.4; swim idle reads the walk before this update
    tick(t, at(0.1))
    state = stateAt(t, at(0.1), 1)
    expect(state.walkAnimationSpeed).toBe(f(0.4))
    expect(state.walkAnimationPos).toBe(f(0.4))
    expect(state.swimIdleAnimationState).toBe(1)
    tick(t, at(0.2))
    state = stateAt(t, at(0.2), 1)
    expect(state.swimIdleAnimationState).toBeNull()
    // 0.01 a tick is already a full speed walk for a frog (0.25 at the usual distance * 4 would be 0.04)
    const speed = f(0.4 + f(f(1 - f(0.4)) * f(0.4)))
    expect(state.walkAnimationSpeed).toBe(speed)
    expect(stateAt(t, at(0.2), 0).walkAnimationSpeed).toBe(f(0.4))
    // on land: no swim idle
    const land = input('frog', { position: { x: 0.2, y: 64, z: 0 } })
    tick(t, land)
    expect(stateAt(t, land).swimIdleAnimationState).toBeNull()
    expect(stateAt(t, land).isSwimming).toBe(false)
  })

  test('the walk target is 0 while jumping', () => {
    const at = (x: number, pose?: string) => input('frog', { pose, position: { x, y: 64, z: 0 } })
    const t = tracker(at(0))
    tick(t, at(0))
    tick(t, at(0.1))
    tick(t, at(0.2, 'LONG_JUMPING'))
    expect(stateAt(t, at(0.2, 'LONG_JUMPING'), 1).walkAnimationSpeed).toBe(f(f(0.4) + f(f(0 - f(0.4)) * f(0.4))))
  })
})

describe('nautilus', () => {
  test('saddle and body armor; the zombie nautilus variant', () => {
    const nautilus = input('nautilus', { equipment: { body: 'iron_nautilus_armor', saddle: 'saddle' } })
    const state = stateAt(tracker(nautilus), nautilus)
    expect(state.bodyArmorItem).toBe('iron_nautilus_armor')
    expect(state.saddle).toBe('saddle')
    const zombie = input('zombie_nautilus', { meta: { variant: 1 } })
    const zombieState = stateAt(tracker(zombie), zombie)
    expect(zombieState.bodyArmorItem).toBeUndefined()
    expect(zombieState.variant).toBe(1)
  })
})
