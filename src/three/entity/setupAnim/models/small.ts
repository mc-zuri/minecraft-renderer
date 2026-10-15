import { AnimModel, type AnimModelClass, type AnimState } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, f, lerp, rotLerp, rotLerpRad } from '../mth'
import { applyAnimationState, applyWalkAnimation } from '../keyframes'

/**
 * Small animals and flyers (wolves, felines, foxes, rabbits, chickens, parrots, bats, bees, allays, vexes), 26.3.
 */

/** WolfRenderState.getBodyRollAngle */
const bodyRollAngle = (m: AnimModel, state: AnimState, offset: number) => {
  const { sin } = m.c
  let progress = f(f((state.shakeAnim as number) + offset) / f(1.8))
  if (progress < 0) progress = 0
  else if (progress > 1) progress = 1
  return f(f(f(sin(f(progress * PI)) * sin(f(f(progress * PI) * 11))) * f(0.15)) * PI)
}

export class WolfModel extends AnimModel {
  head = this.part('head')
  body = this.part('body')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')
  tail = this.part('tail')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const animationPos = state.walkAnimationPos as number
    const animationSpeed = state.walkAnimationSpeed as number
    if (state.isAngry) {
      this.tail.yRot = 0
    } else {
      this.tail.yRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
    }
    if (state.isSitting) {
      this.setSittingPose(state)
    } else {
      this.rightHindLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
      this.leftHindLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
      this.rightFrontLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
      this.leftFrontLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
    }
    this.shakeOffWater(state)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.tail.xRot = state.tailAngle
  }

  shakeOffWater(state: AnimState) {
    this.body.zRot = bodyRollAngle(this, state, f(-0.16))
  }

  setSittingPose(state: AnimState) {
    const ageScale = state.ageScale as number
    this.body.y = f(this.body.y + f(4 * ageScale))
    this.body.z = f(this.body.z - f(2 * ageScale))
    this.body.xRot = f(0.785_398_2)
    this.tail.y = f(this.tail.y + f(9 * ageScale))
    this.tail.z = f(this.tail.z - f(2 * ageScale))
    this.rightHindLeg.y = f(this.rightHindLeg.y + f(f(6.7) * ageScale))
    this.rightHindLeg.z = f(this.rightHindLeg.z - f(5 * ageScale))
    this.rightHindLeg.xRot = f(4.712_389)
    this.leftHindLeg.y = f(this.leftHindLeg.y + f(f(6.7) * ageScale))
    this.leftHindLeg.z = f(this.leftHindLeg.z - f(5 * ageScale))
    this.leftHindLeg.xRot = f(4.712_389)
    this.rightFrontLeg.xRot = f(5.811_947)
    this.rightFrontLeg.x = f(this.rightFrontLeg.x + f(f(0.01) * ageScale))
    this.rightFrontLeg.y = f(this.rightFrontLeg.y + f(1 * ageScale))
    this.leftFrontLeg.xRot = f(5.811_947)
    this.leftFrontLeg.x = f(this.leftFrontLeg.x - f(f(0.01) * ageScale))
    this.leftFrontLeg.y = f(this.leftFrontLeg.y + f(1 * ageScale))
  }
}

export class AdultWolfModel extends WolfModel {
  realHead = this.part('real_head')
  upperBody = this.part('upper_body')
  realTail = this.part('real_tail')

  override setSittingPose(state: AnimState) {
    super.setSittingPose(state)
    this.upperBody.y = f(this.upperBody.y + 2)
    this.upperBody.xRot = f(1.256_637_1)
    this.upperBody.yRot = 0
  }

  override shakeOffWater(state: AnimState) {
    super.shakeOffWater(state)
    this.realHead.zRot = f(state.headRollAngle + bodyRollAngle(this, state, 0))
    this.upperBody.zRot = bodyRollAngle(this, state, f(-0.08))
    this.realTail.zRot = bodyRollAngle(this, state, f(-0.2))
  }
}

export class BabyWolfModel extends WolfModel {
  override shakeOffWater(state: AnimState) {
    super.shakeOffWater(state)
    this.head.zRot = f(state.headRollAngle + bodyRollAngle(this, state, 0))
    this.tail.zRot = bodyRollAngle(this, state, f(-0.2))
  }

  override setSittingPose(state: AnimState) {
    super.setSittingPose(state)
    this.body.xRot = f(this.body.xRot - HALF_PI)
  }
}

export class AbstractFelineModel extends AnimModel {
  leftHindLeg = this.part('left_hind_leg')
  rightHindLeg = this.part('right_hind_leg')
  leftFrontLeg = this.part('left_front_leg')
  rightFrontLeg = this.part('right_front_leg')
  tail1 = this.part('tail1')
  tail2 = this.part('tail2')
  head = this.part('head')
  body = this.part('body')

  /** The crouching / sprinting tail and the head look (the start of both AdultFelineModel's and BabyFelineModel's setupAnim). */
  protected setupCrouchSprintAndHead(state: AnimState, ageScale: number) {
    if (state.isCrouching) {
      this.body.y = f(this.body.y + f(1 * ageScale))
      this.head.y = f(this.head.y + f(2 * ageScale))
      this.tail1.y = f(this.tail1.y + f(1 * ageScale))
      this.tail2.y = f(this.tail2.y + f(-4 * ageScale))
      this.tail2.z = f(this.tail2.z + f(2 * ageScale))
      this.tail1.xRot = HALF_PI
      this.tail2.xRot = HALF_PI
    } else if (state.isSprinting) {
      this.tail2.y = this.tail1.y
      this.tail2.z = f(this.tail2.z + f(2 * ageScale))
      this.tail1.xRot = HALF_PI
      this.tail2.xRot = HALF_PI
    }
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
  }

  /** The walking legs and tail when not sitting (the same in both setupAnim). */
  protected setupWalk(state: AnimState) {
    const { cos } = this.c
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    if (state.isSprinting) {
      this.leftHindLeg.xRot = f(cos(f(animationPos * f(0.6662))) * animationSpeed)
      this.rightHindLeg.xRot = f(cos(f(f(animationPos * f(0.6662)) + f(0.3))) * animationSpeed)
      this.leftFrontLeg.xRot = f(cos(f(f(f(animationPos * f(0.6662)) + PI) + f(0.3))) * animationSpeed)
      this.rightFrontLeg.xRot = f(cos(f(f(animationPos * f(0.6662)) + PI)) * animationSpeed)
      this.tail2.xRot = f(f(1.727_876_1) + f(f(f(0.314_159_27) * cos(animationPos)) * animationSpeed))
    } else {
      this.leftHindLeg.xRot = f(cos(f(animationPos * f(0.6662))) * animationSpeed)
      this.rightHindLeg.xRot = f(cos(f(f(animationPos * f(0.6662)) + PI)) * animationSpeed)
      this.leftFrontLeg.xRot = f(cos(f(f(animationPos * f(0.6662)) + PI)) * animationSpeed)
      this.rightFrontLeg.xRot = f(cos(f(animationPos * f(0.6662))) * animationSpeed)
      if (!state.isCrouching) {
        this.tail2.xRot = f(f(1.727_876_1) + f(f(f(0.785_398_2) * cos(animationPos)) * animationSpeed))
      } else {
        this.tail2.xRot = f(f(1.727_876_1) + f(f(f(0.471_238_94) * cos(animationPos)) * animationSpeed))
      }
    }
  }
}

export class AdultFelineModel extends AbstractFelineModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const ageScale = state.ageScale as number
    this.setupCrouchSprintAndHead(state, ageScale)
    if (!state.isSitting) {
      this.body.xRot = HALF_PI
      this.setupWalk(state)
    }
    if (state.isSitting) {
      this.body.xRot = f(0.785_398_2)
      this.body.y = f(this.body.y + f(-4 * ageScale))
      this.body.z = f(this.body.z + f(5 * ageScale))
      this.head.y = f(this.head.y + f(f(-3.3) * ageScale))
      this.head.z = f(this.head.z + f(1 * ageScale))
      this.tail1.y = f(this.tail1.y + f(8 * ageScale))
      this.tail1.z = f(this.tail1.z + f(-2 * ageScale))
      this.tail2.y = f(this.tail2.y + f(2 * ageScale))
      this.tail2.z = f(this.tail2.z + f(f(-0.8) * ageScale))
      this.tail1.xRot = f(1.727_876_1)
      this.tail2.xRot = f(2.670_354)
      this.leftFrontLeg.xRot = f(-0.157_079_64)
      this.leftFrontLeg.y = f(this.leftFrontLeg.y + f(2 * ageScale))
      this.leftFrontLeg.z = f(this.leftFrontLeg.z - f(2 * ageScale))
      this.rightFrontLeg.xRot = f(-0.157_079_64)
      this.rightFrontLeg.y = f(this.rightFrontLeg.y + f(2 * ageScale))
      this.rightFrontLeg.z = f(this.rightFrontLeg.z - f(2 * ageScale))
      this.leftHindLeg.xRot = -HALF_PI
      this.leftHindLeg.y = f(this.leftHindLeg.y + f(3 * ageScale))
      this.leftHindLeg.z = f(this.leftHindLeg.z - f(4 * ageScale))
      this.rightHindLeg.xRot = -HALF_PI
      this.rightHindLeg.y = f(this.rightHindLeg.y + f(3 * ageScale))
      this.rightHindLeg.z = f(this.rightHindLeg.z - f(4 * ageScale))
    }
    const lieDownAmount = state.lieDownAmount as number
    if (lieDownAmount > 0) {
      this.head.zRot = rotLerp(lieDownAmount, this.head.zRot, f(-1.270_796_3))
      this.head.yRot = rotLerp(lieDownAmount, this.head.yRot, f(1.270_796_3))
      this.leftFrontLeg.xRot = f(-1.270_796_3)
      this.rightFrontLeg.xRot = f(-0.470_796_35)
      this.rightFrontLeg.zRot = f(-0.2)
      this.rightFrontLeg.x = f(this.rightFrontLeg.x + ageScale)
      this.leftHindLeg.xRot = f(-0.4)
      this.rightHindLeg.xRot = 0.5
      this.rightHindLeg.zRot = -0.5
      this.rightHindLeg.x = f(this.rightHindLeg.x + f(f(0.8) * ageScale))
      this.rightHindLeg.y = f(this.rightHindLeg.y + f(2 * ageScale))
      this.tail1.xRot = rotLerp(state.lieDownAmountTail, this.tail1.xRot, f(0.8))
      this.tail2.xRot = rotLerp(state.lieDownAmountTail, this.tail2.xRot, f(-0.4))
    }
    const relaxStateOneAmount = state.relaxStateOneAmount as number
    if (relaxStateOneAmount > 0) this.head.xRot = rotLerp(relaxStateOneAmount, this.head.xRot, f(-0.581_776_44))
  }
}

export class BabyFelineModel extends AbstractFelineModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const ageScale = state.ageScale as number
    this.setupCrouchSprintAndHead(state, ageScale)
    if (!state.isSitting) {
      this.setupWalk(state)
    } else if (state.isSitting) {
      this.body.xRot = f(this.body.xRot + f(-0.436_332_32))
      this.body.y = f(this.body.y + f(1.25))
      this.head.z = f(this.head.z + f(0.75))
      this.tail1.xRot = f(this.tail1.xRot + f(0.545_415_4))
      this.tail1.y = f(this.tail1.y + 4)
      this.tail1.z = f(this.tail1.z - f(0.9))
      this.leftHindLeg.z = f(this.leftHindLeg.z - f(0.9))
      this.rightHindLeg.z = f(this.rightHindLeg.z - f(0.9))
    }
    const lieDownAmount = state.lieDownAmount as number
    if (lieDownAmount > 0) {
      const lieDownAmountTail = state.lieDownAmountTail as number
      this.body.x = f(this.body.x + 1)
      this.head.xRot = rotLerp(lieDownAmount, this.head.xRot, f(0.174_532_92))
      this.head.zRot = rotLerp(lieDownAmount, this.head.zRot, f(-1.308_996_9))
      this.head.x = f(this.head.x + f(1.5))
      this.head.y = f(this.head.y + f(0.75))
      this.head.z = f(this.head.z - 0.5)
      this.rightFrontLeg.xRot = f(-0.785_398_2)
      this.rightFrontLeg.x = f(this.rightFrontLeg.x + f(3.5))
      this.rightFrontLeg.y = f(this.rightFrontLeg.y - 0.5)
      this.rightFrontLeg.z = f(this.rightFrontLeg.z + 0)
      this.leftFrontLeg.xRot = -HALF_PI
      this.leftFrontLeg.x = f(this.leftFrontLeg.x + f(1.5))
      this.leftFrontLeg.y = f(this.leftFrontLeg.y - 1)
      this.leftFrontLeg.z = f(this.leftFrontLeg.z - 2)
      this.rightHindLeg.xRot = f(0.698_131_7)
      this.rightHindLeg.yRot = f(0.349_065_84)
      this.rightHindLeg.zRot = f(-0.349_065_84)
      this.rightHindLeg.x = f(this.rightHindLeg.x + f(2.5))
      this.rightHindLeg.y = f(this.rightHindLeg.y - 0.25)
      this.rightHindLeg.z = f(this.rightHindLeg.z + 0.5)
      this.leftHindLeg.x = f(this.leftHindLeg.x + f(1.5))
      this.leftHindLeg.z = f(this.leftHindLeg.z - 1)
      this.tail1.xRot = f(this.tail1.xRot + rotLerp(lieDownAmountTail, this.tail1.xRot, f(-0.523_598_8)))
      this.tail1.yRot = f(this.tail1.yRot + rotLerp(lieDownAmountTail, this.tail1.yRot, 0))
      this.tail1.zRot = f(this.tail1.zRot + rotLerp(lieDownAmountTail, this.tail1.zRot, f(-0.174_532_92)))
      this.tail1.x = f(this.tail1.x + 1)
      this.tail1.y = f(this.tail1.y + 0.5)
      this.tail1.z = f(this.tail1.z - 0.25)
    }
    const relaxStateOneAmount = state.relaxStateOneAmount as number
    if (relaxStateOneAmount > 0) this.head.xRot = rotLerp(relaxStateOneAmount, this.head.xRot, f(-0.581_776_44))
  }
}

export class FoxModel extends AnimModel {
  head = this.part('head')
  body = this.part('body')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')
  tail = this.part('body/tail')
  /** the model instance's own counter (a field of the Java model), advanced every frame a fox is faceplanted */
  legMotionPos = 0

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    this.setWalkingPose(state)
    if (state.isCrouching) {
      this.setCrouchingPose(state)
    } else if (state.isSleeping) {
      this.setSleepingPose(state)
    } else if (state.isSitting) {
      this.setSittingPose(state)
    }
    if (state.isPouncing) this.setPouncingPose(state)
    if (!state.isSleeping && !state.isFaceplanted && !state.isCrouching) {
      this.head.xRot = f(state.xRot * DEG_TO_RAD)
      this.head.yRot = f(state.yRot * DEG_TO_RAD)
    }
    if (state.isSleeping) {
      this.head.xRot = 0
      this.head.yRot = f(-2.094_395_2)
      this.head.zRot = f(cos(f(state.ageInTicks * f(0.027))) / 22)
    }
    if (state.isFaceplanted) {
      this.legMotionPos = f(this.legMotionPos + f(0.67))
      this.rightHindLeg.xRot = f(cos(f(this.legMotionPos * f(0.4662))) * f(0.1))
      this.leftHindLeg.xRot = f(cos(f(f(this.legMotionPos * f(0.4662)) + PI)) * f(0.1))
      this.rightFrontLeg.xRot = f(cos(f(f(this.legMotionPos * f(0.4662)) + PI)) * f(0.1))
      this.leftFrontLeg.xRot = f(cos(f(this.legMotionPos * f(0.4662))) * f(0.1))
    }
  }

  setSittingPose(_state: AnimState) {
    this.head.xRot = 0
    this.head.yRot = 0
  }

  setSleepingPose(_state: AnimState) {
    this.rightHindLeg.visible = false
    this.leftHindLeg.visible = false
    this.rightFrontLeg.visible = false
    this.leftFrontLeg.visible = false
  }

  setWalkingPose(state: AnimState) {
    this.head.zRot = state.headRollAngle
    this.rightHindLeg.visible = true
    this.leftHindLeg.visible = true
    this.rightFrontLeg.visible = true
    this.leftFrontLeg.visible = true
  }

  setCrouchingPose(state: AnimState) {
    const { cos } = this.c
    this.body.xRot = f(this.body.xRot + f(0.104_719_76))
    this.head.y = f(this.head.y + f(state.crouchAmount * state.ageScale))
    const wiggleAmount = f(cos(state.ageInTicks) * f(0.05))
    this.body.yRot = wiggleAmount
    this.rightHindLeg.zRot = wiggleAmount
    this.leftHindLeg.zRot = wiggleAmount
    this.rightFrontLeg.zRot = f(wiggleAmount / 2)
    this.leftFrontLeg.zRot = f(wiggleAmount / 2)
  }

  setPouncingPose(_state: AnimState) {}
}

export class AdultFoxModel extends FoxModel {
  override setSittingPose(state: AnimState) {
    super.setSittingPose(state)
    this.body.xRot = f(0.523_598_8)
    this.body.y = f(this.body.y - 7)
    this.body.z = f(this.body.z + 3)
    this.tail.xRot = f(0.785_398_2)
    this.head.y = f(this.head.y - f(6.5))
    this.head.z = f(this.head.z + f(2.75))
    this.rightFrontLeg.xRot = f(-0.261_799_4)
    this.leftFrontLeg.xRot = f(-0.261_799_4)
    this.rightHindLeg.xRot = f(-1.308_996_9)
    this.rightHindLeg.y = f(this.rightHindLeg.y + 4)
    this.rightHindLeg.z = f(this.rightHindLeg.z - 0.25)
    this.leftHindLeg.xRot = f(-1.308_996_9)
    this.leftHindLeg.y = f(this.leftHindLeg.y + 4)
    this.leftHindLeg.z = f(this.leftHindLeg.z - 0.25)
    this.tail.z = f(this.tail.z - 1)
  }

  override setSleepingPose(state: AnimState) {
    super.setSleepingPose(state)
    this.body.zRot = -HALF_PI
    this.body.y = f(this.body.y + 5)
    this.tail.xRot = f(-2.617_993_8)
    this.head.x = f(this.head.x + 2)
    this.head.y = f(this.head.y + f(2.99))
    this.head.yRot = f(-2.094_395_2)
    this.head.zRot = 0
  }

  override setWalkingPose(state: AnimState) {
    super.setWalkingPose(state)
    const { cos } = this.c
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    this.rightHindLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
    this.leftHindLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
    this.rightFrontLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
    this.leftFrontLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
  }

  override setCrouchingPose(state: AnimState) {
    super.setCrouchingPose(state)
    this.body.y = f(this.body.y + state.crouchAmount)
  }

  override setPouncingPose(state: AnimState) {
    super.setPouncingPose(state)
    const crouch = f(state.crouchAmount / 2)
    this.body.y = f(this.body.y - crouch)
    this.head.y = f(this.head.y - crouch)
  }
}

export class BabyFoxModel extends FoxModel {
  override setSittingPose(state: AnimState) {
    super.setSittingPose(state)
    const ageScale = state.ageScale as number
    this.body.xRot = f(-0.959_931)
    this.body.z = f(this.body.z - f(f(4.5) * ageScale))
    this.body.y = f(this.body.y + f(3 * ageScale))
    this.tail.y = f(this.tail.y - f(0.6))
    this.tail.z = f(this.tail.z - f(2 * ageScale))
    this.tail.xRot = f(0.959_931_14)
    this.head.y = f(this.head.y - f(0.75))
    this.head.z = f(this.head.z + 0)
    this.rightFrontLeg.xRot = f(-0.261_799_4)
    this.leftFrontLeg.xRot = f(-0.261_799_4)
    this.rightFrontLeg.z = f(this.rightFrontLeg.z - f(1.5))
    this.leftFrontLeg.z = f(this.leftFrontLeg.z - f(1.5))
    this.rightFrontLeg.x = f(this.rightFrontLeg.x + f(0.01))
    this.leftFrontLeg.x = f(this.leftFrontLeg.x - f(0.01))
    this.rightHindLeg.z = f(this.rightHindLeg.z - f(3.75))
    this.leftHindLeg.z = f(this.leftHindLeg.z - f(3.75))
    this.rightHindLeg.x = f(this.rightHindLeg.x + f(0.01))
    this.leftHindLeg.x = f(this.leftHindLeg.x - f(0.01))
  }

  override setSleepingPose(state: AnimState) {
    super.setSleepingPose(state)
    this.body.zRot = -HALF_PI
    this.body.xRot = f(-0.174_532_92)
    this.body.y = f(this.body.y + f(1.5))
    this.body.z = f(this.body.z - f(1.5))
    this.body.x = f(this.body.x - f(1.5))
    this.tail.xRot = f(-2.617_993_8)
    this.tail.xRot = f(-2.181_661_6)
    this.tail.x = f(this.tail.x - f(0.7))
    this.tail.z = f(this.tail.z + f(0.6))
    this.tail.y = f(this.tail.y + f(0.9))
    this.head.x = f(this.head.x - 2)
    this.head.y = f(this.head.y + f(2.8))
    this.head.z = f(this.head.z - 4)
    this.head.yRot = f(-2.094_395_2)
    this.head.zRot = 0
  }

  override setWalkingPose(state: AnimState) {
    super.setWalkingPose(state)
    applyWalkAnimation(this.model, this.c, 'FoxBabyAnimation.FOX_BABY_WALK', state.walkAnimationPos, state.walkAnimationSpeed, 1, 2.5)
  }

  override setCrouchingPose(state: AnimState) {
    super.setCrouchingPose(state)
    this.body.y = f(this.body.y + f(state.crouchAmount / 6))
  }
}

export class RabbitModel extends AnimModel {
  head = this.part('body/head')
  hopAnimation = 'RabbitAnimation.HOP'
  idleHeadTiltAnimation = 'RabbitAnimation.IDLE_HEAD_TILT'

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const tilt = state.idleHeadTiltAnimationState
    if (!(tilt !== null && tilt !== undefined)) {
      this.head.yRot = f(state.yRot * DEG_TO_RAD)
      this.head.xRot = f(state.xRot * DEG_TO_RAD)
    }
    applyAnimationState(this.model, this.c, this.hopAnimation, state.hopAnimationState, state.ageInTicks)
    applyAnimationState(this.model, this.c, this.idleHeadTiltAnimation, state.idleHeadTiltAnimationState, state.ageInTicks)
  }
}

export class AdultRabbitModel extends RabbitModel {}

export class BabyRabbitModel extends RabbitModel {
  override hopAnimation = 'BabyRabbitAnimation.HOP'
  override idleHeadTiltAnimation = 'BabyRabbitAnimation.IDLE_HEAD_TILT'
}

export class ChickenModel extends AnimModel {
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const flapAngle = f(f(sin(state.flap) + 1) * state.flapSpeed)
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    this.rightLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
    this.leftLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
    this.rightWing.zRot = flapAngle
    this.leftWing.zRot = -flapAngle
  }
}

export class AdultChickenModel extends ChickenModel {
  head = this.part('head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
  }
}

const PARROT_POSES = new Set(['FLYING', 'STANDING', 'SITTING', 'PARTY', 'ON_SHOULDER'])

/**
 * ParrotRenderState.pose (a ParrotModel.Pose) hides LivingEntityRenderState.pose (the entity's Pose) under the same name,
 * and the state gives both as `pose`: `parrotPose` when given is the parrot's, else `pose` when it is a ParrotModel.Pose
 * name, else the field's default FLYING (an entity Pose like FALL_FLYING or SLEEPING leaves the parrot's pose alone).
 */
const parrotPose = (state: AnimState): string => state.parrotPose ?? (PARROT_POSES.has(state.pose) ? state.pose : 'FLYING')

export class ParrotModel extends AnimModel {
  body = this.part('body')
  tail = this.part('tail')
  leftWing = this.part('left_wing')
  rightWing = this.part('right_wing')
  head = this.part('head')
  leftLeg = this.part('left_leg')
  rightLeg = this.part('right_leg')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const pose = parrotPose(state)
    this.prepare(pose)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    const walkPos = state.walkAnimationPos as number
    const walkSpeed = state.walkAnimationSpeed as number
    const flapAngle = state.flapAngle as number
    // the Java switch on the pose's ordinal: STANDING falls through into FLYING / ON_SHOULDER / default
    if (pose === 'SITTING') {
      // break
    } else if (pose === 'PARTY') {
      const xPos = cos(state.ageInTicks)
      const yPos = sin(state.ageInTicks)
      this.head.x = f(this.head.x + xPos)
      this.head.y = f(this.head.y + yPos)
      this.head.xRot = 0
      this.head.yRot = 0
      this.head.zRot = f(sin(state.ageInTicks) * f(0.4))
      this.body.x = f(this.body.x + xPos)
      this.body.y = f(this.body.y + yPos)
      this.leftWing.zRot = f(f(-0.0873) - flapAngle)
      this.leftWing.x = f(this.leftWing.x + xPos)
      this.leftWing.y = f(this.leftWing.y + yPos)
      this.rightWing.zRot = f(f(0.0873) + flapAngle)
      this.rightWing.x = f(this.rightWing.x + xPos)
      this.rightWing.y = f(this.rightWing.y + yPos)
      this.tail.x = f(this.tail.x + xPos)
      this.tail.y = f(this.tail.y + yPos)
    } else {
      if (pose === 'STANDING') {
        this.leftLeg.xRot = f(this.leftLeg.xRot + f(f(cos(f(walkPos * f(0.6662))) * f(1.4)) * walkSpeed))
        this.rightLeg.xRot = f(this.rightLeg.xRot + f(f(cos(f(f(walkPos * f(0.6662)) + PI)) * f(1.4)) * walkSpeed))
      }
      const bobbingBody = f(flapAngle * f(0.3))
      this.head.y = f(this.head.y + bobbingBody)
      this.tail.xRot = f(this.tail.xRot + f(f(cos(f(walkPos * f(0.6662))) * f(0.3)) * walkSpeed))
      this.tail.y = f(this.tail.y + bobbingBody)
      this.body.y = f(this.body.y + bobbingBody)
      this.leftWing.zRot = f(f(-0.0873) - flapAngle)
      this.leftWing.y = f(this.leftWing.y + bobbingBody)
      this.rightWing.zRot = f(f(0.0873) + flapAngle)
      this.rightWing.y = f(this.rightWing.y + bobbingBody)
      this.leftLeg.y = f(this.leftLeg.y + bobbingBody)
      this.rightLeg.y = f(this.rightLeg.y + bobbingBody)
    }
  }

  prepare(pose: string) {
    switch (pose) {
      case 'FLYING':
        this.leftLeg.xRot = f(this.leftLeg.xRot + f(0.698_131_7))
        this.rightLeg.xRot = f(this.rightLeg.xRot + f(0.698_131_7))
        break
      case 'SITTING': {
        const sittingYOffset = f(1.9)
        this.head.y = f(this.head.y + sittingYOffset)
        this.tail.xRot = f(this.tail.xRot + f(0.523_598_8))
        this.tail.y = f(this.tail.y + sittingYOffset)
        this.body.y = f(this.body.y + sittingYOffset)
        this.leftWing.zRot = f(-0.0873)
        this.leftWing.y = f(this.leftWing.y + sittingYOffset)
        this.rightWing.zRot = f(0.0873)
        this.rightWing.y = f(this.rightWing.y + sittingYOffset)
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
    }
  }
}

export class BatModel extends AnimModel {
  head = this.part('head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    if (state.isResting) this.head.yRot = f(state.yRot * DEG_TO_RAD)
    applyAnimationState(this.model, this.c, 'BatAnimation.BAT_FLYING', state.flyAnimationState, state.ageInTicks)
    applyAnimationState(this.model, this.c, 'BatAnimation.BAT_RESTING', state.restAnimationState, state.ageInTicks)
  }
}

export class BeeModel extends AnimModel {
  bone = this.part('bone')
  stinger = this.part('stinger')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')
  frontLeg = this.part('front_legs')
  midLeg = this.part('middle_legs')
  backLeg = this.part('back_legs')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    this.stinger.visible = state.hasStinger
    if (!state.isOnGround) {
      const speed = f(f(state.ageInTicks * f(120.321_13)) * DEG_TO_RAD)
      this.rightWing.yRot = 0
      this.rightWing.zRot = f(f(cos(speed) * PI) * f(0.15))
      this.leftWing.xRot = this.rightWing.xRot
      this.leftWing.yRot = this.rightWing.yRot
      this.leftWing.zRot = -this.rightWing.zRot
      this.frontLeg.xRot = f(0.785_398_2)
      this.midLeg.xRot = f(0.785_398_2)
      this.backLeg.xRot = f(0.785_398_2)
    }
    if (!state.isAngry && !state.isOnGround) {
      const speed = cos(f(state.ageInTicks * f(0.18)))
      this.bobUpAndDown(speed, state.ageInTicks)
    }
    const rollAmount = state.rollAmount as number
    if (rollAmount > 0) this.bone.xRot = rotLerpRad(rollAmount, this.bone.xRot, f(3.091_592_8))
  }

  bobUpAndDown(speed: number, ageInTicks: number) {
    const { cos } = this.c
    this.bone.xRot = f(f(0.1) + f(f(speed * PI) * f(0.025)))
    this.bone.y = f(this.bone.y - f(cos(f(ageInTicks * f(0.18))) * f(0.9)))
    this.frontLeg.xRot = f(f(f(-speed * PI) * f(0.1)) + f(0.392_699_1))
    this.backLeg.xRot = f(f(f(-speed * PI) * f(0.05)) + f(0.785_398_2))
  }
}

export class AdultBeeModel extends BeeModel {
  leftAntenna = this.part('left_antenna')
  rightAntenna = this.part('right_antenna')

  override bobUpAndDown(speed: number, ageInTicks: number) {
    super.bobUpAndDown(speed, ageInTicks)
    this.leftAntenna.xRot = f(f(speed * PI) * f(0.03))
    this.rightAntenna.xRot = f(f(speed * PI) * f(0.03))
  }
}

/** Built on the layer's "root" child (the fixture's part /root), so this.model.root is the Java model's root. */
export class AllayModel extends AnimModel {
  root = this.model.root
  head = this.part('head')
  body = this.part('body')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    const ageInTicks = state.ageInTicks as number
    const flapSpeed = f(f(f(ageInTicks * 20) * DEG_TO_RAD) + animationPos)
    const flapAmount = f(f(f(cos(flapSpeed) * PI) * f(0.15)) + animationSpeed)
    const idleBobSpeed = f(f(ageInTicks * 9) * DEG_TO_RAD)
    const flyingFactor = Math.min(f(animationSpeed / f(0.3)), 1)
    const idleBobFactor = f(1 - flyingFactor)
    const holdingItemFactor = state.holdingAnimationProgress as number
    if (state.isDancing) {
      const danceSpeed = f(f(f(ageInTicks * 8) * DEG_TO_RAD) + animationSpeed)
      const danceFrequency = f(f(cos(danceSpeed) * 16) * DEG_TO_RAD)
      const spinningRotation = state.spinningProgress as number
      const headTiltZ = f(f(cos(danceSpeed) * 14) * DEG_TO_RAD)
      const headTiltY = f(f(cos(danceSpeed) * 30) * DEG_TO_RAD)
      this.root.yRot = state.isSpinning ? f(f(12.566_371) * spinningRotation) : this.root.yRot
      this.root.zRot = f(danceFrequency * f(1 - spinningRotation))
      this.head.yRot = f(headTiltY * f(1 - spinningRotation))
      this.head.zRot = f(headTiltZ * f(1 - spinningRotation))
    } else {
      this.head.xRot = f(state.xRot * DEG_TO_RAD)
      this.head.yRot = f(state.yRot * DEG_TO_RAD)
    }
    this.rightWing.xRot = f(f(0.436_332_32) * f(1 - flyingFactor))
    this.rightWing.yRot = f(f(-0.785_398_2) + flapAmount)
    this.leftWing.xRot = f(f(0.436_332_32) * f(1 - flyingFactor))
    this.leftWing.yRot = f(f(0.785_398_2) - flapAmount)
    this.body.xRot = f(flyingFactor * f(0.785_398_2))
    const armFlyingRotX = f(holdingItemFactor * lerp(flyingFactor, f(-1.047_197_6), f(-1.134_464)))
    // (float) java.lang.Math.cos: double precision, not the table
    this.root.y = f(this.root.y + f(f(f(Math.cos(idleBobSpeed)) * f(0.25)) * idleBobFactor))
    this.rightArm.xRot = armFlyingRotX
    this.leftArm.xRot = armFlyingRotX
    const armIdleBobFactor = f(idleBobFactor * f(1 - holdingItemFactor))
    const armIdleBobAmount = f(f(0.436_332_32) - f(f(f(cos(f(idleBobSpeed + f(4.712_389))) * PI) * f(0.075)) * armIdleBobFactor))
    this.leftArm.zRot = -armIdleBobAmount
    this.rightArm.zRot = armIdleBobAmount
    this.rightArm.yRot = f(f(0.279_252_68) * holdingItemFactor)
    this.leftArm.yRot = f(f(-0.279_252_68) * holdingItemFactor)
  }
}

/**
 * Built on the layer's "root" child (the fixture's part /root).
 * Extra state fields (ItemStack states, not in the fixture): `rightHandItem` / `leftHandItem`, truthy when the vex holds
 * something in that hand (ArmedEntityRenderState.rightHandItemState / leftHandItemState not empty); absent = empty hand.
 */
export class VexModel extends AnimModel {
  body = this.part('body')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')
  head = this.part('head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    const movingArmZBob = f(cos(f(f(state.ageInTicks * f(5.5)) * DEG_TO_RAD)) * f(0.1))
    this.rightArm.zRot = f(f(0.628_318_55) + movingArmZBob)
    this.leftArm.zRot = -f(f(0.628_318_55) + movingArmZBob)
    if (state.isCharging) {
      this.body.xRot = 0
      this.setArmsCharging(!!state.rightHandItem, !!state.leftHandItem, movingArmZBob)
    } else {
      this.body.xRot = f(0.157_079_64)
    }
    this.leftWing.yRot = f(f(1.099_557_4) + f(f(cos(f(f(state.ageInTicks * f(45.836_624)) * DEG_TO_RAD)) * DEG_TO_RAD) * f(16.2)))
    this.rightWing.yRot = -this.leftWing.yRot
    this.leftWing.xRot = f(0.471_238_88)
    this.leftWing.zRot = f(-0.471_238_88)
    this.rightWing.xRot = f(0.471_238_88)
    this.rightWing.zRot = f(0.471_238_88)
  }

  setArmsCharging(hasItemInRightHand: boolean, hasItemInLeftHand: boolean, movingArmZBob: number) {
    if (!hasItemInRightHand && !hasItemInLeftHand) {
      this.rightArm.xRot = f(-1.221_730_5)
      this.rightArm.yRot = f(0.261_799_4)
      this.rightArm.zRot = f(f(-0.471_238_88) - movingArmZBob)
      this.leftArm.xRot = f(-1.221_730_5)
      this.leftArm.yRot = f(-0.261_799_4)
      this.leftArm.zRot = f(f(0.471_238_88) + movingArmZBob)
    } else {
      if (hasItemInRightHand) {
        this.rightArm.xRot = f(3.665_191_4)
        this.rightArm.yRot = f(0.261_799_4)
        this.rightArm.zRot = f(f(-0.471_238_88) - movingArmZBob)
      }
      if (hasItemInLeftHand) {
        this.leftArm.xRot = f(3.665_191_4)
        this.leftArm.yRot = f(-0.261_799_4)
        this.leftArm.zRot = f(f(0.471_238_88) + movingArmZBob)
      }
    }
  }
}

export const SMALL_MODELS: Record<string, AnimModelClass> = {
  AdultWolfModel,
  BabyWolfModel,
  AdultCatModel: AdultFelineModel,
  BabyCatModel: BabyFelineModel,
  AdultOcelotModel: AdultFelineModel,
  BabyOcelotModel: BabyFelineModel,
  AdultFoxModel,
  BabyFoxModel,
  AdultRabbitModel,
  BabyRabbitModel,
  AdultChickenModel,
  BabyChickenModel: ChickenModel,
  ColdChickenModel: AdultChickenModel,
  ParrotModel,
  BatModel,
  AdultBeeModel,
  BabyBeeModel: BeeModel,
  AllayModel,
  VexModel
}
