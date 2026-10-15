import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { applyAnimationState, applyWalkAnimation } from '../keyframes'
import { DEG_TO_RAD, HALF_PI, PI, clamp, f, sqrt } from '../mth'

/**
 * Fish, dolphins, squids, guardians, axolotls, frogs, tadpoles and nautiluses, 26.3.
 */

export class CodModel extends AnimModel {
  tailFin = this.part('tail_fin')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const amplitudeMultiplier = state.isInWater ? 1 : 1.5
    this.tailFin.yRot = f(f(-amplitudeMultiplier * f(0.45)) * this.c.sin(f(f(0.6) * state.ageInTicks)))
  }
}

export class SalmonModel extends AnimModel {
  bodyBack = this.part('body_back')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    let amplitudeMultiplier = 1
    let angleMultiplier = 1
    if (!state.isInWater) {
      amplitudeMultiplier = f(1.3)
      angleMultiplier = f(1.7)
    }
    this.bodyBack.yRot = f(f(-amplitudeMultiplier * 0.25) * this.c.sin(f(f(angleMultiplier * f(0.6)) * state.ageInTicks)))
  }
}

export class PufferfishBigModel extends AnimModel {
  leftBlueFin = this.part('left_blue_fin')
  rightBlueFin = this.part('right_blue_fin')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin } = this.c
    this.rightBlueFin.zRot = f(f(-0.2) + f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
    this.leftBlueFin.zRot = f(f(0.2) - f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
  }
}

/** PufferfishMidModel: the same code as PufferfishBigModel. */
export class PufferfishMidModel extends PufferfishBigModel {}

export class PufferfishSmallModel extends AnimModel {
  leftFin = this.part('left_fin')
  rightFin = this.part('right_fin')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin } = this.c
    this.rightFin.zRot = f(f(-0.2) + f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
    this.leftFin.zRot = f(f(0.2) - f(f(0.4) * sin(f(state.ageInTicks * f(0.2)))))
  }
}

export class TropicalFishLargeModel extends AnimModel {
  tail = this.part('tail')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const amplitudeMultiplier = state.isInWater ? 1 : 1.5
    this.tail.yRot = f(f(-amplitudeMultiplier * f(0.45)) * this.c.sin(f(f(0.6) * state.ageInTicks)))
  }
}

/** TropicalFishSmallModel: the same code as TropicalFishLargeModel. */
export class TropicalFishSmallModel extends TropicalFishLargeModel {}

export class DolphinModel extends AnimModel {
  body = this.part('body')
  tail = this.part('tail')
  tailFin = this.part('tail_fin')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    this.body.xRot = f(state.xRot * DEG_TO_RAD)
    this.body.yRot = f(state.yRot * DEG_TO_RAD)
    if (state.isMoving) {
      this.body.xRot = f(this.body.xRot + f(f(-0.05) - f(f(0.05) * cos(f(state.ageInTicks * f(0.3))))))
      this.tail.xRot = f(f(-0.1) * cos(f(state.ageInTicks * f(0.3))))
      this.tailFin.xRot = f(f(-0.2) * cos(f(state.ageInTicks * f(0.3))))
    }
  }
}

export class SquidModel extends AnimModel {
  tentacles = Array.from({ length: 8 }, (_, i) => this.part(`tentacle${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    for (const tentacle of this.tentacles) tentacle.xRot = state.tentacleAngle
  }
}

const SPIKE_X = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8]
const SPIKE_Y = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8]
const SPIKE_Z = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0]

type Vec3 = { x: number; y: number; z: number }

/**
 * GuardianModel. The eye follows the render state's Vec3 fields (objects {x, y, z}, not in the fixture):
 * state.lookAtPosition (the target's eye position, null/absent without a target), state.eyePosition (the guardian's
 * eye position) and state.lookDirection (its view vector, null/absent without a target). Without them the eye keeps
 * its initial position, as in all the fixture's samples.
 */
export class GuardianModel extends AnimModel {
  head = this.part('head')
  spikeParts = Array.from({ length: 12 }, (_, i) => this.part(`spike${i}`))
  eye = this.part('eye')
  tailParts = [this.part('tail0'), this.part('tail1'), this.part('tail2')] as const

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    const withdrawal = f(f(1 - state.spikesAnimation) * f(0.55))
    this.setupSpikes(state.ageInTicks, withdrawal)
    const lookAtPosition = state.lookAtPosition as Vec3 | null | undefined
    const lookDirection = state.lookDirection as Vec3 | null | undefined
    if (lookAtPosition && lookDirection) {
      const eyePosition = state.eyePosition as Vec3
      const dy = lookAtPosition.y - eyePosition.y
      if (dy > 0) {
        this.eye.y = 0
      } else {
        this.eye.y = 1
      }
      // Vec3 math, in doubles: delta = (eye - lookAt with y 0).normalize().yRot(1.5707964F)
      let deltaX = eyePosition.x - lookAtPosition.x
      let deltaZ = eyePosition.z - lookAtPosition.z
      const dist = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ)
      if (dist < 9.999_999_747_378_752e-6) {
        deltaX = 0
        deltaZ = 0
      } else {
        deltaX /= dist
        deltaZ /= dist
      }
      const rotCos = cos(HALF_PI)
      const rotSin = sin(HALF_PI)
      const rotatedX = deltaX * rotCos + deltaZ * rotSin
      const rotatedZ = deltaZ * rotCos - deltaX * rotSin
      const dot = lookDirection.x * rotatedX + lookDirection.z * rotatedZ
      this.eye.x = f(f(sqrt(f(Math.abs(dot))) * 2) * Math.sign(dot))
    }
    this.eye.visible = true
    const swim = state.tailAnimation as number
    this.tailParts[0].yRot = f(f(sin(swim) * PI) * f(0.05))
    this.tailParts[1].yRot = f(f(sin(swim) * PI) * f(0.1))
    this.tailParts[2].yRot = f(f(sin(swim) * PI) * f(0.15))
  }

  setupSpikes(ageInTicks: number, withdrawal: number) {
    for (let i = 0; i < 12; i++) {
      this.spikeParts[i]!.x = this.getSpikeX(i, ageInTicks, withdrawal)
      this.spikeParts[i]!.y = this.getSpikeY(i, ageInTicks, withdrawal)
      this.spikeParts[i]!.z = this.getSpikeZ(i, ageInTicks, withdrawal)
    }
  }

  getSpikeOffset(spike: number, ageInTicks: number, withdrawal: number) {
    return f(f(1 + f(this.c.cos(f(f(ageInTicks * 1.5) + spike)) * f(0.01))) - withdrawal)
  }

  getSpikeX(spike: number, ageInTicks: number, withdrawal: number) {
    return f(SPIKE_X[spike]! * this.getSpikeOffset(spike, ageInTicks, withdrawal))
  }

  getSpikeY(spike: number, ageInTicks: number, withdrawal: number) {
    return f(16 + f(SPIKE_Y[spike]! * this.getSpikeOffset(spike, ageInTicks, withdrawal)))
  }

  getSpikeZ(spike: number, ageInTicks: number, withdrawal: number) {
    return f(SPIKE_Z[spike]! * this.getSpikeOffset(spike, ageInTicks, withdrawal))
  }
}

/** part.key += value, in floats */
const add = (part: PartPose, key: 'x' | 'y' | 'z' | 'xRot' | 'yRot' | 'zRot', value: number) => {
  part[key] = f(part[key] + value)
}

/** part.key -= value, in floats */
const sub = (part: PartPose, key: 'x' | 'y' | 'z' | 'xRot' | 'yRot' | 'zRot', value: number) => {
  part[key] = f(part[key] - value)
}

const EPSILON = f(1e-5)

export class AdultAxolotlModel extends AnimModel {
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

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const playingDeadFactor = state.playingDeadFactor as number
    const inWaterFactor = state.inWaterFactor as number
    const onGroundFactor = state.onGroundFactor as number
    const movingFactor = state.movingFactor as number
    const notMovingFactor = f(1 - movingFactor)
    const mirroredLegsFactor = f(1 - Math.min(onGroundFactor, movingFactor))
    add(this.body, 'yRot', f(state.yRot * DEG_TO_RAD))
    this.setupSwimmingAnimation(state.ageInTicks, state.xRot, Math.min(movingFactor, inWaterFactor))
    this.setupWaterHoveringAnimation(state.ageInTicks, Math.min(notMovingFactor, inWaterFactor))
    this.setupGroundCrawlingAnimation(state.ageInTicks, Math.min(movingFactor, onGroundFactor))
    this.setupLayStillOnGroundAnimation(state.ageInTicks, Math.min(notMovingFactor, onGroundFactor))
    this.setupPlayDeadAnimation(playingDeadFactor)
    this.applyMirrorLegRotations(mirroredLegsFactor)
  }

  setupLayStillOnGroundAnimation(ageInTicks: number, factor: number) {
    if (factor <= EPSILON) return
    const { sin, cos } = this.c
    const animMoveSpeed = f(ageInTicks * f(0.09))
    const sineSway = sin(animMoveSpeed)
    const cosineSway = cos(animMoveSpeed)
    const movement = f(f(sineSway * sineSway) - f(2 * sineSway))
    const movement2 = f(f(cosineSway * cosineSway) - f(3 * sineSway))
    add(this.head, 'xRot', f(f(f(-0.09) * movement) * factor))
    add(this.head, 'zRot', f(f(-0.2) * factor))
    add(this.tail, 'yRot', f(f(f(-0.1) + f(f(0.1) * movement)) * factor))
    const gillAngle = f(f(f(0.6) + f(f(0.05) * movement2)) * factor)
    add(this.topGills, 'xRot', gillAngle)
    sub(this.leftGills, 'yRot', gillAngle)
    add(this.rightGills, 'yRot', gillAngle)
    add(this.leftHindLeg, 'xRot', f(f(1.1) * factor))
    add(this.leftHindLeg, 'yRot', factor)
    add(this.leftFrontLeg, 'xRot', f(f(0.8) * factor))
    add(this.leftFrontLeg, 'yRot', f(f(2.3) * factor))
    sub(this.leftFrontLeg, 'zRot', f(0.5 * factor))
  }

  setupGroundCrawlingAnimation(ageInTicks: number, factor: number) {
    if (factor <= EPSILON) return
    const { sin, cos } = this.c
    const animMoveSpeed = f(ageInTicks * f(0.11))
    const cosineSway = cos(animMoveSpeed)
    const hindLegYRotSway = f(f(f(cosineSway * cosineSway) - f(2 * cosineSway)) / 5)
    const frontLegYRotSway = f(f(0.7) * cosineSway)
    const headAndTailYRot = f(f(f(0.09) * cosineSway) * factor)
    add(this.head, 'yRot', headAndTailYRot)
    add(this.tail, 'yRot', headAndTailYRot)
    const gillAngle = f(f(f(0.6) - f(f(0.08) * f(f(cosineSway * cosineSway) + f(2 * sin(animMoveSpeed))))) * factor)
    add(this.topGills, 'xRot', gillAngle)
    sub(this.leftGills, 'yRot', gillAngle)
    add(this.rightGills, 'yRot', gillAngle)
    const hindLegXRot = f(f(0.942_477_9) * factor)
    const frontLegXRot = f(f(1.099_557_4) * factor)
    add(this.leftHindLeg, 'xRot', hindLegXRot)
    add(this.leftHindLeg, 'yRot', f(f(1.5 - hindLegYRotSway) * factor))
    add(this.leftHindLeg, 'zRot', f(f(-0.1) * factor))
    add(this.leftFrontLeg, 'xRot', frontLegXRot)
    add(this.leftFrontLeg, 'yRot', f(f(HALF_PI - frontLegYRotSway) * factor))
    add(this.rightHindLeg, 'xRot', hindLegXRot)
    add(this.rightHindLeg, 'yRot', f(f(-1 - hindLegYRotSway) * factor))
    add(this.rightFrontLeg, 'xRot', frontLegXRot)
    add(this.rightFrontLeg, 'yRot', f(f(-HALF_PI - frontLegYRotSway) * factor))
  }

  setupWaterHoveringAnimation(ageInTicks: number, factor: number) {
    if (factor <= EPSILON) return
    const { sin, cos } = this.c
    const animMoveSpeed = f(ageInTicks * f(0.075))
    const cosineSway = cos(animMoveSpeed)
    const sineSway = f(sin(animMoveSpeed) * f(0.15))
    const bodyXRot = f(f(f(-0.15) + f(f(0.075) * cosineSway)) * factor)
    add(this.body, 'xRot', bodyXRot)
    sub(this.body, 'y', f(sineSway * factor))
    sub(this.head, 'xRot', bodyXRot)
    add(this.topGills, 'xRot', f(f(f(0.2) * cosineSway) * factor))
    const gillYRot = f(f(f(f(-0.3) * cosineSway) - f(0.19)) * factor)
    add(this.leftGills, 'yRot', gillYRot)
    sub(this.rightGills, 'yRot', gillYRot)
    add(this.leftHindLeg, 'xRot', f(f(f(2.356_194_5) - f(cosineSway * f(0.11))) * factor))
    add(this.leftHindLeg, 'yRot', f(f(0.471_238_94) * factor))
    add(this.leftHindLeg, 'zRot', f(f(1.727_876_1) * factor))
    add(this.leftFrontLeg, 'xRot', f(f(f(0.785_398_2) - f(cosineSway * f(0.2))) * factor))
    add(this.leftFrontLeg, 'yRot', f(f(2.042_035) * factor))
    add(this.tail, 'yRot', f(f(0.5 * cosineSway) * factor))
  }

  setupSwimmingAnimation(ageInTicks: number, xRot: number, factor: number) {
    if (factor <= EPSILON) return
    const { sin, cos } = this.c
    const animMoveSpeed = f(ageInTicks * f(0.33))
    const sineSway = sin(animMoveSpeed)
    const cosineSway = cos(animMoveSpeed)
    const bodySway = f(f(0.13) * sineSway)
    add(this.body, 'xRot', f(f(f(xRot * DEG_TO_RAD) + bodySway) * factor))
    sub(this.head, 'xRot', f(f(bodySway * f(1.8)) * factor))
    sub(this.body, 'y', f(f(f(0.45) * cosineSway) * factor))
    add(this.topGills, 'xRot', f(f(f(-0.5 * sineSway) - f(0.8)) * factor))
    const gillYRot = f(f(f(f(0.3) * sineSway) + f(0.9)) * factor)
    add(this.leftGills, 'yRot', gillYRot)
    sub(this.rightGills, 'yRot', gillYRot)
    add(this.tail, 'yRot', f(f(f(0.3) * cos(f(animMoveSpeed * f(0.9)))) * factor))
    add(this.leftHindLeg, 'xRot', f(f(1.884_955_8) * factor))
    add(this.leftHindLeg, 'yRot', f(f(f(-0.4) * sineSway) * factor))
    add(this.leftHindLeg, 'zRot', f(HALF_PI * factor))
    add(this.leftFrontLeg, 'xRot', f(f(1.884_955_8) * factor))
    add(this.leftFrontLeg, 'yRot', f(f(f(f(-0.2) * cosineSway) - f(0.1)) * factor))
    add(this.leftFrontLeg, 'zRot', f(HALF_PI * factor))
  }

  setupPlayDeadAnimation(factor: number) {
    if (factor <= EPSILON) return
    add(this.leftHindLeg, 'xRot', f(f(1.413_716_7) * factor))
    add(this.leftHindLeg, 'yRot', f(f(1.099_557_4) * factor))
    add(this.leftHindLeg, 'zRot', f(f(0.785_398_2) * factor))
    add(this.leftFrontLeg, 'xRot', f(f(0.785_398_2) * factor))
    add(this.leftFrontLeg, 'yRot', f(f(2.042_035) * factor))
    add(this.body, 'xRot', f(f(-0.15) * factor))
    add(this.body, 'zRot', f(f(0.35) * factor))
  }

  applyMirrorLegRotations(factor: number) {
    if (factor <= EPSILON) return
    add(this.rightHindLeg, 'xRot', f(this.leftHindLeg.xRot * factor))
    add(this.rightHindLeg, 'yRot', f(-this.leftHindLeg.yRot * factor))
    add(this.rightHindLeg, 'zRot', f(-this.leftHindLeg.zRot * factor))
    add(this.rightFrontLeg, 'xRot', f(this.leftFrontLeg.xRot * factor))
    add(this.rightFrontLeg, 'yRot', f(-this.leftFrontLeg.yRot * factor))
    add(this.rightFrontLeg, 'zRot', f(-this.leftFrontLeg.zRot * factor))
  }
}

export class BabyAxolotlModel extends AnimModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { model, c } = this
    if (state.walkAnimationState !== null && state.walkAnimationState !== undefined) {
      applyWalkAnimation(model, c, 'BabyAxolotlAnimation.AXOLOTL_WALK_FLOOR', state.walkAnimationPos, state.walkAnimationSpeed, 15, 30)
    }
    applyAnimationState(model, c, 'BabyAxolotlAnimation.BABY_AXOLOTL_SWIM', state.swimAnimation, state.ageInTicks)
    applyAnimationState(model, c, 'BabyAxolotlAnimation.WALK_FLOOR_UNDERWATER', state.walkAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'BabyAxolotlAnimation.BABY_AXOLOTL_IDLE_FLOOR', state.idleOnGroundAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'BabyAxolotlAnimation.IDLE_UNDERWATER', state.idleUnderWaterAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'BabyAxolotlAnimation.IDLE_FLOOR_UNDERWATER', state.idleUnderWaterOnGroundAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'BabyAxolotlAnimation.BABY_AXOLOTL_PLAY_DEAD', state.playDeadAnimationState, state.ageInTicks)
  }
}

/**
 * FrogModel: the model is the layer's "root" part; its animations are baked on the layer's root, but name no "root"
 * bone, so the lookup from the model's root finds the same parts.
 */
export class FrogModel extends AnimModel {
  croakingBody = this.part('croaking_body')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { model, c } = this
    applyAnimationState(model, c, 'FrogAnimation.FROG_JUMP', state.jumpAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'FrogAnimation.FROG_CROAK', state.croakAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'FrogAnimation.FROG_TONGUE', state.tongueAnimationState, state.ageInTicks)
    if (state.isSwimming) {
      applyWalkAnimation(model, c, 'FrogAnimation.FROG_SWIM', state.walkAnimationPos, state.walkAnimationSpeed, 1, 2.5)
    } else {
      applyWalkAnimation(model, c, 'FrogAnimation.FROG_WALK', state.walkAnimationPos, state.walkAnimationSpeed, 1.5, 2.5)
    }
    applyAnimationState(model, c, 'FrogAnimation.FROG_IDLE_WATER', state.swimIdleAnimationState, state.ageInTicks)
    this.croakingBody.visible = state.croakAnimationState !== null && state.croakAnimationState !== undefined
  }
}

export class TadpoleModel extends AnimModel {
  tail = this.part('tail')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const amplitudeMultiplier = state.isInWater ? 1 : 1.5
    this.tail.yRot = f(f(-amplitudeMultiplier * 0.25) * this.c.sin(f(f(0.3) * state.ageInTicks)))
  }
}

/** NautilusModel (NautilusArmorModel and NautilusSaddleModel only add parts). */
export class NautilusModel extends AnimModel {
  nautilus = this.part('/root')
  body = this.part('body')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.applyBodyRotation(state.yRot, state.xRot)
    applyWalkAnimation(this.model, this.c, 'NautilusAnimation.SWIMMING', f(state.walkAnimationPos + f(state.ageInTicks / 5)), f(state.walkAnimationSpeed + f(0.2)), 2, 3)
  }

  applyBodyRotation(yRot: number, xRot: number) {
    yRot = clamp(yRot, -10, 10)
    xRot = clamp(xRot, -10, 10)
    this.body.yRot = f(yRot * DEG_TO_RAD)
    this.body.xRot = f(xRot * DEG_TO_RAD)
  }
}

/**
 * ZombieNautilusCoralModel. state.bodyArmorItem (not in the fixture): the nautilus armor worn, any truthy value when
 * one is worn, absent/null/false when none (as in the fixture's samples); the corals show only without armor.
 */
export class ZombieNautilusCoralModel extends NautilusModel {
  corals = this.part('corals')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.corals.visible = !state.bodyArmorItem
  }
}

export const AQUATIC_MODELS: Record<string, AnimModelClass> = {
  CodModel,
  SalmonModel,
  PufferfishBigModel,
  PufferfishMidModel,
  PufferfishSmallModel,
  TropicalFishLargeModel,
  TropicalFishSmallModel,
  // before 1.21.11: the small and large tropical fish models, the same code
  TropicalFishModelA: TropicalFishSmallModel,
  TropicalFishModelB: TropicalFishLargeModel,
  DolphinModel,
  SquidModel,
  GuardianModel,
  AdultAxolotlModel,
  BabyAxolotlModel,
  // before 26.1: one model for adults and babies, the same code as AdultAxolotlModel
  AxolotlModel: AdultAxolotlModel,
  FrogModel,
  TadpoleModel,
  NautilusModel,
  NautilusArmorModel: NautilusModel,
  NautilusSaddleModel: NautilusModel,
  ZombieNautilusCoralModel
}
