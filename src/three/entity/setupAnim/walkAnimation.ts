import { f, lerp } from './mth'

/**
 * The game's WalkAnimationState (LimbAnimator before 1.19.4: limbSwing / limbSwingAmount), advanced once per client tick
 * from how far the entity moved (LivingEntity.calculateEntityAnimation): the target speed is the distance times 4 (at
 * most 1), the speed eases toward it by 0.4, the position advances by the speed (3 times as fast for a baby since
 * 1.19.4's positionScale... and before, where babies were drawn with the adult model's swing).
 */
export class WalkAnimation {
  speedOld = 0
  speed = 0
  position = 0
  positionScale = 1

  update(targetSpeed: number, factor: number, positionScale: number) {
    this.speedOld = this.speed
    this.speed = f(this.speed + f(f(targetSpeed - this.speed) * factor))
    this.position = f(this.position + this.speed)
    this.positionScale = positionScale
  }

  /** updateWalkAnimation: from the distance moved this tick (horizontal, or in 3D for flying and swimming movers). */
  updateFromDistance(distance: number, positionScale = 1) {
    this.update(Math.min(f(f(distance) * 4), 1), f(0.4), positionScale)
  }

  stop() {
    this.speedOld = 0
    this.speed = 0
    this.position = 0
  }

  /** speed(partialTicks) */
  speedAt(partialTicks: number) {
    return Math.min(lerp(partialTicks, this.speedOld, this.speed), 1)
  }

  /** position(partialTicks) */
  positionAt(partialTicks: number) {
    return f(f(this.position - f(this.speed * f(1 - partialTicks))) * this.positionScale)
  }
}

/**
 * Advances a walk animation in client ticks (50 ms) as the game moves a remote entity: a position the server sends is
 * reached over the next 3 ticks (lerpTo / InterpolationHandler: a third, a half, then the rest of the way), and the walk
 * reads how far each tick moved it. Positions keep the time they arrived, so the ticks a slow frame covers each see the
 * positions sent before them, not the newest one for all; the frame's partial tick interpolates between ticks.
 */
export class TickedWalk {
  readonly walk = new WalkAnimation()
  /** where the client's ticks have the entity, and where they move it */
  private current?: Vec3Like
  private target?: Vec3Like
  private lerpSteps = 0
  /** positions sent after the last tick, in order, with when they arrived (ms; undefined: before the next tick) */
  private arrivals: Array<{ at?: number; position: Vec3Like }> = []
  private accumulated = 0
  /** the frame's partial tick, 0 to 1 */
  partialTick = 0

  /** A position the entity was sent (again: ignored), and when it arrived. */
  setPosition(position: Vec3Like, at?: number) {
    const newest = this.arrivals.at(-1)?.position ?? this.target
    if (newest && newest.x === position.x && newest.y === position.y && newest.z === position.z) return
    this.arrivals.push({ at, position: { x: position.x, y: position.y, z: position.z } })
  }

  /** Advances by the frame's time (ending now, ms); returns the number of ticks passed. */
  advance(deltaSeconds: number, options: { useY?: boolean; positionScale?: number; still?: boolean } = {}, now = performance.now()) {
    const delta = Math.max(0, deltaSeconds)
    // the last tick was this long before the frame started
    let tickAt = now - delta * 1000 - this.accumulated * 1000
    this.accumulated += delta
    let ticks = 0
    while (this.accumulated >= 0.05) {
      this.accumulated -= 0.05
      tickAt += 50
      ticks++
      while (this.arrivals.length && (this.arrivals[0].at === undefined || this.arrivals[0].at <= tickAt)) {
        const { position } = this.arrivals.shift()!
        this.target = position
        this.lerpSteps = 3
        // first seen: there, not moved
        this.current ??= position
      }
      const { current, target } = this
      if (!current || !target) continue
      let next = current
      if (this.lerpSteps > 0) {
        const alpha = 1 / this.lerpSteps
        next = { x: current.x + (target.x - current.x) * alpha, y: current.y + (target.y - current.y) * alpha, z: current.z + (target.z - current.z) * alpha }
        this.lerpSteps--
      }
      if (options.still) {
        this.walk.stop()
      } else {
        const dx = next.x - current.x
        const dy = options.useY ? next.y - current.y : 0
        const dz = next.z - current.z
        this.walk.updateFromDistance(Math.sqrt(dx * dx + dy * dy + dz * dz), options.positionScale ?? 1)
      }
      this.current = next
    }
    this.partialTick = Math.min(1, this.accumulated / 0.05)
    return ticks
  }
}

type Vec3Like = { x: number; y: number; z: number }
