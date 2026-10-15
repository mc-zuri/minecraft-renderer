//@ts-nocheck
import { Vec3 } from 'vec3'
import { BasePlaygroundScene } from '../baseScene'

/**
 * Exported entities animating as the game animates them: a warden emerging (and attacking every few seconds), a camel
 * sitting down and standing up, a frog jumping and croaking, a zombie walking back and forth, a boat rowing, a rabbit
 * hopping, an armadillo rolling up. Positions, poses, synched data and entity events are sent as a server would.
 */
export default class AnimationsScene extends BasePlaygroundScene {
  continuousRender = true
  targetPos = new Vec3(2, 90, 2)
  private timers: Array<ReturnType<typeof setInterval>> = []
  private tick = 0

  /** A stone floor under the entities (sections with blocks are the ones the renderer draws entities in). */
  override setupWorld(): void {
    for (let x = 0; x < 16; x++) for (let z = 0; z < 12; z++) this.addWorldBlock(x, 0, z, 'stone')
  }

  /** Synched data by minecraft-data key, as the metadata array the version sends. */
  private metadata(name: string, values: Record<string, unknown>) {
    const keys = this.mcData.entitiesByName[name]?.metadataKeys ?? []
    const metadata: unknown[] = []
    for (const [key, value] of Object.entries(values)) {
      const index = keys.indexOf(key)
      if (index >= 0) metadata[index] = value
    }
    return metadata
  }

  private poseIndex(pose: string) {
    const names = ['STANDING', 'FALL_FLYING', 'SLEEPING', 'SWIMMING', 'SPIN_ATTACK', 'CROUCHING', 'LONG_JUMPING', 'DYING', 'CROAKING', 'USING_TONGUE', 'SITTING', 'ROARING', 'SNIFFING', 'EMERGING', 'DIGGING']
    return names.indexOf(pose)
  }

  private emit(id: number, name: string, pos: Vec3, extra: Record<string, unknown> = {}) {
    this.worldView!.emit('entity', { id, name, pos, width: 0.9, height: 1.8, yaw: Math.PI, pitch: 0, headYaw: Math.PI, ...extra })
  }

  override renderFinish(): void {
    this.worldRenderer?.entities.clear()
    const base = this.targetPos
    // entities are drawn in chunks the renderer has finished: the floor's chunk, also when the playground's mesher is not up
    if (this.worldRenderer) this.worldRenderer.finishedChunks[`${Math.floor(base.x / 16) * 16},${Math.floor(base.z / 16) * 16}`] = true
    // inside the target's chunk (x and z 0 to 15): entities in sections the renderer has loaded are drawn
    const at = (dx: number, dz: number) => base.offset(dx + 5, 1, dz + 2)

    // a warden emerging, then attacking (entity event 4) now and then
    this.emit(1, 'warden', at(-6, 0), { metadata: this.metadata('warden', { pose: this.poseIndex('EMERGING') }) })
    // a camel: sits (last_pose_change_tick < 0) and stands up in turn
    let camelSitting = false
    const camel = () => this.emit(2, 'camel', at(-2, 0), { metadata: this.metadata('camel', { pose: this.poseIndex(camelSitting ? 'SITTING' : 'STANDING'), last_pose_change_tick: camelSitting ? -this.tick : this.tick }) })
    camel()
    // a frog: long jumps and croaks in turn
    let frogPose = 'STANDING'
    const frog = () => this.emit(3, 'frog', at(1, 0), { metadata: this.metadata('frog', { pose: this.poseIndex(frogPose) }) })
    frog()
    // a zombie walking back and forth
    let zombieX = -2
    let zombieDir = 1
    // a boat: rowing with both paddles
    this.emit(5, 'oak_boat', at(4, 0), { renderHints: { boatPaddleLeft: true, boatPaddleRight: true, boatWaterPatchVisible: false } })
    // a rabbit hopping (entity event 1) and an armadillo rolling up and out
    this.emit(6, 'rabbit', at(6, 0))
    let armadilloState = 0
    const armadillo = () => this.emit(7, 'armadillo', at(8, 0), { metadata: this.metadata('armadillo', { armadillo_state: armadilloState }) })
    armadillo()

    this.timers.push(
      setInterval(() => {
        this.tick++
        zombieX += zombieDir * 0.1
        if (zombieX > 2 || zombieX < -2) zombieDir *= -1
        this.emit(4, 'zombie', base.offset(zombieX + 6, 1, 6), { yaw: zombieDir > 0 ? -Math.PI / 2 : Math.PI / 2, headYaw: zombieDir > 0 ? -Math.PI / 2 : Math.PI / 2 })
      }, 50),
      setInterval(() => {
        this.worldRenderer?.entities.handleEntityEvent(1, 4)
        this.worldRenderer?.entities.handleEntityEvent(6, 1)
      }, 2500),
      setInterval(() => {
        camelSitting = !camelSitting
        camel()
        frogPose = frogPose === 'LONG_JUMPING' ? 'CROAKING' : 'LONG_JUMPING'
        frog()
        armadilloState = (armadilloState + 1) % 4
        armadillo()
      }, 4000)
    )

    if (this.camera && this.controls) {
      this.controls.target.set(base.x + 6, base.y + 1.5, base.z + 3)
      this.camera.position.set(base.x + 6, base.y + 5, base.z + 14)
      this.camera.lookAt(base.x + 6, base.y + 1.5, base.z + 3)
      this.controls.update()
      this.syncCameraToBackend()
    }
  }

  override sceneReset(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
  }
}
