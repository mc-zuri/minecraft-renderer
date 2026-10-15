import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, f, lerp, rotLerpRad } from '../mth'
import { applyKeyframes } from '../keyframes'
import { EntityState, HumanoidModel } from './humanoid'

/**
 * Small animals and flyers of 1.14.4 - 1.21.1 (wolves, felines, foxes, rabbits, chickens, parrots, bats, bees, allays,
 * vexes), posed from the entity: prepareMobModel then setupAnim, reading the entity's synched data by name
 * (state.dataNames), its client fields (entity.<field>) and the model's fields (model.<field>).
 * 1.14.4 - 1.16.5 draw legacy layers whose parts are named after the model's fields (leg0, back_leg_l, wing_left...):
 * parts are looked up by every name a version gives them.
 */

/** A number input (walkAnimationPos, ageInTicks, yRot...), 0 when the sample leaves it at its default. */
const num = (state: AnimState, key: string): number => state[key] ?? 0

/** The entity's synched data by name (dataNames maps index -> name), the define() default when the state has none. */
const data = <T>(state: AnimState, name: string, fallback: T): T => {
  const names = (state.dataNames ?? {}) as Record<string, string>
  for (const index in names) {
    if (names[index] !== name) continue
    const value = state[`data.${index}`]
    return value === undefined ? fallback : (value as T)
  }
  return fallback
}

/** An entity field (client-side state), its initial value when absent. */
const entity = <T>(state: AnimState, field: string, fallback: T): T => {
  const value = state[`entity.${field}`]
  return value === undefined || value === null ? fallback : (value as T)
}

/** A model field the renderer sets (young, riding, attackTime...). */
const modelField = <T>(state: AnimState, field: string, fallback: T): T => {
  const value = state[`model.${field}`]
  return value === undefined || value === null ? fallback : (value as T)
}

const sharedFlag = (state: AnimState, bit: number) => (data(state, 'shared_flags', 0) & (1 << bit)) !== 0

/** Entity.isCrouching (1.14.4: isSneaking, the shared flag 1). */
const isCrouching = (m: AnimModel, state: AnimState) => (m.c.atLeast('1.15') ? data<string>(state, 'pose', 'STANDING') === 'CROUCHING' : sharedFlag(state, 1))
const isSprinting = (state: AnimState) => sharedFlag(state, 3)
/** TamableAnimal.isInSittingPose (isSitting before 1.16): the flags' bit 1. */
const isInSittingPose = (state: AnimState) => (data(state, 'flags', 0) & 1) !== 0

/** A part by the names versions give it (the Mojang name first, then the legacy field names). */
const pick = (m: AnimModel, ...names: string[]): PartPose => {
  for (const name of names) {
    const part = m.model.maybe(name)
    if (part) return part
  }
  throw new Error(`no part ${names.join(' / ')}`)
}

/** HierarchicalModel.animate(state, definition, ageInTicks, speed): AnimationState.updateTime then the keyframes at accumulatedTime. */
const animate = (
  m: AnimModel,
  animationState: { lastTime: number; accumulatedTime: number } | null | undefined,
  name: string,
  ageInTicks: number,
  speed = 1
) => {
  if (!animationState) return
  const lastTime = Math.floor(f(f(ageInTicks * 1000) / 20))
  const accumulatedTime = animationState.accumulatedTime + Math.trunc(f(f(lastTime - animationState.lastTime) * speed))
  applyKeyframes(m.model, m.c, name, accumulatedTime, 1)
}

const walkCos = (m: AnimModel, pos: number, speed: number, phase = 0) =>
  f(f(m.c.cos(phase ? f(f(pos * f(0.6662)) + phase) : f(pos * f(0.6662))) * f(1.4)) * speed)

export class WolfModel extends AnimModel {
  head = this.part('head')
  /** 1.14.4 rolls the head itself (no real_head) */
  realHead = pick(this, 'real_head', 'head')
  body = this.part('body')
  upperBody = this.part('upper_body')
  rightHindLeg = pick(this, 'right_hind_leg', 'leg0')
  leftHindLeg = pick(this, 'left_hind_leg', 'leg1')
  rightFrontLeg = pick(this, 'right_front_leg', 'leg2')
  leftFrontLeg = pick(this, 'left_front_leg', 'leg3')
  tail = this.part('tail')
  realTail = pick(this, 'real_tail', 'tail')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.prepareMobModel(state)
    this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
    this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    this.tail.xRot = num(state, 'ageInTicks')
  }

  /** Wolf.isAngry: the remaining anger time from 1.16 (NeutralMob), the flags' bit 2 before. */
  isAngry(state: AnimState) {
    return this.c.atLeast('1.16') ? data(state, 'remaining_anger_time', 0) > 0 : (data(state, 'flags', 0) & 2) !== 0
  }

  /** Wolf.getBodyRollAngle */
  bodyRollAngle(state: AnimState, offset: number) {
    const { sin } = this.c
    let progress = f(f(lerp(num(state, 'partialTick'), entity(state, 'shakeAnimO', 0), entity(state, 'shakeAnim', 0)) + offset) / f(1.8))
    if (progress < 0) progress = 0
    else if (progress > 1) progress = 1
    return f(f(f(sin(f(progress * PI)) * sin(f(f(progress * PI) * 11))) * f(0.15)) * PI)
  }

  prepareMobModel(state: AnimState) {
    const pos = num(state, 'walkAnimationPos')
    const speed = num(state, 'walkAnimationSpeed')
    const pt = num(state, 'partialTick')
    if (this.isAngry(state)) {
      this.tail.yRot = 0
    } else {
      this.tail.yRot = walkCos(this, pos, speed)
    }
    if (isInSittingPose(state)) {
      const hindY = this.c.atLeast('1.15') ? f(22.7) : 22
      this.upperBody.setPos(-1, 16, -3)
      this.upperBody.xRot = f(1.256_637_1)
      this.upperBody.yRot = 0
      this.body.setPos(0, 18, 0)
      this.body.xRot = f(0.785_398_2)
      this.tail.setPos(-1, 21, 6)
      this.rightHindLeg.setPos(-2.5, hindY, 2)
      this.rightHindLeg.xRot = f(4.712_389)
      this.leftHindLeg.setPos(0.5, hindY, 2)
      this.leftHindLeg.xRot = f(4.712_389)
      this.rightFrontLeg.xRot = f(5.811_947)
      this.rightFrontLeg.setPos(f(-2.49), 17, -4)
      this.leftFrontLeg.xRot = f(5.811_947)
      this.leftFrontLeg.setPos(f(0.51), 17, -4)
    } else {
      this.body.setPos(0, 14, 2)
      this.body.xRot = HALF_PI
      this.upperBody.setPos(-1, 14, -3)
      this.upperBody.xRot = this.body.xRot
      this.tail.setPos(-1, 12, 8)
      this.rightHindLeg.setPos(-2.5, 16, 7)
      this.leftHindLeg.setPos(0.5, 16, 7)
      this.rightFrontLeg.setPos(-2.5, 16, -4)
      this.leftFrontLeg.setPos(0.5, 16, -4)
      this.rightHindLeg.xRot = walkCos(this, pos, speed)
      this.leftHindLeg.xRot = walkCos(this, pos, speed, PI)
      this.rightFrontLeg.xRot = walkCos(this, pos, speed, PI)
      this.leftFrontLeg.xRot = walkCos(this, pos, speed)
    }
    // Wolf.getHeadRollAngle
    const headRoll = f(f(lerp(pt, entity(state, 'interestedAngleO', 0), entity(state, 'interestedAngle', 0)) * f(0.15)) * PI)
    this.realHead.zRot = f(headRoll + this.bodyRollAngle(state, 0))
    this.upperBody.zRot = this.bodyRollAngle(state, f(-0.08))
    this.body.zRot = this.bodyRollAngle(state, f(-0.16))
    this.realTail.zRot = this.bodyRollAngle(state, f(-0.2))
  }
}

export class OcelotModel extends AnimModel {
  leftHindLeg = pick(this, 'left_hind_leg', 'back_leg_l')
  rightHindLeg = pick(this, 'right_hind_leg', 'back_leg_r')
  leftFrontLeg = pick(this, 'left_front_leg', 'front_leg_l')
  rightFrontLeg = pick(this, 'right_front_leg', 'front_leg_r')
  tail1 = this.part('tail1')
  tail2 = this.part('tail2')
  head = this.part('head')
  body = this.part('body')
  /** 0 crouching, 1 walking, 2 sprinting, 3 sitting (CatModel) */
  protected state = 1

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.prepareMobModel(state)
    this.setupAnimBody(state)
  }

  /** OcelotModel.setupAnim */
  protected setupAnimBody(state: AnimState) {
    const { cos } = this.c
    const pos = num(state, 'walkAnimationPos')
    const speed = num(state, 'walkAnimationSpeed')
    this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
    this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    if (this.state !== 3) {
      this.body.xRot = HALF_PI
      if (this.state === 2) {
        this.leftHindLeg.xRot = f(cos(f(pos * f(0.6662))) * speed)
        this.rightHindLeg.xRot = f(cos(f(f(pos * f(0.6662)) + f(0.3))) * speed)
        this.leftFrontLeg.xRot = f(cos(f(f(f(pos * f(0.6662)) + PI) + f(0.3))) * speed)
        this.rightFrontLeg.xRot = f(cos(f(f(pos * f(0.6662)) + PI)) * speed)
        this.tail2.xRot = f(f(1.727_876_1) + f(f(f(0.314_159_27) * cos(pos)) * speed))
      } else {
        this.leftHindLeg.xRot = f(cos(f(pos * f(0.6662))) * speed)
        this.rightHindLeg.xRot = f(cos(f(f(pos * f(0.6662)) + PI)) * speed)
        this.leftFrontLeg.xRot = f(cos(f(f(pos * f(0.6662)) + PI)) * speed)
        this.rightFrontLeg.xRot = f(cos(f(pos * f(0.6662))) * speed)
        if (this.state === 1) {
          this.tail2.xRot = f(f(1.727_876_1) + f(f(f(0.785_398_2) * cos(pos)) * speed))
        } else {
          this.tail2.xRot = f(f(1.727_876_1) + f(f(f(0.471_238_94) * cos(pos)) * speed))
        }
      }
    }
  }

  prepareMobModel(state: AnimState) {
    this.body.y = 12
    this.body.z = -10
    this.head.y = 15
    this.head.z = -9
    this.tail1.y = 15
    this.tail1.z = 8
    this.tail2.y = 20
    this.tail2.z = 14
    this.leftFrontLeg.y = f(14.1)
    this.leftFrontLeg.z = -5
    this.rightFrontLeg.y = f(14.1)
    this.rightFrontLeg.z = -5
    this.leftHindLeg.y = 18
    this.leftHindLeg.z = 5
    this.rightHindLeg.y = 18
    this.rightHindLeg.z = 5
    this.tail1.xRot = f(0.9)
    if (isCrouching(this, state)) {
      this.body.y = f(this.body.y + 1)
      this.head.y = f(this.head.y + 2)
      this.tail1.y = f(this.tail1.y + 1)
      this.tail2.y = f(this.tail2.y + -4)
      this.tail2.z = f(this.tail2.z + 2)
      this.tail1.xRot = HALF_PI
      this.tail2.xRot = HALF_PI
      this.state = 0
    } else if (isSprinting(state)) {
      this.tail2.y = this.tail1.y
      this.tail2.z = f(this.tail2.z + 2)
      this.tail1.xRot = HALF_PI
      this.tail2.xRot = HALF_PI
      this.state = 2
    } else {
      this.state = 1
    }
  }
}

export class CatModel extends OcelotModel {
  private lieDownAmount = 0
  private lieDownAmountTail = 0
  private relaxStateOneAmount = 0

  override setupAnimBody(state: AnimState) {
    super.setupAnimBody(state)
    if (this.lieDownAmount > 0) {
      this.head.zRot = rotLerpRad(this.lieDownAmount, this.head.zRot, f(-1.270_796_3))
      this.head.yRot = rotLerpRad(this.lieDownAmount, this.head.yRot, f(1.270_796_3))
      this.leftFrontLeg.xRot = f(-1.270_796_3)
      this.rightFrontLeg.xRot = f(-0.470_796_35)
      this.rightFrontLeg.zRot = f(-0.2)
      this.rightFrontLeg.x = f(-0.2)
      this.leftHindLeg.xRot = f(-0.4)
      this.rightHindLeg.xRot = 0.5
      this.rightHindLeg.zRot = -0.5
      this.rightHindLeg.x = f(-0.3)
      this.rightHindLeg.y = 20
      this.tail1.xRot = rotLerpRad(this.lieDownAmountTail, this.tail1.xRot, f(0.8))
      this.tail2.xRot = rotLerpRad(this.lieDownAmountTail, this.tail2.xRot, f(-0.4))
    }
    if (this.relaxStateOneAmount > 0) {
      this.head.xRot = rotLerpRad(this.relaxStateOneAmount, this.head.xRot, f(-0.581_776_44))
    }
  }

  override prepareMobModel(state: AnimState) {
    const pt = num(state, 'partialTick')
    // Cat.getLieDownAmount, getLieDownAmountTail, getRelaxStateOneAmount
    this.lieDownAmount = lerp(pt, entity(state, 'lieDownAmountO', 0), entity(state, 'lieDownAmount', 0))
    this.lieDownAmountTail = lerp(pt, entity(state, 'lieDownAmountOTail', 0), entity(state, 'lieDownAmountTail', 0))
    this.relaxStateOneAmount = lerp(pt, entity(state, 'relaxStateOneAmountO', 0), entity(state, 'relaxStateOneAmount', 0))
    if (this.lieDownAmount <= 0) {
      this.head.xRot = 0
      this.head.zRot = 0
      this.leftFrontLeg.xRot = 0
      this.leftFrontLeg.zRot = 0
      this.rightFrontLeg.xRot = 0
      this.rightFrontLeg.zRot = 0
      this.rightFrontLeg.x = f(-1.2)
      this.leftHindLeg.xRot = 0
      this.rightHindLeg.xRot = 0
      this.rightHindLeg.zRot = 0
      this.rightHindLeg.x = f(-1.1)
      this.rightHindLeg.y = 18
    }
    super.prepareMobModel(state)
    if (isInSittingPose(state)) {
      this.body.xRot = f(0.785_398_2)
      this.body.y = f(this.body.y + -4)
      this.body.z = f(this.body.z + 5)
      this.head.y = f(this.head.y + f(-3.3))
      this.head.z = f(this.head.z + 1)
      this.tail1.y = f(this.tail1.y + 8)
      this.tail1.z = f(this.tail1.z + -2)
      this.tail2.y = f(this.tail2.y + 2)
      this.tail2.z = f(this.tail2.z + f(-0.8))
      this.tail1.xRot = f(1.727_876_1)
      this.tail2.xRot = f(2.670_354)
      this.leftFrontLeg.xRot = f(-0.157_079_64)
      this.leftFrontLeg.y = f(16.1)
      this.leftFrontLeg.z = -7
      this.rightFrontLeg.xRot = f(-0.157_079_64)
      this.rightFrontLeg.y = f(16.1)
      this.rightFrontLeg.z = -7
      this.leftHindLeg.xRot = -HALF_PI
      this.leftHindLeg.y = 21
      this.leftHindLeg.z = 1
      this.rightHindLeg.xRot = -HALF_PI
      this.rightHindLeg.y = 21
      this.rightHindLeg.z = 1
      this.state = 3
    }
  }
}

export class FoxModel extends AnimModel {
  head = this.part('head')
  body = this.part('body')
  rightHindLeg = pick(this, 'right_hind_leg', 'leg0')
  leftHindLeg = pick(this, 'left_hind_leg', 'leg1')
  rightFrontLeg = pick(this, 'right_front_leg', 'leg2')
  leftFrontLeg = pick(this, 'left_front_leg', 'leg3')
  tail = this.part('tail')
  /** grows every frame the fox is faceplanted (the model's own field) */
  private legMotionPos = 0

  // Fox's flags
  isSitting = (state: AnimState) => (data(state, 'flags', 0) & 1) !== 0
  isFoxCrouching = (state: AnimState) => (data(state, 'flags', 0) & 4) !== 0
  isSleeping = (state: AnimState) => (data(state, 'flags', 0) & 32) !== 0
  isFaceplanted = (state: AnimState) => (data(state, 'flags', 0) & 64) !== 0

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.prepareMobModel(state)
    const { cos } = this.c
    const ageInTicks = num(state, 'ageInTicks')
    if (!this.isSleeping(state) && !this.isFaceplanted(state) && !this.isFoxCrouching(state)) {
      this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
      this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    }
    if (this.isSleeping(state)) {
      this.head.xRot = 0
      this.head.yRot = f(-2.094_395_2)
      this.head.zRot = f(cos(f(ageInTicks * f(0.027))) / 22)
    }
    if (this.isFoxCrouching(state)) {
      const wiggle = f(cos(ageInTicks) * f(0.01))
      this.body.yRot = wiggle
      this.rightHindLeg.zRot = wiggle
      this.leftHindLeg.zRot = wiggle
      this.rightFrontLeg.zRot = f(wiggle / 2)
      this.leftFrontLeg.zRot = f(wiggle / 2)
    }
    if (this.isFaceplanted(state)) {
      this.legMotionPos = f(this.legMotionPos + f(0.67))
      this.rightHindLeg.xRot = f(cos(f(this.legMotionPos * f(0.4662))) * f(0.1))
      this.leftHindLeg.xRot = f(cos(f(f(this.legMotionPos * f(0.4662)) + PI)) * f(0.1))
      this.rightFrontLeg.xRot = f(cos(f(f(this.legMotionPos * f(0.4662)) + PI)) * f(0.1))
      this.leftFrontLeg.xRot = f(cos(f(this.legMotionPos * f(0.4662))) * f(0.1))
    }
  }

  prepareMobModel(state: AnimState) {
    const pos = num(state, 'walkAnimationPos')
    const speed = num(state, 'walkAnimationSpeed')
    const pt = num(state, 'partialTick')
    // EntityModel.young starts true (the renderer sets it from isBaby)
    const young = modelField(state, 'young', true)
    this.body.xRot = HALF_PI
    this.tail.xRot = f(-0.052_359_88)
    this.rightHindLeg.xRot = walkCos(this, pos, speed)
    this.leftHindLeg.xRot = walkCos(this, pos, speed, PI)
    this.rightFrontLeg.xRot = walkCos(this, pos, speed, PI)
    this.leftFrontLeg.xRot = walkCos(this, pos, speed)
    this.head.setPos(-1, 16.5, -3)
    this.head.yRot = 0
    // Fox.getHeadRollAngle
    this.head.zRot = f(f(lerp(pt, entity(state, 'interestedAngleO', 0), entity(state, 'interestedAngle', 0)) * f(0.11)) * PI)
    this.rightHindLeg.visible = true
    this.leftHindLeg.visible = true
    this.rightFrontLeg.visible = true
    this.leftFrontLeg.visible = true
    this.body.setPos(0, 16, -6)
    this.body.zRot = 0
    this.rightHindLeg.setPos(-5, 17.5, 7)
    this.leftHindLeg.setPos(-1, 17.5, 7)
    if (this.isFoxCrouching(state)) {
      this.body.xRot = f(1.675_516_1)
      // Fox.getCrouchAmount
      const crouchAmount = lerp(pt, entity(state, 'crouchAmountO', 0), entity(state, 'crouchAmount', 0))
      this.body.setPos(0, f(16 + crouchAmount), -6)
      this.head.setPos(-1, f(16.5 + crouchAmount), -3)
      this.head.yRot = 0
    } else if (this.isSleeping(state)) {
      this.body.zRot = -HALF_PI
      this.body.setPos(0, 21, -6)
      this.tail.xRot = f(-2.617_993_8)
      if (young) {
        this.tail.xRot = f(-2.181_661_6)
        this.body.setPos(0, 21, -2)
      }
      this.head.setPos(1, f(19.49), -3)
      this.head.xRot = 0
      this.head.yRot = f(-2.094_395_2)
      this.head.zRot = 0
      this.rightHindLeg.visible = false
      this.leftHindLeg.visible = false
      this.rightFrontLeg.visible = false
      this.leftFrontLeg.visible = false
    } else if (this.isSitting(state)) {
      this.body.xRot = f(0.523_598_8)
      this.body.setPos(0, 9, -3)
      this.tail.xRot = f(0.785_398_2)
      this.tail.setPos(-4, 15, -2)
      this.head.setPos(-1, 10, -0.25)
      this.head.xRot = 0
      this.head.yRot = 0
      if (young) {
        this.head.setPos(-1, 13, -3.75)
      }
      this.rightHindLeg.xRot = f(-1.308_996_9)
      this.rightHindLeg.setPos(-5, 21.5, 6.75)
      this.leftHindLeg.xRot = f(-1.308_996_9)
      this.leftHindLeg.setPos(-1, 21.5, 6.75)
      this.rightFrontLeg.xRot = f(-0.261_799_4)
      this.leftFrontLeg.xRot = f(-0.261_799_4)
    }
  }
}

export class RabbitModel extends AnimModel {
  leftRearFoot = pick(this, 'left_hind_foot', 'rear_foot_left')
  rightRearFoot = pick(this, 'right_hind_foot', 'rear_foot_right')
  leftHaunch = pick(this, 'left_haunch', 'haunch_left')
  rightHaunch = pick(this, 'right_haunch', 'haunch_right')
  leftFrontLeg = pick(this, 'left_front_leg', 'front_leg_left')
  rightFrontLeg = pick(this, 'right_front_leg', 'front_leg_right')
  head = this.part('head')
  rightEar = pick(this, 'right_ear', 'ear_right')
  leftEar = pick(this, 'left_ear', 'ear_left')
  nose = this.part('nose')
  private jumpRotation = 0

  /** Rabbit.getJumpCompletion */
  jumpCompletion(state: AnimState, partialTick: number) {
    const jumpDuration = entity(state, 'jumpDuration', 0)
    return jumpDuration === 0 ? 0 : f(f(entity(state, 'jumpTicks', 0) + partialTick) / jumpDuration)
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    // prepareMobModel
    this.jumpRotation = this.c.sin(f(this.jumpCompletion(state, num(state, 'partialTick')) * PI))
    const partialTick = f(num(state, 'ageInTicks') - entity(state, 'tickCount', 0))
    const headPitch = f(num(state, 'xRot') * DEG_TO_RAD)
    this.nose.xRot = headPitch
    this.head.xRot = headPitch
    this.rightEar.xRot = headPitch
    this.leftEar.xRot = headPitch
    this.nose.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    this.rightEar.yRot = f(this.nose.yRot - f(0.261_799_4))
    this.leftEar.yRot = f(this.nose.yRot + f(0.261_799_4))
    this.jumpRotation = this.c.sin(f(this.jumpCompletion(state, partialTick) * PI))
    this.leftHaunch.xRot = f(f(f(this.jumpRotation * 50) - 21) * DEG_TO_RAD)
    this.rightHaunch.xRot = f(f(f(this.jumpRotation * 50) - 21) * DEG_TO_RAD)
    this.leftRearFoot.xRot = f(f(this.jumpRotation * 50) * DEG_TO_RAD)
    this.rightRearFoot.xRot = f(f(this.jumpRotation * 50) * DEG_TO_RAD)
    this.leftFrontLeg.xRot = f(f(f(this.jumpRotation * -40) - 11) * DEG_TO_RAD)
    this.rightFrontLeg.xRot = f(f(f(this.jumpRotation * -40) - 11) * DEG_TO_RAD)
  }
}

export class ChickenModel extends AnimModel {
  head = this.part('head')
  beak = this.part('beak')
  redThing = this.part('red_thing')
  body = this.part('body')
  rightLeg = pick(this, 'right_leg', 'leg0')
  leftLeg = pick(this, 'left_leg', 'leg1')
  rightWing = pick(this, 'right_wing', 'wing0')
  leftWing = pick(this, 'left_wing', 'wing1')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const pos = num(state, 'walkAnimationPos')
    const speed = num(state, 'walkAnimationSpeed')
    this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
    this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    this.beak.xRot = this.head.xRot
    this.beak.yRot = this.head.yRot
    this.redThing.xRot = this.head.xRot
    this.redThing.yRot = this.head.yRot
    // before 1.17 the body's rotation is set here (the layer's pose has it after)
    if (!this.c.atLeast('1.17')) this.body.xRot = HALF_PI
    this.rightLeg.xRot = walkCos(this, pos, speed)
    this.leftLeg.xRot = walkCos(this, pos, speed, PI)
    this.rightWing.zRot = num(state, 'ageInTicks')
    this.leftWing.zRot = -num(state, 'ageInTicks')
  }
}

type ParrotState = 'FLYING' | 'STANDING' | 'SITTING' | 'PARTY' | 'ON_SHOULDER'

export class ParrotModel extends AnimModel {
  body = this.part('body')
  tail = this.part('tail')
  leftWing = pick(this, 'left_wing', 'wing_left')
  rightWing = pick(this, 'right_wing', 'wing_right')
  head = this.part('head')
  feather = this.part('feather')
  leftLeg = pick(this, 'left_leg', 'leg_left')
  rightLeg = pick(this, 'right_leg', 'leg_right')

  /** ParrotModel.getState: Parrot.isFlying is !onGround. */
  getState(state: AnimState): ParrotState {
    if (entity(state, 'partyParrot', false)) return 'PARTY'
    if (isInSittingPose(state)) return 'SITTING'
    return entity(state, 'onGround', false) ? 'STANDING' : 'FLYING'
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const pose = this.getState(state)
    this.prepare(pose)
    this.setupAnimPose(
      pose,
      entity(state, 'tickCount', 0),
      num(state, 'walkAnimationPos'),
      num(state, 'walkAnimationSpeed'),
      num(state, 'ageInTicks'),
      num(state, 'yRot'),
      num(state, 'xRot')
    )
  }

  setupAnimPose(pose: ParrotState, tickCount: number, pos: number, speed: number, flap: number, yRot: number, xRot: number) {
    const { sin, cos } = this.c
    this.head.xRot = f(xRot * DEG_TO_RAD)
    this.head.yRot = f(yRot * DEG_TO_RAD)
    this.head.zRot = 0
    this.head.x = 0
    this.body.x = 0
    this.tail.x = 0
    this.rightWing.x = -1.5
    this.leftWing.x = 1.5
    switch (pose) {
      case 'SITTING':
        break
      case 'PARTY': {
        const x = cos(tickCount)
        const y = sin(tickCount)
        this.head.x = x
        this.head.y = f(f(15.69) + y)
        this.head.xRot = 0
        this.head.yRot = 0
        this.head.zRot = f(sin(tickCount) * f(0.4))
        this.body.x = x
        this.body.y = f(16.5 + y)
        this.leftWing.zRot = f(f(-0.0873) - flap)
        this.leftWing.x = f(1.5 + x)
        this.leftWing.y = f(f(16.94) + y)
        this.rightWing.zRot = f(f(0.0873) + flap)
        this.rightWing.x = f(-1.5 + x)
        this.rightWing.y = f(f(16.94) + y)
        this.tail.x = x
        this.tail.y = f(f(21.07) + y)
        break
      }
      case 'STANDING':
        this.leftLeg.xRot = f(this.leftLeg.xRot + walkCos(this, pos, speed))
        this.rightLeg.xRot = f(this.rightLeg.xRot + walkCos(this, pos, speed, PI))
      // falls through
      default: {
        const bob = f(flap * f(0.3))
        this.head.y = f(f(15.69) + bob)
        this.tail.xRot = f(f(1.015) + f(f(cos(f(pos * f(0.6662))) * f(0.3)) * speed))
        this.tail.y = f(f(21.07) + bob)
        this.body.y = f(16.5 + bob)
        this.leftWing.zRot = f(f(-0.0873) - flap)
        this.leftWing.y = f(f(16.94) + bob)
        this.rightWing.zRot = f(f(0.0873) + flap)
        this.rightWing.y = f(f(16.94) + bob)
        this.leftLeg.y = f(22 + bob)
        this.rightLeg.y = f(22 + bob)
      }
    }
  }

  prepare(pose: ParrotState) {
    this.feather.xRot = f(-0.2214)
    this.body.xRot = f(0.4937)
    this.leftWing.xRot = f(-0.6981)
    this.leftWing.yRot = -PI
    this.rightWing.xRot = f(-0.6981)
    this.rightWing.yRot = -PI
    this.leftLeg.xRot = f(-0.0299)
    this.rightLeg.xRot = f(-0.0299)
    this.leftLeg.y = 22
    this.rightLeg.y = 22
    this.leftLeg.zRot = 0
    this.rightLeg.zRot = 0
    switch (pose) {
      case 'FLYING':
        this.leftLeg.xRot = f(this.leftLeg.xRot + f(0.698_131_7))
        this.rightLeg.xRot = f(this.rightLeg.xRot + f(0.698_131_7))
        break
      case 'SITTING': {
        // the decompiler prints ++ for these: the bytecode adds 1.9 and HALF_PI
        const sittingYOffset = f(1.9)
        this.head.y = f(17.59)
        this.tail.xRot = f(1.538_898_8)
        this.tail.y = f(22.97)
        this.body.y = f(18.4)
        this.leftWing.zRot = f(-0.0873)
        this.leftWing.y = f(18.84)
        this.rightWing.zRot = f(0.0873)
        this.rightWing.y = f(18.84)
        this.leftLeg.y = f(this.leftLeg.y + sittingYOffset)
        this.rightLeg.y = f(this.rightLeg.y + sittingYOffset)
        this.leftLeg.xRot = f(this.leftLeg.xRot + HALF_PI)
        this.rightLeg.xRot = f(this.rightLeg.xRot + HALF_PI)
        break
      }
      case 'PARTY':
        this.leftLeg.zRot = f(-0.349_065_84)
        this.rightLeg.zRot = f(0.349_065_84)
        break
      default:
        break
    }
  }
}

export class BatModel extends AnimModel {
  head = this.part('head')
  body = this.part('body')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')
  rightWingTip = this.part('right_wing_tip')
  leftWingTip = this.part('left_wing_tip')

  /** Bat.isResting: the id flags' bit 1. */
  isResting(state: AnimState) {
    return (data(state, 'id_flags', 0) & 1) !== 0
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    // 1.20.3 on: keyframe animations (BatModel is a HierarchicalModel that resets its pose first)
    if (this.c.atLeast('1.20.3')) {
      if (this.isResting(state)) {
        this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
      }
      animate(this, entity(state, 'flyAnimationState', null), 'BatAnimation.BAT_FLYING', num(state, 'ageInTicks'), 1)
      animate(this, entity(state, 'restAnimationState', null), 'BatAnimation.BAT_RESTING', num(state, 'ageInTicks'), 1)
      return
    }
    const { cos } = this.c
    const ageInTicks = num(state, 'ageInTicks')
    if (this.isResting(state)) {
      this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
      this.head.yRot = f(PI - f(num(state, 'yRot') * DEG_TO_RAD))
      this.head.zRot = PI
      this.head.setPos(0, -2, 0)
      this.rightWing.setPos(-3, 0, 3)
      this.leftWing.setPos(3, 0, 3)
      this.body.xRot = PI
      this.rightWing.xRot = f(-0.157_079_64)
      this.rightWing.yRot = f(-1.256_637_1)
      this.rightWingTip.yRot = f(-1.727_876_1)
      this.leftWing.xRot = this.rightWing.xRot
      this.leftWing.yRot = -this.rightWing.yRot
      this.leftWingTip.yRot = -this.rightWingTip.yRot
    } else {
      this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
      this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
      this.head.zRot = 0
      this.head.setPos(0, 0, 0)
      this.rightWing.setPos(0, 0, 0)
      this.leftWing.setPos(0, 0, 0)
      this.body.xRot = f(f(0.785_398_2) + f(cos(f(ageInTicks * f(0.1))) * f(0.15)))
      this.body.yRot = 0
      // 1.17: the flap's speed in degrees per tick
      const flap = this.c.atLeast('1.17') ? f(f(ageInTicks * f(74.484_51)) * DEG_TO_RAD) : f(ageInTicks * f(1.3))
      this.rightWing.yRot = f(f(cos(flap) * PI) * f(0.25))
      this.leftWing.yRot = -this.rightWing.yRot
      this.rightWingTip.yRot = f(this.rightWing.yRot * 0.5)
      this.leftWingTip.yRot = f(-this.rightWing.yRot * 0.5)
    }
  }
}

export class BeeModel extends AnimModel {
  bone = this.part('bone')
  stinger = this.part('stinger')
  leftAntenna = this.part('left_antenna')
  rightAntenna = this.part('right_antenna')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')
  frontLeg = pick(this, 'front_legs', 'front_leg')
  midLeg = pick(this, 'middle_legs', 'mid_leg')
  backLeg = pick(this, 'back_legs', 'back_leg')
  private rollAmount = 0

  /** Bee.isAngry: the remaining anger time (1.15: the anger time). */
  isAngry(state: AnimState) {
    return (this.c.atLeast('1.16') ? data(state, 'remaining_anger_time', 0) : data(state, 'anger_time', 0)) > 0
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const ageInTicks = num(state, 'ageInTicks')
    // prepareMobModel: Bee.getRollAmount, hasStung (the flags' bit 4)
    this.rollAmount = lerp(num(state, 'partialTick'), entity(state, 'rollAmountO', 0), entity(state, 'rollAmount', 0))
    this.stinger.visible = (data(state, 'flags', 0) & 4) === 0
    this.rightWing.xRot = 0
    this.leftAntenna.xRot = 0
    this.rightAntenna.xRot = 0
    this.bone.xRot = 0
    if (!this.c.atLeast('1.17')) this.bone.y = 19
    // onGround && getDeltaMovement().lengthSqr() < 1.0E-7 (entity.onGround, entity.deltaMovement [x, y, z] in doubles)
    const [dx, dy, dz] = entity(state, 'deltaMovement', [0, 0, 0] as number[])
    const resting = entity(state, 'onGround', false) && dx! * dx! + dy! * dy! + dz! * dz! < 1e-7
    if (resting) {
      this.rightWing.yRot = f(-0.2618)
      this.rightWing.zRot = 0
      this.leftWing.xRot = 0
      this.leftWing.yRot = f(0.2618)
      this.leftWing.zRot = 0
      this.frontLeg.xRot = 0
      this.midLeg.xRot = 0
      this.backLeg.xRot = 0
    } else {
      const flap = this.c.atLeast('1.17') ? f(f(ageInTicks * f(120.321_13)) * DEG_TO_RAD) : f(ageInTicks * f(2.1))
      this.rightWing.yRot = 0
      this.rightWing.zRot = f(f(cos(flap) * PI) * f(0.15))
      this.leftWing.xRot = this.rightWing.xRot
      this.leftWing.yRot = this.rightWing.yRot
      this.leftWing.zRot = -this.rightWing.zRot
      this.frontLeg.xRot = f(0.785_398_2)
      this.midLeg.xRot = f(0.785_398_2)
      this.backLeg.xRot = f(0.785_398_2)
      this.bone.xRot = 0
      this.bone.yRot = 0
      this.bone.zRot = 0
    }
    if (!this.isAngry(state)) {
      this.bone.xRot = 0
      this.bone.yRot = 0
      this.bone.zRot = 0
      if (!resting) {
        const bob = cos(f(ageInTicks * f(0.18)))
        this.bone.xRot = f(f(0.1) + f(f(bob * PI) * f(0.025)))
        this.leftAntenna.xRot = f(f(bob * PI) * f(0.03))
        this.rightAntenna.xRot = f(f(bob * PI) * f(0.03))
        this.frontLeg.xRot = f(f(f(-bob * PI) * f(0.1)) + f(0.392_699_1))
        this.backLeg.xRot = f(f(f(-bob * PI) * f(0.05)) + f(0.785_398_2))
        this.bone.y = f(19 - f(cos(f(ageInTicks * f(0.18))) * f(0.9)))
      }
    }
    if (this.rollAmount > 0) {
      this.bone.xRot = rotLerpRad(this.rollAmount, this.bone.xRot, f(3.091_592_8))
    }
  }
}

export class AllayModel extends AnimModel {
  root = this.part('/root')
  head = this.part('head')
  body = this.part('body')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const pos = num(state, 'walkAnimationPos')
    const speed = num(state, 'walkAnimationSpeed')
    const ageInTicks = num(state, 'ageInTicks')
    const v1_19_2 = this.c.atLeast('1.19.1')
    const v1_19_4 = this.c.atLeast('1.19.3')
    if (!v1_19_2) {
      this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
      this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    }
    const wingTime = f(f(f(ageInTicks * 20) * DEG_TO_RAD) + (v1_19_4 ? pos : speed))
    const wingSwing = v1_19_4 ? f(f(f(cos(wingTime) * PI) * f(0.15)) + speed) : f(f(cos(wingTime) * PI) * f(0.15))
    const partialTick = f(ageInTicks - entity(state, 'tickCount', 0))
    const bobTime = f(f(ageInTicks * 9) * DEG_TO_RAD)
    const flying = Math.min(f(speed / f(0.3)), 1)
    const idle = f(1 - flying)
    // Allay.getHoldingItemAnimationProgress
    const holding = f(lerp(partialTick, entity(state, 'holdingItemAnimationTicks0', 0), entity(state, 'holdingItemAnimationTicks', 0)) / 5)
    if (v1_19_2) {
      if (data(state, 'dancing', false)) {
        const danceTime = f(f(f(ageInTicks * 8) * DEG_TO_RAD) + speed)
        const rootRoll = f(f(cos(danceTime) * 16) * DEG_TO_RAD)
        // Allay.getSpinningProgress, isSpinning
        const spinning = f(lerp(partialTick, entity(state, 'spinningAnimationTicks0', 0), entity(state, 'spinningAnimationTicks', 0)) / 15)
        const headRoll = f(f(cos(danceTime) * 14) * DEG_TO_RAD)
        const headYaw = f(f(cos(danceTime) * 30) * DEG_TO_RAD)
        const isSpinning = f(entity(state, 'dancingAnimationTicks', 0) % 55) < 15
        this.root.yRot = isSpinning ? f(f(12.566_371) * spinning) : this.root.yRot
        this.root.zRot = f(rootRoll * f(1 - spinning))
        this.head.yRot = f(headYaw * f(1 - spinning))
        this.head.zRot = f(headRoll * f(1 - spinning))
      } else {
        this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
        this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
      }
    }
    let armXRot: number
    if (v1_19_4) {
      this.rightWing.xRot = f(f(0.436_332_32) * f(1 - flying))
      this.rightWing.yRot = f(f(-0.785_398_2) + wingSwing)
      this.leftWing.xRot = f(f(0.436_332_32) * f(1 - flying))
      this.leftWing.yRot = f(f(0.785_398_2) - wingSwing)
      this.body.xRot = f(flying * f(0.785_398_2))
      armXRot = f(holding * lerp(flying, f(-1.047_197_6), f(-1.134_464)))
    } else {
      this.rightWing.xRot = f(0.436_332_32)
      this.rightWing.yRot = f(f(-0.610_865_24) + wingSwing)
      this.leftWing.xRot = f(0.436_332_32)
      this.leftWing.yRot = f(f(0.610_865_24) - wingSwing)
      const bodyXRot = f(flying * f(0.698_131_7))
      this.body.xRot = bodyXRot
      armXRot = lerp(holding, bodyXRot, lerp(flying, f(-1.047_197_6), f(-0.785_398_2)))
    }
    this.root.y = f(this.root.y + f(f(f(Math.cos(bobTime)) * f(0.25)) * idle))
    this.rightArm.xRot = armXRot
    this.leftArm.xRot = armXRot
    const swing = f(idle * f(1 - holding))
    const armZRot = f(f(0.436_332_32) - f(f(f(cos(f(bobTime + f(4.712_389))) * PI) * f(0.075)) * swing))
    this.leftArm.zRot = -armZRot
    this.rightArm.zRot = armZRot
    this.rightArm.yRot = f(f(0.279_252_68) * holding)
    this.leftArm.yRot = f(f(-0.279_252_68) * holding)
  }
}

/** 1.14.4 - 1.19.2's VexModel: a HumanoidModel with wings (the left leg and the hat hidden). */
export class HumanoidVexModel extends HumanoidModel {
  leftWing = this.part('left_wing')
  rightWing = this.part('right_wing')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const ageInTicks = num(state, 'ageInTicks')
    // Vex.isCharging: the flags' bit 1
    if ((data(state, 'flags', 0) & 1) !== 0) {
      if (this.c.atLeast('1.16') && !state['item.mainhand']) {
        this.rightArm.xRot = f(4.712_389)
        this.leftArm.xRot = f(4.712_389)
      } else if (EntityState.mainArm(state) === 'RIGHT') {
        this.rightArm.xRot = f(3.769_911_5)
      } else {
        this.leftArm.xRot = f(3.769_911_5)
      }
    }
    this.rightLeg.xRot = f(this.rightLeg.xRot + f(0.628_318_55))
    this.rightWing.z = 2
    this.leftWing.z = 2
    this.rightWing.y = 1
    this.leftWing.y = 1
    // 1.17: the flap's speed in degrees per tick
    const flap = this.c.atLeast('1.17') ? f(f(ageInTicks * f(45.836_624)) * DEG_TO_RAD) : f(ageInTicks * f(0.8))
    this.rightWing.yRot = f(f(0.471_238_94) + f(f(cos(flap) * PI) * f(0.05)))
    this.leftWing.yRot = -this.rightWing.yRot
    this.leftWing.zRot = f(-0.471_238_94)
    this.leftWing.xRot = f(0.471_238_94)
    this.rightWing.xRot = f(0.471_238_94)
    this.rightWing.zRot = f(0.471_238_94)
  }
}

/** 1.19.3 on: VexModel is its own HierarchicalModel. */
export class HierarchicalVexModel extends AnimModel {
  root = this.part('/root')
  body = this.part('body')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')
  head = this.part('head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const ageInTicks = num(state, 'ageInTicks')
    this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
    const armSwing = f(cos(f(f(ageInTicks * f(5.5)) * DEG_TO_RAD)) * f(0.1))
    this.rightArm.zRot = f(f(0.628_318_55) + armSwing)
    this.leftArm.zRot = -f(f(0.628_318_55) + armSwing)
    // Vex.isCharging: the flags' bit 1
    if ((data(state, 'flags', 0) & 1) !== 0) {
      this.body.xRot = 0
      this.setArmsCharging(!!state['item.mainhand'], !!state['item.offhand'], armSwing)
    } else {
      this.body.xRot = f(0.157_079_64)
    }
    this.leftWing.yRot = f(f(1.099_557_4) + f(f(cos(f(f(ageInTicks * f(45.836_624)) * DEG_TO_RAD)) * DEG_TO_RAD) * f(16.2)))
    this.rightWing.yRot = -this.leftWing.yRot
    this.leftWing.xRot = f(0.471_238_88)
    this.leftWing.zRot = f(-0.471_238_88)
    this.rightWing.xRot = f(0.471_238_88)
    this.rightWing.zRot = f(0.471_238_88)
  }

  setArmsCharging(mainHand: boolean, offHand: boolean, armSwing: number) {
    if (!mainHand && !offHand) {
      this.rightArm.xRot = f(-1.221_730_5)
      this.rightArm.yRot = f(0.261_799_4)
      this.rightArm.zRot = f(f(-0.471_238_88) - armSwing)
      this.leftArm.xRot = f(-1.221_730_5)
      this.leftArm.yRot = f(-0.261_799_4)
      this.leftArm.zRot = f(f(0.471_238_88) + armSwing)
    } else {
      if (mainHand) {
        this.rightArm.xRot = f(3.665_191_4)
        this.rightArm.yRot = f(0.261_799_4)
        this.rightArm.zRot = f(f(-0.471_238_88) - armSwing)
      }
      if (offHand) {
        this.leftArm.xRot = f(3.665_191_4)
        this.leftArm.yRot = f(-0.261_799_4)
        this.leftArm.zRot = f(f(0.471_238_88) + armSwing)
      }
    }
  }
}

/** VexModel: a HumanoidModel before 1.19.3, a HierarchicalModel after (one Java class name, two hierarchies). */
export class VexModel extends AnimModel {
  readonly impl: AnimModel = this.c.atLeast('1.19.3') ? new HierarchicalVexModel(this.model, this.c) : new HumanoidVexModel(this.model, this.c)

  override setupAnim(state: AnimState) {
    this.impl.setupAnim(state)
  }
}

export const ENTITY_ERA_SMALL_MODELS: Record<string, AnimModelClass> = {
  WolfModel,
  OcelotModel,
  CatModel,
  FoxModel,
  RabbitModel,
  ChickenModel,
  ParrotModel,
  BatModel,
  BeeModel,
  AllayModel,
  VexModel
}
