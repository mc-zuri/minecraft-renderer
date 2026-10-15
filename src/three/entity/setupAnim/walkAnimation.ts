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
 * Advances a walk animation in client ticks (50 ms) from the positions an entity is seen at; the frame's partial tick
 * interpolates between ticks as the game's frame does.
 */
export class TickedWalk {
  readonly walk = new WalkAnimation()
  private last?: { x: number; y: number; z: number }
  private pending?: { x: number; y: number; z: number }
  private accumulated = 0
  /** the frame's partial tick, 0 to 1 */
  partialTick = 0

  /** The entity's latest position (the tick advance reads the newest one). */
  setPosition(position: { x: number; y: number; z: number }) {
    this.pending = { x: position.x, y: position.y, z: position.z }
  }

  /** Advances by the frame's time; returns the number of ticks passed. */
  advance(deltaSeconds: number, options: { useY?: boolean; positionScale?: number; still?: boolean } = {}) {
    this.accumulated += Math.max(0, deltaSeconds)
    let ticks = 0
    while (this.accumulated >= 0.05) {
      this.accumulated -= 0.05
      ticks++
      const position = this.pending ?? this.last
      if (!position) continue
      if (options.still) {
        this.walk.stop()
      } else {
        const last = this.last ?? position
        const dx = position.x - last.x
        const dy = options.useY ? position.y - last.y : 0
        const dz = position.z - last.z
        this.walk.updateFromDistance(Math.sqrt(dx * dx + dy * dy + dz * dz), options.positionScale ?? 1)
      }
      this.last = position
      this.pending = undefined
    }
    this.partialTick = Math.min(1, this.accumulated / 0.05)
    return ticks
  }
}
