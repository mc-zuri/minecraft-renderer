//@ts-nocheck
import { BasePlaygroundScene } from '../baseScene'

const POSES = ['standing', 'sneaking', 'swimming', 'gliding'] as const

/**
 * Eyeball harness for player postures (setEntityPose / entity.pose field):
 * one static player per pose in a row, plus a "test" player driven by the GUI
 * (pose, walking/sprinting, glide velocity). Everything flows through the
 * regular worldView 'entity' event so the update() pose plumbing is exercised.
 */
export default class extends BasePlaygroundScene {
  continuousRender = true

  private updateIntervalId: NodeJS.Timeout | null = null
  private lastCycle = 0
  private lastHitboxes = false

  override initGui(): void {
    this.params = {
      pose: 'standing',
      moving: false,
      sprinting: false,
      glideVelocityY: -0.3,
      cyclePoses: false,
      hitboxes: false
    }
    this.paramOptions = {
      pose: { options: [...POSES] },
      glideVelocityY: { min: -1, max: 1 }
    }
    super.initGui()
  }

  override setupWorld(): void {
    const stone = this.mcData.blocksByName.stone
    for (let x = -3; x <= 14; x++) {
      for (let z = -3; z <= 6; z++) {
        this.world.setBlockStateId(this.targetPos.offset(x, -1, z), stone.defaultState ?? stone.minStateId)
      }
    }
  }

  private emitEntities() {
    if (!this.worldView) return

    // Static row: one player per pose
    POSES.forEach((pose, i) => {
      this.worldView.emit('entity', {
        id: `pose-${pose}`,
        name: 'player',
        pos: this.targetPos.offset(i * 3, 0, 0),
        width: 0.6,
        height: pose === 'standing' ? 1.8 : pose === 'sneaking' ? 1.5 : 0.6,
        username: pose,
        yaw: Math.PI,
        pitch: 0,
        pose,
        velocity: pose === 'gliding' ? { x: 0.4, y: this.params.glideVelocityY, z: 0 } : undefined
      })
    })

    // GUI-driven test player
    this.worldView.emit('entity', {
      id: 'pose-test',
      name: 'player',
      pos: this.targetPos.offset(5, 0, 4),
      width: 0.6,
      height: 1.8,
      username: `test:${this.params.pose}`,
      yaw: Math.PI,
      pitch: 0,
      pose: this.params.pose,
      velocity: { x: 0.4, y: this.params.glideVelocityY, z: 0 }
    })

    const locomotion = this.params.moving ? (this.params.sprinting ? 'running' : 'walking') : 'idle'
    this.worldRenderer?.entities.playAnimation('pose-test', locomotion)

    if (this.params.hitboxes !== this.lastHitboxes) {
      this.lastHitboxes = this.params.hitboxes
      this.worldRenderer?.entities.setDebugMode(this.params.hitboxes ? 'basic' : 'none')
    }

    if (this.params.cyclePoses && Date.now() - this.lastCycle > 1500) {
      this.lastCycle = Date.now()
      this.params.pose = POSES[(POSES.indexOf(this.params.pose) + 1) % POSES.length]
    }
  }

  override renderFinish(): void {
    this.worldRenderer?.entities.clear()
    this.updateIntervalId ??= setInterval(() => this.emitEntities(), 100)
  }

  override sceneReset(): void {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId)
      this.updateIntervalId = null
    }
  }
}
