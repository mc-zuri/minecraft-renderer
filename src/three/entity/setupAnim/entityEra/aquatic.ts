import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { applyKeyframes, applyWalkAnimation } from '../keyframes'
import { DEG_TO_RAD, HALF_PI, PI, f, rotLerp, sqrt } from '../mth'

/**
 * Fish, dolphins, squids, guardians, axolotls, frogs and tadpoles of 1.14.4 to 1.21.1 (posed from the entity).
 *
 * Entity values the code reads that the samples never vary, with their defaults when absent:
 * - `entity.wasTouchingWater` (Entity.isInWater; false: the sampled entities are out of water) and
 *   `entity.isInBubbleColumn` (the block at the entity is a bubble column; false), for isInWaterOrBubble;
 * - `entity.deltaMovement` ({x, y, z}, zero), `entity.onGround` (false), `entity.tickCount` (0), `entity.xRotO` (0) and
 *   the axolotl's `entity.xRot` / `entity.yRot` / `entity.yRotO` / `entity.x` / `entity.xOld` / `entity.z` / `entity.zOld` (0).
 */

/** The synched data of that name (the dataNames the state carries map names to indexes), else its default. */
const data = (state: AnimState, name: string, fallback: unknown) => {
  const names = (state.dataNames ?? {}) as Record<string, string>
  for (const [index, other] of Object.entries(names)) {
    if (other !== name) continue
    const value = state[`data.${index}`]
    return value === undefined ? fallback : value
  }
  return fallback
}

/** Entity.isInWater */
const isInWater = (state: AnimState) => !!state['entity.wasTouchingWater']

/** Entity.isInWaterOrBubble */
const isInWaterOrBubble = (state: AnimState) => isInWater(state) || !!state['entity.isInBubbleColumn']

type Vec3 = { x: number; y: number; z: number }

const deltaMovement = (state: AnimState): Vec3 => (state['entity.deltaMovement'] as Vec3 | undefined) ?? { x: 0, y: 0, z: 0 }

/** The model's inputs, 0 when absent (the game's first sample passes zeros). */
const inputs = (state: AnimState): AnimState => ({ walkAnimationPos: 0, walkAnimationSpeed: 0, ageInTicks: 0, yRot: 0, xRot: 0, partialTick: 0, ...state })

/** the part of the first name the version's model has */
const either = (m: AnimModel, ...names: string[]) => {
  for (const name of names) {
    const part = m.model.maybe(name)
    if (part) return part
  }
  throw new Error(`no part ${names.join(' / ')}`)
}

/** a 1.14.4 - 1.16.5 (legacy layer) model: parts are named after the fields */
const legacy = (m: AnimModel) => !m.c.atLeast('1.17')

export class CodModel extends AnimModel {
  tailFin = this.part('tail_fin')

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    let amplitudeMultiplier = 1
    if (!isInWater(state)) amplitudeMultiplier = 1.5
    this.tailFin.yRot = f(f(-amplitudeMultiplier * f(0.45)) * this.c.sin(f(f(0.6) * state.ageInTicks)))
  }
}

export class SalmonModel extends AnimModel {
  bodyBack = this.part('body_back')

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    let amplitudeMultiplier = 1
    let angleMultiplier = 1
    if (!isInWater(state)) {
      amplitudeMultiplier = f(1.3)
      angleMultiplier = f(1.7)
    }
    this.bodyBack.yRot = f(f(-amplitudeMultiplier * 0.25) * this.c.sin(f(f(angleMultiplier * f(0.6)) * state.ageInTicks)))
  }
}

/** PufferfishBigModel (1.14.4 - 1.16.5: blueFin0 / blueFin1 = right / left) */
export class PufferfishBigModel extends AnimModel {
  rightBlueFin = either(this, 'right_blue_fin', 'blue_fin0')
  leftBlueFin = either(this, 'left_blue_fin', 'blue_fin1')

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    const { sin } = this.c
    this.rightBlueFin.zRot = f(f(-0.2) + f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
    this.leftBlueFin.zRot = f(f(0.2) - f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
  }
}

/** PufferfishMidModel: the same code (1.14.4 - 1.16.5: finBlue0 / finBlue1) */
export class PufferfishMidModel extends AnimModel {
  rightBlueFin = either(this, 'right_blue_fin', 'fin_blue0')
  leftBlueFin = either(this, 'left_blue_fin', 'fin_blue1')

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    const { sin } = this.c
    this.rightBlueFin.zRot = f(f(-0.2) + f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
    this.leftBlueFin.zRot = f(f(0.2) - f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
  }
}

/** PufferfishSmallModel (1.14.4 - 1.16.5: fin0 / fin1) */
export class PufferfishSmallModel extends AnimModel {
  rightFin = either(this, 'right_fin', 'fin0')
  leftFin = either(this, 'left_fin', 'fin1')

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    const { sin } = this.c
    this.rightFin.zRot = f(f(-0.2) + f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
    this.leftFin.zRot = f(f(0.2) - f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
  }
}

export class TropicalFishModelA extends AnimModel {
  tail = this.part('tail')

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    let amplitudeMultiplier = 1
    if (!isInWater(state)) amplitudeMultiplier = 1.5
    this.tail.yRot = f(f(-amplitudeMultiplier * f(0.45)) * this.c.sin(f(f(0.6) * state.ageInTicks)))
  }
}

/** TropicalFishModelB: the same code as TropicalFishModelA. */
export class TropicalFishModelB extends TropicalFishModelA {}

export class DolphinModel extends AnimModel {
  body = this.part('body')
  tail = this.part('tail')
  tailFin = this.part('tail_fin')

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    const { cos } = this.c
    this.body.xRot = f(state.xRot * DEG_TO_RAD)
    this.body.yRot = f(state.yRot * DEG_TO_RAD)
    const movement = deltaMovement(state)
    if (movement.x * movement.x + movement.z * movement.z > 1e-7) {
      this.body.xRot = f(this.body.xRot + f(f(-0.05) - f(f(0.05) * cos(f(state.ageInTicks * f(0.3))))))
      this.tail.xRot = f(f(-0.1) * cos(f(state.ageInTicks * f(0.3))))
      this.tailFin.xRot = f(f(-0.2) * cos(f(state.ageInTicks * f(0.3))))
    }
  }
}

/** SquidModel: ageInTicks is the tentacle angle the renderer passes (SquidRenderer.getBob). */
export class SquidModel extends AnimModel {
  tentacles = Array.from({ length: 8 }, (_, i) => either(this, `tentacle${i}`, `tentacles_${i}`))

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    for (const tentacle of this.tentacles) tentacle.xRot = state.ageInTicks
  }
}

const SPIKE_X_ROT = [1.75, 0.25, 0, 0, 0.5, 0.5, 0.5, 0.5, 1.25, 0.75, 0, 0]
const SPIKE_Y_ROT = [0, 0, 0, 0, 0.25, 1.75, 1.25, 0.75, 0, 0, 0, 0]
const SPIKE_Z_ROT = [0, 0, 0.25, 1.75, 0, 0, 0, 0, 0, 0, 0.75, 1.25]
const SPIKE_X = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8]
const SPIKE_Y = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8]
const SPIKE_Z = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0]

/**
 * GuardianModel. The eye looks at the camera entity, or at the attack target when it has one (synched id_attack_target
 * not 0), from Vec3 fields (objects {x, y, z}, positions at partial tick 0, not in the fixture):
 * - `state.cameraEyePosition`: the camera entity's eye position; absent: 8 blocks north of the guardian's eye and 1 above
 *   it (where the sample generator's player stands), null: no camera entity;
 * - `state.attackTargetEyePosition`: the attack target's eye position; absent/null: the level has no entity of that id;
 * - `state.eyePosition`: the guardian's eye position (absent: the origin).
 * Its view vector is the entity's at partial tick 0: from `entity.xRotO` and `entity.yHeadRotO`.
 */
export class GuardianModel extends AnimModel {
  head = this.part('head')
  spikeParts = Array.from({ length: 12 }, (_, i) => either(this, `spike${i}`, `spike_parts_${i}`))
  eye = this.part('eye')
  tailParts = [0, 1, 2].map(i => either(this, `tail${i}`, `tail_parts_${i}`)) as [PartPose, PartPose, PartPose]

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    const { sin } = this.c
    const partialTicks = f(state.ageInTicks - (state['entity.tickCount'] ?? 0))
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    const spikesAnimation = lerpF(partialTicks, state['entity.clientSideSpikesAnimationO'] ?? 0, state['entity.clientSideSpikesAnimation'] ?? 0)
    const withdrawal = f(f(1 - spikesAnimation) * f(0.55))
    this.setupSpikes(state.ageInTicks, withdrawal)
    if (legacy(this)) this.eye.z = f(-8.25)
    const eyePosition = (state.eyePosition as Vec3 | undefined) ?? { x: 0, y: 0, z: 0 }
    let lookAt = state.cameraEyePosition === undefined ? { x: eyePosition.x, y: eyePosition.y + 1, z: eyePosition.z - 8 } : (state.cameraEyePosition as Vec3 | null)
    if (data(state, 'id_attack_target', 0) !== 0) lookAt = (state.attackTargetEyePosition as Vec3 | null | undefined) ?? null
    if (lookAt) {
      const dy = lookAt.y - eyePosition.y
      if (dy > 0) {
        this.eye.y = 0
      } else {
        this.eye.y = 1
      }
      const view = this.viewVector(state['entity.xRotO'] ?? 0, state['entity.yHeadRotO'] ?? 0)
      const delta = this.yRot(this.normalize({ x: eyePosition.x - lookAt.x, y: 0, z: eyePosition.z - lookAt.z }), HALF_PI)
      const dot = view.x * delta.x + 0 * delta.y + view.z * delta.z
      this.eye.x = f(f(sqrt(f(Math.abs(dot))) * 2) * Math.sign(dot))
    }
    this.eye.visible = true
    const tailAnimation = lerpF(partialTicks, state['entity.clientSideTailAnimationO'] ?? 0, state['entity.clientSideTailAnimation'] ?? 0)
    this.tailParts[0].yRot = f(f(sin(tailAnimation) * PI) * f(0.05))
    this.tailParts[1].yRot = f(f(sin(tailAnimation) * PI) * f(0.1))
    if (legacy(this)) this.tailParts[1].setPos(-1.5, 0.5, 14)
    this.tailParts[2].yRot = f(f(sin(tailAnimation) * PI) * f(0.15))
    if (legacy(this)) this.tailParts[2].setPos(0.5, 0.5, 6)
  }

  setupSpikes(ageInTicks: number, withdrawal: number) {
    for (let i = 0; i < 12; i++) {
      const spike = this.spikeParts[i]!
      if (legacy(this)) spike.setRotation(f(PI * SPIKE_X_ROT[i]!), f(PI * SPIKE_Y_ROT[i]!), f(PI * SPIKE_Z_ROT[i]!))
      spike.x = f(SPIKE_X[i]! * this.getSpikeOffset(i, ageInTicks, withdrawal))
      spike.y = f(16 + f(SPIKE_Y[i]! * this.getSpikeOffset(i, ageInTicks, withdrawal)))
      spike.z = f(SPIKE_Z[i]! * this.getSpikeOffset(i, ageInTicks, withdrawal))
    }
  }

  getSpikeOffset(spike: number, ageInTicks: number, withdrawal: number) {
    return f(f(1 + f(this.c.cos(f(f(ageInTicks * 1.5) + spike)) * f(0.01))) - withdrawal)
  }

  /** Entity.calculateViewVector(xRot, yRot), y left out (the code drops it) */
  viewVector(xRot: number, yRot: number) {
    const { sin, cos } = this.c
    const pitch = f(xRot * DEG_TO_RAD)
    const yaw = f(-yRot * DEG_TO_RAD)
    const yawCos = cos(yaw)
    const yawSin = sin(yaw)
    const pitchCos = cos(pitch)
    return { x: f(yawSin * pitchCos), z: f(yawCos * pitchCos) }
  }

  /** Vec3.normalize: a float length before 1.17 (Mth.sqrt(double)) */
  normalize(v: Vec3): Vec3 {
    const squared = v.x * v.x + v.y * v.y + v.z * v.z
    const length = legacy(this) ? f(Math.sqrt(squared)) : Math.sqrt(squared)
    return length < 1e-4 ? { x: 0, y: 0, z: 0 } : { x: v.x / length, y: v.y / length, z: v.z / length }
  }

  /** Vec3.yRot(float) */
  yRot(v: Vec3, angle: number): Vec3 {
    const cos = this.c.cos(angle)
    const sin = this.c.sin(angle)
    return { x: v.x * cos + v.z * sin, y: v.y, z: v.z * cos - v.x * sin }
  }
}

/** Mth.lerp(float, float, float) */
const lerpF = (delta: number, start: number, end: number) => f(start + f(delta * f(end - start)))

type RotationValues = Record<string, [number, number, number]>

/**
 * AxolotlModel (1.17+). The axolotl keeps the rotations it was last posed with (Axolotl.getModelRotationValues, the
 * LerpingModel map) and eases from them: `state['entity.modelRotationValues']` (part name -> [xRot, yRot, zRot], the
 * map before this pose, written back with this pose's rotations), or, when absent, an empty map: posed from the head
 * angles, as a new axolotl is.
 */
export class AxolotlModel extends AnimModel {
  body = this.part('body')
  head = this.part('head')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')
  tail = this.part('tail')
  topGills = this.part('top_gills')
  leftGills = this.part('left_gills')
  rightGills = this.part('right_gills')
  modelRotationValues: RotationValues = {}

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    // the entity's map (the renderer keeps one per axolotl and passes it); without one a fresh map, as a new entity has
    const provided = state['entity.modelRotationValues'] as RotationValues | undefined
    this.setupInitialAnimationValues(provided ?? {}, state.yRot, state.xRot)
    const values: RotationValues = (this.modelRotationValues = {})
    this.posed(state, values)
    if (provided) {
      for (const key of Object.keys(provided)) delete provided[key]
      Object.assign(provided, values)
    }
  }

  private posed(state: AnimState, values: RotationValues) {
    if (data(state, 'playing_dead', false)) {
      this.setupPlayDeadAnimation(state.yRot)
      this.saveAnimationValues(values)
    } else {
      const moving = this.c.atLeast('1.19.4')
        ? state.walkAnimationSpeed > f(1e-5) || (state['entity.xRot'] ?? 0) !== (state['entity.xRotO'] ?? 0) || (state['entity.yRot'] ?? 0) !== (state['entity.yRotO'] ?? 0)
        : (() => {
            const movement = deltaMovement(state)
            return (
              movement.x * movement.x + movement.z * movement.z > 1e-7 ||
              (state['entity.xRot'] ?? 0) !== (state['entity.xRotO'] ?? 0) ||
              (state['entity.yRot'] ?? 0) !== (state['entity.yRotO'] ?? 0) ||
              (state['entity.xOld'] ?? 0) !== (state['entity.x'] ?? 0) ||
              (state['entity.zOld'] ?? 0) !== (state['entity.z'] ?? 0)
            )
          })()
      if (isInWaterOrBubble(state)) {
        if (moving) {
          this.setupSwimmingAnimation(state.ageInTicks, state.xRot)
        } else {
          this.setupWaterHoveringAnimation(state.ageInTicks)
        }
        this.saveAnimationValues(values)
      } else {
        if (state['entity.onGround']) {
          if (moving) {
            this.setupGroundCrawlingAnimation(state.ageInTicks, state.yRot)
          } else {
            this.setupLayStillOnGroundAnimation(state.ageInTicks, state.yRot)
          }
        }
        this.saveAnimationValues(values)
      }
    }
  }

  saveAnimationValues(values: RotationValues) {
    values.body = this.getRotationVector(this.body)
    values.head = this.getRotationVector(this.head)
    values.right_hind_leg = this.getRotationVector(this.rightHindLeg)
    values.left_hind_leg = this.getRotationVector(this.leftHindLeg)
    values.right_front_leg = this.getRotationVector(this.rightFrontLeg)
    values.left_front_leg = this.getRotationVector(this.leftFrontLeg)
    values.tail = this.getRotationVector(this.tail)
    values.top_gills = this.getRotationVector(this.topGills)
    values.left_gills = this.getRotationVector(this.leftGills)
    values.right_gills = this.getRotationVector(this.rightGills)
  }

  getRotationVector(part: PartPose): [number, number, number] {
    return [part.xRot, part.yRot, part.zRot]
  }

  setRotationFromVector(part: PartPose, vector: [number, number, number]) {
    part.setRotation(vector[0], vector[1], vector[2])
  }

  setupInitialAnimationValues(values: RotationValues, yRot: number, xRot: number) {
    this.body.x = 0
    this.head.y = 0
    this.body.y = 20
    if (Object.keys(values).length === 0) {
      this.body.setRotation(f(xRot * DEG_TO_RAD), f(yRot * DEG_TO_RAD), 0)
      this.head.setRotation(0, 0, 0)
      this.leftHindLeg.setRotation(0, 0, 0)
      this.rightHindLeg.setRotation(0, 0, 0)
      this.leftFrontLeg.setRotation(0, 0, 0)
      this.rightFrontLeg.setRotation(0, 0, 0)
      this.leftGills.setRotation(0, 0, 0)
      this.rightGills.setRotation(0, 0, 0)
      this.topGills.setRotation(0, 0, 0)
      this.tail.setRotation(0, 0, 0)
    } else {
      this.setRotationFromVector(this.body, values.body!)
      this.setRotationFromVector(this.head, values.head!)
      this.setRotationFromVector(this.leftHindLeg, values.left_hind_leg!)
      this.setRotationFromVector(this.rightHindLeg, values.right_hind_leg!)
      this.setRotationFromVector(this.leftFrontLeg, values.left_front_leg!)
      this.setRotationFromVector(this.rightFrontLeg, values.right_front_leg!)
      this.setRotationFromVector(this.leftGills, values.left_gills!)
      this.setRotationFromVector(this.rightGills, values.right_gills!)
      this.setRotationFromVector(this.topGills, values.top_gills!)
      this.setRotationFromVector(this.tail, values.tail!)
    }
  }

  lerpTo(from: number, to: number, delta = f(0.05)) {
    return rotLerp(delta, from, to)
  }

  lerpPart(part: PartPose, xRot: number, yRot: number, zRot: number) {
    part.setRotation(this.lerpTo(part.xRot, xRot), this.lerpTo(part.yRot, yRot), this.lerpTo(part.zRot, zRot))
  }

  setupLayStillOnGroundAnimation(ageInTicks: number, yRot: number) {
    const { sin, cos } = this.c
    const animMoveSpeed = f(ageInTicks * f(0.09))
    const sineSway = sin(animMoveSpeed)
    const cosineSway = cos(animMoveSpeed)
    const movement = f(f(sineSway * sineSway) - f(2 * sineSway))
    const movement2 = f(f(cosineSway * cosineSway) - f(3 * sineSway))
    this.head.xRot = this.lerpTo(this.head.xRot, f(f(-0.09) * movement))
    this.head.yRot = this.lerpTo(this.head.yRot, 0)
    this.head.zRot = this.lerpTo(this.head.zRot, f(-0.2))
    this.tail.yRot = this.lerpTo(this.tail.yRot, f(f(-0.1) + f(f(0.1) * movement)))
    this.topGills.xRot = this.lerpTo(this.topGills.xRot, f(f(0.6) + f(f(0.05) * movement2)))
    this.leftGills.yRot = this.lerpTo(this.leftGills.yRot, -this.topGills.xRot)
    this.rightGills.yRot = this.lerpTo(this.rightGills.yRot, -this.leftGills.yRot)
    this.lerpPart(this.leftHindLeg, f(1.1), 1, 0)
    this.lerpPart(this.leftFrontLeg, f(0.8), f(2.3), -0.5)
    this.applyMirrorLegRotations()
    this.body.xRot = this.lerpTo(this.body.xRot, 0, f(0.2))
    this.body.yRot = this.lerpTo(this.body.yRot, f(yRot * DEG_TO_RAD))
    this.body.zRot = this.lerpTo(this.body.zRot, 0)
  }

  setupGroundCrawlingAnimation(ageInTicks: number, yRot: number) {
    const { sin, cos } = this.c
    const animMoveSpeed = f(ageInTicks * f(0.11))
    const cosineSway = cos(animMoveSpeed)
    const hindLegYRotSway = f(f(f(cosineSway * cosineSway) - f(2 * cosineSway)) / 5)
    const frontLegYRotSway = f(f(0.7) * cosineSway)
    this.head.xRot = this.lerpTo(this.head.xRot, 0)
    this.head.yRot = this.lerpTo(this.head.yRot, f(f(0.09) * cosineSway))
    this.head.zRot = this.lerpTo(this.head.zRot, 0)
    this.tail.yRot = this.lerpTo(this.tail.yRot, this.head.yRot)
    this.topGills.xRot = this.lerpTo(this.topGills.xRot, f(f(0.6) - f(f(0.08) * f(f(cosineSway * cosineSway) + f(2 * sin(animMoveSpeed))))))
    this.leftGills.yRot = this.lerpTo(this.leftGills.yRot, -this.topGills.xRot)
    this.rightGills.yRot = this.lerpTo(this.rightGills.yRot, -this.leftGills.yRot)
    this.lerpPart(this.leftHindLeg, f(0.942_477_9), f(1.5 - hindLegYRotSway), f(-0.1))
    this.lerpPart(this.leftFrontLeg, f(1.099_557_4), f(HALF_PI - frontLegYRotSway), 0)
    this.lerpPart(this.rightHindLeg, this.leftHindLeg.xRot, f(-1 - hindLegYRotSway), 0)
    this.lerpPart(this.rightFrontLeg, this.leftFrontLeg.xRot, f(-HALF_PI - frontLegYRotSway), 0)
    this.body.xRot = this.lerpTo(this.body.xRot, 0, f(0.2))
    this.body.yRot = this.lerpTo(this.body.yRot, f(yRot * DEG_TO_RAD))
    this.body.zRot = this.lerpTo(this.body.zRot, 0)
  }

  setupWaterHoveringAnimation(ageInTicks: number) {
    const { sin, cos } = this.c
    const animMoveSpeed = f(ageInTicks * f(0.075))
    const cosineSway = cos(animMoveSpeed)
    const sineSway = f(sin(animMoveSpeed) * f(0.15))
    this.body.xRot = this.lerpTo(this.body.xRot, f(f(-0.15) + f(f(0.075) * cosineSway)))
    this.body.y = f(this.body.y - sineSway)
    this.head.xRot = this.lerpTo(this.head.xRot, -this.body.xRot)
    this.topGills.xRot = this.lerpTo(this.topGills.xRot, f(f(0.2) * cosineSway))
    this.leftGills.yRot = this.lerpTo(this.leftGills.yRot, f(f(f(-0.3) * cosineSway) - f(0.19)))
    this.rightGills.yRot = this.lerpTo(this.rightGills.yRot, -this.leftGills.yRot)
    this.lerpPart(this.leftHindLeg, f(f(2.356_194_5) - f(cosineSway * f(0.11))), f(0.471_238_94), f(1.727_876_1))
    this.lerpPart(this.leftFrontLeg, f(f(0.785_398_2) - f(cosineSway * f(0.2))), f(2.042_035), 0)
    this.applyMirrorLegRotations()
    this.tail.yRot = this.lerpTo(this.tail.yRot, f(0.5 * cosineSway))
    this.head.yRot = this.lerpTo(this.head.yRot, 0)
    this.head.zRot = this.lerpTo(this.head.zRot, 0)
  }

  setupSwimmingAnimation(ageInTicks: number, xRot: number) {
    const { sin, cos } = this.c
    const animMoveSpeed = f(ageInTicks * f(0.33))
    const sineSway = sin(animMoveSpeed)
    const cosineSway = cos(animMoveSpeed)
    const bodySway = f(f(0.13) * sineSway)
    this.body.xRot = this.lerpTo(this.body.xRot, f(f(xRot * DEG_TO_RAD) + bodySway), f(0.1))
    this.head.xRot = f(-bodySway * f(1.8))
    this.body.y = f(this.body.y - f(f(0.45) * cosineSway))
    this.topGills.xRot = this.lerpTo(this.topGills.xRot, f(f(-0.5 * sineSway) - f(0.8)))
    this.leftGills.yRot = this.lerpTo(this.leftGills.yRot, f(f(f(0.3) * sineSway) + f(0.9)))
    this.rightGills.yRot = this.lerpTo(this.rightGills.yRot, -this.leftGills.yRot)
    this.tail.yRot = this.lerpTo(this.tail.yRot, f(f(0.3) * cos(f(animMoveSpeed * f(0.9)))))
    this.lerpPart(this.leftHindLeg, f(1.884_955_8), f(f(-0.4) * sineSway), HALF_PI)
    this.lerpPart(this.leftFrontLeg, f(1.884_955_8), f(f(f(-0.2) * cosineSway) - f(0.1)), HALF_PI)
    this.applyMirrorLegRotations()
    this.head.yRot = this.lerpTo(this.head.yRot, 0)
    this.head.zRot = this.lerpTo(this.head.zRot, 0)
  }

  setupPlayDeadAnimation(yRot: number) {
    this.lerpPart(this.leftHindLeg, f(1.413_716_7), f(1.099_557_4), f(0.785_398_2))
    this.lerpPart(this.leftFrontLeg, f(0.785_398_2), f(2.042_035), 0)
    this.body.xRot = this.lerpTo(this.body.xRot, f(-0.15))
    this.body.zRot = this.lerpTo(this.body.zRot, f(0.35))
    this.applyMirrorLegRotations()
    this.body.yRot = this.lerpTo(this.body.yRot, f(yRot * DEG_TO_RAD))
    this.head.xRot = this.lerpTo(this.head.xRot, 0)
    this.head.yRot = this.lerpTo(this.head.yRot, 0)
    this.head.zRot = this.lerpTo(this.head.zRot, 0)
    this.tail.yRot = this.lerpTo(this.tail.yRot, 0)
    this.lerpPart(this.topGills, 0, 0, 0)
    this.lerpPart(this.leftGills, 0, 0, 0)
    this.lerpPart(this.rightGills, 0, 0, 0)
  }

  applyMirrorLegRotations() {
    this.lerpPart(this.rightHindLeg, this.leftHindLeg.xRot, -this.leftHindLeg.yRot, -this.leftHindLeg.zRot)
    this.lerpPart(this.rightFrontLeg, this.leftFrontLeg.xRot, -this.leftFrontLeg.yRot, -this.leftFrontLeg.zRot)
  }
}

/** An AnimationState: {lastTime, accumulatedTime} in milliseconds, null/absent when stopped. */
type AnimationStateValue = { lastTime: number; accumulatedTime: number } | null | undefined

/**
 * HierarchicalModel.animate(state, definition, ageInTicks, speed): AnimationState.updateTime (on a copy), then the
 * keyframes at the accumulated time, from the model's root().
 */
const animate = (m: AnimModel, root: PartPose, state: AnimationStateValue, name: string, ageInTicks: number, speed = 1) => {
  if (!state) return
  const time = Math.floor(f(f(ageInTicks * 1000) / 20))
  const accumulatedTime = state.accumulatedTime + Math.trunc(f(f(time - state.lastTime) * speed))
  applyKeyframes(m.model, m.c, name, accumulatedTime, 1, root)
}

/** AnimationState.start(tickCount) */
const started = (tickCount: number): AnimationStateValue => ({ lastTime: Math.trunc((tickCount * 1000) / 20), accumulatedTime: 0 })

/**
 * FrogModel (1.19+): root() is the layer's "root" part. The frog's pose starts its jump, croak and tongue animations
 * (Frog.onSyncedDataUpdated) on the entity: the state gives them (entity.jumpAnimationState...).
 */
export class FrogModel extends AnimModel {
  root = this.part('/root')
  croakingBody = this.part('croaking_body')

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    const { model, c, root } = this
    const age = state.ageInTicks
    const pose = data(state, 'pose', 'STANDING')
    const tickCount = state['entity.tickCount'] ?? 0
    // the animation states the entity's pose started (Frog.onSyncedDataUpdated): the renderer's frog adapter keeps them
    const stateFor = (field: string, _startedBy: string) => (state[field] as AnimationStateValue | undefined) ?? null
    const jumpAnimationState = stateFor('entity.jumpAnimationState', 'LONG_JUMPING')
    const croakAnimationState = stateFor('entity.croakAnimationState', 'CROAKING')
    const tongueAnimationState = stateFor('entity.tongueAnimationState', 'USING_TONGUE')
    animate(this, root, jumpAnimationState, 'FrogAnimation.FROG_JUMP', age)
    animate(this, root, croakAnimationState, 'FrogAnimation.FROG_CROAK', age)
    animate(this, root, tongueAnimationState, 'FrogAnimation.FROG_TONGUE', age)
    if (c.atLeast('1.19.4')) {
      if (isInWaterOrBubble(state)) {
        applyWalkAnimation(model, c, 'FrogAnimation.FROG_SWIM', state.walkAnimationPos, state.walkAnimationSpeed, 1, 2.5, root)
      } else {
        applyWalkAnimation(model, c, 'FrogAnimation.FROG_WALK', state.walkAnimationPos, state.walkAnimationSpeed, 1.5, 2.5, root)
      }
    } else {
      const movement = deltaMovement(state)
      const walkSpeed = Math.min(f(f(movement.x * movement.x + movement.y * movement.y + movement.z * movement.z) * 200), 8)
      animate(this, root, state['entity.walkAnimationState'], 'FrogAnimation.FROG_WALK', age, walkSpeed)
      animate(this, root, state['entity.swimAnimationState'], 'FrogAnimation.FROG_SWIM', age)
    }
    animate(this, root, state['entity.swimIdleAnimationState'], 'FrogAnimation.FROG_IDLE_WATER', age)
    this.croakingBody.visible = !!croakAnimationState
  }
}

export class TadpoleModel extends AnimModel {
  tail = this.part('tail')

  override setupAnim(input: AnimState) {
    super.setupAnim(input)
    const state = inputs(input)
    const amplitudeMultiplier = isInWater(state) ? 1 : 1.5
    this.tail.yRot = f(f(-amplitudeMultiplier * 0.25) * this.c.sin(f(f(0.3) * state.ageInTicks)))
  }
}

export const ENTITY_ERA_AQUATIC_MODELS: Record<string, AnimModelClass> = {
  CodModel,
  SalmonModel,
  PufferfishBigModel,
  PufferfishMidModel,
  PufferfishSmallModel,
  TropicalFishModelA,
  TropicalFishModelB,
  DolphinModel,
  SquidModel,
  GuardianModel,
  AxolotlModel,
  FrogModel,
  TadpoleModel
}
