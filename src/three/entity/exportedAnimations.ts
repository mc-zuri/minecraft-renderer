import type { EntityAnimation, EntityModelsStore } from 'mc-assets/dist/entityModels'
import type { ExportedEntityRig } from './exportedEntityModels'

/**
 * The game's keyframe animations (net.minecraft.client.animation, exported with the entity models), played on the
 * exported rigs: sampled as KeyframeAnimation.apply does, started and stopped from what drives them in the game (the
 * entity's pose, synched data and entity events), and added to the parts on top of the pose the renderer leaves them in.
 */

/** Per bone: x, y, z (pixels), xRot, yRot, zRot (radians), xScale, yScale, zScale offsets; scale offsets add to 1. */
export type AnimationOffsets = Map<string, Float32Array>

const f = Math.fround

/** Mth.catmullrom */
const catmullrom = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  f(0.5 * f(f(2 * p1) + f(f(p2 - p0) * t) + f(f(f(f(2 * p0) - f(5 * p1)) + f(f(4 * p2) - p3)) * t * t) + f(f(f(f(3 * p1) - p0) - f(f(3 * p2) - p3)) * t * t * t)))

/** Mth.binarySearch: the first index in [from, to) the condition holds for, else to. */
const binarySearch = (from: number, to: number, condition: (index: number) => boolean) => {
  let length = to - from
  while (length > 0) {
    const half = Math.floor(length / 2)
    const middle = from + half
    if (condition(middle)) length = half
    else {
      from = middle + 1
      length -= half + 1
    }
  }
  return from
}

const TARGETS = { position: 0, rotation: 3, scale: 6 } as const

/**
 * The offsets an animation gives its bones at a time (KeyframeAnimation.apply: elapsed seconds, wrapped by the length
 * when it loops; per channel the keyframes around, interpolated as the next keyframe says, times the target scale),
 * added into out.
 */
export function sampleAnimation(animation: EntityAnimation, millis: number, targetScale = 1, out: AnimationOffsets = new Map()): AnimationOffsets {
  let seconds = f(millis / 1000)
  if (animation.looping) seconds = f(seconds % f(animation.length))
  for (const [bone, channels] of Object.entries(animation.bones)) {
    let offsets = out.get(bone)
    if (!offsets) {
      offsets = new Float32Array(9)
      out.set(bone, offsets)
    }
    for (const channel of channels) {
      const keyframes = channel.keyframes
      const prev = Math.max(0, binarySearch(0, keyframes.length, i => seconds <= keyframes[i]!.t) - 1)
      const next = Math.min(keyframes.length - 1, prev + 1)
      const previous = keyframes[prev]!
      const following = keyframes[next]!
      const delta = f(seconds - previous.t)
      const alpha = next === prev ? 0 : Math.min(1, Math.max(0, f(delta / f(following.t - previous.t))))
      let x: number, y: number, z: number
      if (following.i === 'catmullrom') {
        const p0 = keyframes[Math.max(0, prev - 1)]!.v
        const p1 = previous.v
        const p2 = following.v
        const p3 = keyframes[Math.min(keyframes.length - 1, next + 1)]!.v
        x = f(catmullrom(alpha, p0[0], p1[0], p2[0], p3[0]) * targetScale)
        y = f(catmullrom(alpha, p0[1], p1[1], p2[1], p3[1]) * targetScale)
        z = f(catmullrom(alpha, p0[2], p1[2], p2[2], p3[2]) * targetScale)
      } else {
        // Vector3f.lerp from the previous keyframe's target to the next one's incoming target
        const a = previous.v
        const b = following.pre ?? following.v
        x = f(f(a[0] + f(f(b[0] - a[0]) * alpha)) * targetScale)
        y = f(f(a[1] + f(f(b[1] - a[1]) * alpha)) * targetScale)
        z = f(f(a[2] + f(f(b[2] - a[2]) * alpha)) * targetScale)
      }
      const at = TARGETS[channel.target]
      if (at === undefined) continue
      offsets[at] = f(offsets[at]! + x)
      offsets[at + 1] = f(offsets[at + 1]! + y)
      offsets[at + 2] = f(offsets[at + 2]! + z)
    }
  }
  return out
}

/** KeyframeAnimation.applyWalk: the time from the walk position, the strength from the walk speed. */
export const walkTime = (position: number, speed: number, speedFactor: number, scaleFactor: number) => ({
  millis: Math.trunc(f(f(position * 50) * speedFactor)),
  scale: Math.min(f(speed * scaleFactor), 1)
})

/** The game's AnimationState: started at a time (milliseconds here), or stopped. */
export class AnimationState {
  start?: number
  begin(now: number) {
    this.start = now
  }
  beginIfStopped(now: number) {
    if (this.start === undefined) this.start = now
  }
  animateWhen(condition: boolean, now: number) {
    if (condition) this.beginIfStopped(now)
    else this.stop()
  }
  stop() {
    this.start = undefined
  }
  get started() {
    return this.start !== undefined
  }
}

/** What drives an entity's animations: its pose (by name), synched data by minecraft-data's key, entity events. */
export type AnimationInput = {
  pose?: string
  data: (key: string) => unknown
}

type Played = { animation: string; state?: string; walk?: { speedFactor: number; scaleFactor: number; when?: (input: AnimationInput) => boolean; offset?: (age: number) => { position: number; speed: number } } }

/** Per entity: the animations its model applies, in its order, and what starts and stops them (the entity's code). */
type AnimationDriver = {
  /** the animations the model plays: an AnimationState's, or a walk (applyWalk) */
  plays: Played[]
  /** called when the pose or the synched data changes, with the previous pose */
  update?: (states: Record<string, AnimationState>, input: AnimationInput, now: number, previousPose: string | undefined) => void
  /** every frame (the entity's client tick) */
  tick?: (states: Record<string, AnimationState>, input: AnimationInput, now: number, timers: Record<string, number>) => void
  /** entity events (entity_status) */
  event?: (states: Record<string, AnimationState>, id: number, now: number, timers: Record<string, number>) => void
  /** parts shown only while an animation plays (the frog's croaking body) */
  visibleWhile?: Record<string, string>
}

const TICK = 50

/** WardenModel, Warden: pose animations, the attack (event 4) and the sonic boom (event 62); the walk is procedural. */
const warden: AnimationDriver = {
  plays: [
    { animation: 'WardenAnimation.WARDEN_ATTACK', state: 'attack' },
    { animation: 'WardenAnimation.WARDEN_SONIC_BOOM', state: 'sonicBoom' },
    { animation: 'WardenAnimation.WARDEN_DIG', state: 'dig' },
    { animation: 'WardenAnimation.WARDEN_EMERGE', state: 'emerge' },
    { animation: 'WardenAnimation.WARDEN_ROAR', state: 'roar' },
    { animation: 'WardenAnimation.WARDEN_SNIFF', state: 'sniff' }
  ],
  update(states, input, now, previous) {
    if (input.pose === previous) return
    const byPose: Record<string, string> = { EMERGING: 'emerge', DIGGING: 'dig', ROARING: 'roar', SNIFFING: 'sniff' }
    const state = input.pose && byPose[input.pose]
    if (state) states[state]!.begin(now)
  },
  event(states, id, now) {
    if (id === 4) {
      states.roar!.stop()
      states.attack!.begin(now)
    } else if (id === 62) states.sonicBoom!.begin(now)
  }
}

/** FrogModel, Frog: jump, croak and tongue by pose; the walk (on land). */
const frog: AnimationDriver = {
  plays: [
    { animation: 'FrogAnimation.FROG_JUMP', state: 'jump' },
    { animation: 'FrogAnimation.FROG_CROAK', state: 'croak' },
    { animation: 'FrogAnimation.FROG_TONGUE', state: 'tongue' },
    { animation: 'FrogAnimation.FROG_WALK', walk: { speedFactor: 1.5, scaleFactor: 2.5 } }
  ],
  update(states, input, now, previous) {
    if (input.pose === previous) return
    for (const [state, pose] of [['jump', 'LONG_JUMPING'], ['croak', 'CROAKING'], ['tongue', 'USING_TONGUE']] as const) {
      if (input.pose === pose) states[state]!.begin(now)
      else states[state]!.stop()
    }
  },
  visibleWhile: { croaking_body: 'croak' }
}

/** CamelModel, Camel: the walk, sitting down, sat, standing up (last_pose_change_tick), the dash. */
const camel: AnimationDriver = {
  plays: [
    { animation: 'CamelAnimation.CAMEL_WALK', walk: { speedFactor: 2, scaleFactor: 2.5 } },
    { animation: 'CamelAnimation.CAMEL_SIT', state: 'sit' },
    { animation: 'CamelAnimation.CAMEL_SIT_POSE', state: 'sitPose' },
    { animation: 'CamelAnimation.CAMEL_STANDUP', state: 'sitUp' },
    { animation: 'CamelAnimation.CAMEL_DASH', state: 'dash' }
  ],
  update(_states, input, now, _previous) {
    const change = Number(input.data('last_pose_change_tick') ?? 0)
    if (change !== camelPoseChange.get(input)) camelPoseChange.set(input, change), camelPoseChangedAt.set(input, now)
  },
  tick(states, input, now) {
    // the pose time from when the client saw the pose change (the game counts from the level's game time)
    const sitting = Number(input.data('last_pose_change_tick') ?? 0) < 0
    const poseTicks = (now - (camelPoseChangedAt.get(input) ?? -Infinity)) / TICK
    if (sitting) {
      states.sitUp!.stop()
      states.dash!.stop()
      if (poseTicks < 40) {
        states.sit!.beginIfStopped(now)
        states.sitPose!.stop()
      } else {
        states.sit!.stop()
        states.sitPose!.beginIfStopped(now)
      }
    } else {
      states.sit!.stop()
      states.sitPose!.stop()
      states.dash!.animateWhen(!!input.data('dash'), now)
      states.sitUp!.animateWhen(poseTicks < 52, now)
    }
  }
}
const camelPoseChange = new WeakMap<AnimationInput, number>()
const camelPoseChangedAt = new WeakMap<AnimationInput, number>()

/** SnifferModel, Sniffer: by its state (synched), the walk or the searching walk. */
const SNIFFER_STATES = ['IDLING', 'FEELING_HAPPY', 'SCENTING', 'SNIFFING', 'SEARCHING', 'DIGGING', 'RISING']
const sniffer: AnimationDriver = {
  plays: [
    { animation: 'SnifferAnimation.SNIFFER_SNIFF_SEARCH', walk: { speedFactor: 9, scaleFactor: 100, when: input => snifferState(input) === 'SEARCHING' } },
    { animation: 'SnifferAnimation.SNIFFER_WALK', walk: { speedFactor: 9, scaleFactor: 100, when: input => snifferState(input) !== 'SEARCHING' } },
    { animation: 'SnifferAnimation.SNIFFER_DIG', state: 'digging' },
    { animation: 'SnifferAnimation.SNIFFER_LONGSNIFF', state: 'sniffing' },
    { animation: 'SnifferAnimation.SNIFFER_STAND_UP', state: 'rising' },
    { animation: 'SnifferAnimation.SNIFFER_HAPPY', state: 'feelingHappy' },
    { animation: 'SnifferAnimation.SNIFFER_SNIFFSNIFF', state: 'scenting' }
  ],
  update(states, input, now) {
    const state = snifferState(input)
    if (state === snifferSeen.get(input)) return
    snifferSeen.set(input, state)
    for (const name of ['digging', 'sniffing', 'rising', 'feelingHappy', 'scenting']) states[name]!.stop()
    const byState: Record<string, string> = { FEELING_HAPPY: 'feelingHappy', SCENTING: 'scenting', SNIFFING: 'sniffing', DIGGING: 'digging', RISING: 'rising' }
    if (byState[state]) states[byState[state]]!.beginIfStopped(now)
  }
}
const snifferSeen = new WeakMap<AnimationInput, string>()
const snifferState = (input: AnimationInput) => {
  const value = input.data('state')
  return typeof value === 'string' ? value.toUpperCase() : SNIFFER_STATES[Number(value ?? 0)] ?? 'IDLING'
}

/** ArmadilloModel, Armadillo: rolling up, peeking (scared), rolling out by its state; the walk when not in its shell. */
const ARMADILLO_STATES = ['IDLE', 'ROLLING', 'SCARED', 'UNROLLING']
const armadilloState = (input: AnimationInput) => {
  const value = input.data('armadillo_state')
  return typeof value === 'string' ? value.toUpperCase() : ARMADILLO_STATES[Number(value ?? 0)] ?? 'IDLE'
}
const armadillo: AnimationDriver = {
  plays: [
    { animation: 'ArmadilloAnimation.ARMADILLO_WALK', walk: { speedFactor: 16.5, scaleFactor: 2.5, when: input => armadilloState(input) === 'IDLE' } },
    { animation: 'ArmadilloAnimation.ARMADILLO_ROLL_OUT', state: 'rollOut' },
    { animation: 'ArmadilloAnimation.ARMADILLO_ROLL_UP', state: 'rollUp' },
    { animation: 'ArmadilloAnimation.ARMADILLO_PEEK', state: 'peek' }
  ],
  tick(states, input, now) {
    const state = armadilloState(input)
    states.rollOut!.animateWhen(state === 'UNROLLING', now)
    states.rollUp!.animateWhen(state === 'ROLLING', now)
    states.peek!.animateWhen(state === 'SCARED', now)
  }
}

/** BreezeModel, Breeze: the idle always, shooting, inhaling and sliding by pose (sliding back after), the long jump. */
const breeze: AnimationDriver = {
  plays: [
    { animation: 'BreezeAnimation.IDLE', state: 'idle' },
    { animation: 'BreezeAnimation.SHOOT', state: 'shoot' },
    { animation: 'BreezeAnimation.SLIDE', state: 'slide' },
    { animation: 'BreezeAnimation.SLIDE_BACK', state: 'slideBack' },
    { animation: 'BreezeAnimation.INHALE', state: 'inhale' },
    { animation: 'BreezeAnimation.JUMP', state: 'longJump' }
  ],
  update(states, input, now, previous) {
    if (input.pose === previous) return
    for (const name of ['shoot', 'idle', 'inhale', 'longJump']) states[name]!.stop()
    if (input.pose === 'SHOOTING') states.shoot!.beginIfStopped(now)
    else if (input.pose === 'INHALING') states.inhale!.beginIfStopped(now)
    else if (input.pose === 'SLIDING') states.slide!.beginIfStopped(now)
  },
  tick(states, input, now) {
    if (input.pose === 'LONG_JUMPING') states.longJump!.beginIfStopped(now)
    states.idle!.beginIfStopped(now)
    if (input.pose !== 'SLIDING' && states.slide!.started) {
      states.slideBack!.begin(now)
      states.slide!.stop()
    }
  }
}

/** BatModel, Bat: resting or flying (flags bit 1). */
const bat: AnimationDriver = {
  plays: [
    { animation: 'BatAnimation.BAT_FLYING', state: 'fly' },
    { animation: 'BatAnimation.BAT_RESTING', state: 'rest' }
  ],
  tick(states, input, now) {
    const resting = (Number(input.data('flags') ?? 0) & 1) !== 0
    states.fly!.animateWhen(!resting, now)
    states.rest!.animateWhen(resting, now)
  }
}

/** CreakingModel, Creaking: the walk when it can move, the attack (event 4, 15 ticks), invulnerable (event 66, 8 ticks), tearing down. */
const creaking: AnimationDriver = {
  plays: [
    { animation: 'CreakingAnimation.CREAKING_WALK', walk: { speedFactor: 1, scaleFactor: 1, when: input => input.data('can_move') !== false } },
    { animation: 'CreakingAnimation.CREAKING_ATTACK', state: 'attack' },
    { animation: 'CreakingAnimation.CREAKING_INVULNERABLE', state: 'invulnerable' },
    { animation: 'CreakingAnimation.CREAKING_DEATH', state: 'death' }
  ],
  event(_states, id, now, timers) {
    if (id === 4) timers.attack = now + 15 * TICK
    else if (id === 66) timers.invulnerable = now + 8 * TICK
  },
  tick(states, input, now, timers) {
    states.attack!.animateWhen((timers.attack ?? 0) > now, now)
    states.invulnerable!.animateWhen((timers.invulnerable ?? 0) > now, now)
    states.death!.animateWhen(!!input.data('is_tearing_down'), now)
  }
}

/** NautilusModel: swimming always, faster when moving (applyWalk of the walk position plus age / 5). */
const nautilus: AnimationDriver = {
  plays: [{ animation: 'NautilusAnimation.SWIMMING', walk: { speedFactor: 2, scaleFactor: 3, offset: age => ({ position: age / 5, speed: 0.2 }) } }]
}

/** CopperGolemModel: the walk (without items). */
const copperGolem: AnimationDriver = {
  plays: [{ animation: 'CopperGolemAnimation.COPPER_GOLEM_WALK', walk: { speedFactor: 2, scaleFactor: 2.5 } }]
}

const DRIVERS: Record<string, AnimationDriver> = { warden, frog, camel, sniffer, armadillo, breeze, bat, creaking, nautilus, copper_golem: copperGolem }

/** Pose names by protocol order: SITTING came with 1.19.3, the breeze's poses with 1.20.3. */
export const poseName = (value: unknown, version: string) => {
  if (typeof value === 'string') return value.toUpperCase()
  if (typeof value !== 'number') return undefined
  const [, minor = 0, patch = 0] = version.split('.').map(Number)
  const major = Number(version.split('.')[0])
  const after = (m: number, p: number) => major > 1 || minor > m || (minor === m && patch >= p)
  const names = ['STANDING', 'FALL_FLYING', 'SLEEPING', 'SWIMMING', 'SPIN_ATTACK', 'CROUCHING', 'LONG_JUMPING', 'DYING', 'CROAKING', 'USING_TONGUE']
  if (after(19, 3)) names.push('SITTING')
  names.push('ROARING', 'SNIFFING', 'EMERGING', 'DIGGING')
  if (after(20, 3)) names.push('SLIDING', 'SHOOTING', 'INHALING')
  return names[value]
}

/**
 * The keyframe animations of one exported entity: driven like the game drives them, sampled and added to the rig's
 * parts each frame.
 */
export class ExportedEntityAnimator {
  readonly states: Record<string, AnimationState> = {}
  private readonly timers: Record<string, number> = {}
  private readonly animations: Array<{ played: Played; animation: EntityAnimation }> = []
  private previousPose: string | undefined
  private readonly bornAt: number
  /** offsets the export's rest pose already has (an animation playing on a new entity): taken away */
  private readonly restOffsets: AnimationOffsets = new Map()
  readonly input: AnimationInput = { data: () => undefined }

  private constructor(private readonly driver: AnimationDriver, store: EntityModelsStore, version: string, now: number) {
    this.bornAt = now
    for (const played of driver.plays) {
      const animation = store.getAnimation(version, played.animation)
      if (!animation) continue
      this.animations.push({ played, animation })
      if (played.state) this.states[played.state] = new AnimationState()
      // the export drew a new entity: an always running walk (the nautilus') was in its pose
      if (played.walk?.offset) {
        const { position, speed } = played.walk.offset(0)
        const { millis, scale } = walkTime(position, speed, played.walk.speedFactor, played.walk.scaleFactor)
        sampleAnimation(animation, millis, scale, this.restOffsets)
      }
    }
    for (const played of driver.plays) if (played.state && !this.states[played.state]) this.states[played.state] = new AnimationState()
  }

  /** An animator for the entity, when its model plays keyframe animations the export has. */
  static create(name: string, store: EntityModelsStore, version: string, now = performance.now()) {
    const driver = DRIVERS[name]
    if (!driver) return undefined
    const animator = new ExportedEntityAnimator(driver, store, version, now)
    return animator.animations.length ? animator : undefined
  }

  /** The entity's pose and synched data changed (or may have): start and stop what they drive. */
  update(pose: string | undefined, data: (key: string) => unknown, now = performance.now()) {
    this.input.pose = pose
    this.input.data = data
    this.driver.update?.(this.states, this.input, now, this.previousPose)
    this.previousPose = pose
  }

  /** An entity event (entity_status). */
  event(id: number, now = performance.now()) {
    this.driver.event?.(this.states, id, now, this.timers)
  }

  /** Does a walk animation play: the renderer's generic limb swing is then not applied. */
  get walks() {
    return this.animations.some(({ played }) => played.walk)
  }

  /** The offsets of every playing animation now, as the model applies them (walks from the walk position and speed). */
  sample(now: number, walkPosition: number, walkSpeed: number): AnimationOffsets {
    this.driver.tick?.(this.states, this.input, now, this.timers)
    const offsets: AnimationOffsets = new Map()
    const age = (now - this.bornAt) / TICK
    for (const { played, animation } of this.animations) {
      if (played.walk) {
        if (played.walk.when && !played.walk.when(this.input)) continue
        const extra = played.walk.offset?.(age) ?? { position: 0, speed: 0 }
        const { millis, scale } = walkTime(walkPosition + extra.position, walkSpeed + extra.speed, played.walk.speedFactor, played.walk.scaleFactor)
        sampleAnimation(animation, millis, scale, offsets)
      } else if (played.state) {
        const state = this.states[played.state]!
        if (state.start !== undefined) sampleAnimation(animation, Math.trunc(now - state.start), 1, offsets)
      }
    }
    for (const [bone, rest] of this.restOffsets) {
      const own = offsets.get(bone) ?? new Float32Array(9)
      for (let i = 0; i < 9; i++) own[i] = own[i]! - rest[i]!
      offsets.set(bone, own)
    }
    return offsets
  }

  /** Parts shown only while an animation plays, and whether they are shown now. */
  visibility() {
    return Object.entries(this.driver.visibleWhile ?? {}).map(([part, state]) => ({ part, visible: !!this.states[state]?.started }))
  }
}

/**
 * Adds the offsets to the rig's parts (every model entry's part of that name): position in pixels, rotation, scale; parts
 * an animation shows or hides are shown or hidden.
 */
export function applyAnimationOffsets(rig: ExportedEntityRig, offsets: AnimationOffsets, visibility: Array<{ part: string; visible: boolean }> = []) {
  for (const [bone, o] of offsets) {
    for (const part of rig.parts.get(bone) ?? []) {
      part.bone.position.x += o[0]!
      part.bone.position.y += o[1]!
      part.bone.position.z += o[2]!
      part.bone.rotation.x += o[3]!
      part.bone.rotation.y += o[4]!
      part.bone.rotation.z += o[5]!
      if (!part.hidden) {
        part.bone.scale.x += o[6]!
        part.bone.scale.y += o[7]!
        part.bone.scale.z += o[8]!
      }
    }
  }
  for (const { part: name, visible } of visibility) {
    for (const part of rig.parts.get(name) ?? []) {
      if (part.hidden) part.bone.scale.copy(visible ? part.hidden : part.rest.scale)
    }
  }
}
