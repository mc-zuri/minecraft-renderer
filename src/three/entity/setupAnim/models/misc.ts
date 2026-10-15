import { AnimModel, type AnimContext, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { applyAnimationState, applyWalkAnimation } from '../keyframes'
import { DEG_TO_RAD, HALF_PI, PI, clampedLerp, f, triangleWave } from '../mth'
import type { SinCos } from '../mth'
import { AnimationUtils, HumanoidModel } from './humanoid'

/**
 * Golems, villagers, illagers, witch, warden, breeze, creaking and the object models (armor stand, arrow, boats, minecarts,
 * end crystal, leash knot, wind charge, cushion), 26.3.
 */

export class IronGolemModel extends AnimModel {
  head = this.part('head')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const attackTick = state.attackTicksRemaining as number
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    if (attackTick > 0) {
      this.rightArm.xRot = f(-2 + f(1.5 * triangleWave(attackTick, 10)))
      this.leftArm.xRot = f(-2 + f(1.5 * triangleWave(attackTick, 10)))
    } else {
      const offerFlowerTick = state.offerFlowerTick as number
      if (offerFlowerTick > 0) {
        this.rightArm.xRot = f(f(-0.8) + f(f(0.025) * triangleWave(offerFlowerTick, 70)))
        this.leftArm.xRot = 0
      } else {
        this.rightArm.xRot = f(f(f(-0.2) + f(1.5 * triangleWave(animationPos, 13))) * animationSpeed)
        this.leftArm.xRot = f(f(f(-0.2) - f(1.5 * triangleWave(animationPos, 13))) * animationSpeed)
      }
    }
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.rightLeg.xRot = f(f(-1.5 * triangleWave(animationPos, 13)) * animationSpeed)
    this.leftLeg.xRot = f(f(1.5 * triangleWave(animationPos, 13)) * animationSpeed)
    this.rightLeg.yRot = 0
    this.leftLeg.yRot = 0
  }
}

export class SnowGolemModel extends AnimModel {
  head = this.part('head')
  leftArm = this.part('left_arm')
  rightArm = this.part('right_arm')
  upperBody = this.part('upper_body')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin: msin, cos: mcos } = this.c
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.upperBody.yRot = f(f(state.yRot * DEG_TO_RAD) * 0.25)
    const sin = msin(this.upperBody.yRot)
    const cos = mcos(this.upperBody.yRot)
    this.leftArm.yRot = this.upperBody.yRot
    this.rightArm.yRot = f(this.upperBody.yRot + PI)
    this.leftArm.x = f(cos * 5)
    this.leftArm.z = f(-sin * 5)
    this.rightArm.x = f(-cos * 5)
    this.rightArm.z = f(sin * 5)
  }
}

/**
 * CopperGolemModel. Its held items (rightHandItemState / leftHandItemState, not in the render state the export samples):
 * `state.rightHandItem` / `state.leftHandItem`, truthy while that hand holds something (absent = empty hands).
 */
export class CopperGolemModel extends AnimModel {
  body = this.part('body')
  head = this.part('head')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { model, c } = this
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    if (!state.rightHandItem && !state.leftHandItem) {
      applyWalkAnimation(model, c, 'CopperGolemAnimation.COPPER_GOLEM_WALK', state.walkAnimationPos, state.walkAnimationSpeed, 2, 2.5)
    } else {
      applyWalkAnimation(model, c, 'CopperGolemAnimation.COPPER_GOLEM_WALK_ITEM', state.walkAnimationPos, state.walkAnimationSpeed, 2, 2.5)
      this.poseHeldItemArmsIfStill()
    }
    applyAnimationState(model, c, 'CopperGolemAnimation.COPPER_GOLEM_IDLE', state.idleAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'CopperGolemAnimation.COPPER_GOLEM_CHEST_INTERACTION_NOITEM_GET', state.interactionGetItem, state.ageInTicks)
    applyAnimationState(model, c, 'CopperGolemAnimation.COPPER_GOLEM_CHEST_INTERACTION_NOITEM_NOGET', state.interactionGetNoItem, state.ageInTicks)
    applyAnimationState(model, c, 'CopperGolemAnimation.COPPER_GOLEM_CHEST_INTERACTION_ITEM_DROP', state.interactionDropItem, state.ageInTicks)
    applyAnimationState(model, c, 'CopperGolemAnimation.COPPER_GOLEM_CHEST_INTERACTION_ITEM_NODROP', state.interactionDropNoItem, state.ageInTicks)
  }

  poseHeldItemArmsIfStill() {
    this.rightArm.xRot = Math.min(this.rightArm.xRot, f(-0.872_664_63))
    this.leftArm.xRot = Math.min(this.leftArm.xRot, f(-0.872_664_63))
    this.rightArm.yRot = Math.min(this.rightArm.yRot, f(-0.113_446_4))
    this.leftArm.yRot = Math.max(this.leftArm.yRot, f(0.113_446_4))
    this.rightArm.zRot = Math.min(this.rightArm.zRot, f(-0.064_577_185))
    this.leftArm.zRot = Math.max(this.leftArm.zRot, f(0.064_577_185))
  }
}

/** VillagerModel (BabyVillagerModel only differs in its mesh). */
export class VillagerModel extends AnimModel {
  head = this.part('head')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')
  arms = this.part('arms')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    if (state.isUnhappy) {
      this.head.zRot = f(f(0.3) * sin(f(f(0.45) * state.ageInTicks)))
      this.head.xRot = f(0.4)
    } else {
      this.head.zRot = 0
    }
    this.rightLeg.xRot = f(f(f(cos(f(state.walkAnimationPos * f(0.6662))) * f(1.4)) * state.walkAnimationSpeed) * 0.5)
    this.leftLeg.xRot = f(f(f(cos(f(f(state.walkAnimationPos * f(0.6662)) + PI)) * f(1.4)) * state.walkAnimationSpeed) * 0.5)
    this.rightLeg.yRot = 0
    this.leftLeg.yRot = 0
  }
}

/**
 * IllagerModel (evoker, illusioner, pillager, vindicator). Its main hand item (getMainHandItemState / the stack, not in
 * the sampled render state): `state.mainHandItem`, truthy while the main hand holds something (absent = empty).
 */
export class IllagerModel extends AnimModel {
  head = this.part('head')
  hat = this.part('hat')
  arms = this.part('arms')
  leftLeg = this.part('left_leg')
  rightLeg = this.part('right_leg')
  leftArm = this.part('left_arm')
  rightArm = this.part('right_arm')

  constructor(model: AnimModel['model'], c: AnimContext) {
    super(model, c)
    this.hat.visible = false
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    if (state.isRiding) {
      this.rightArm.xRot = f(-0.628_318_55)
      this.rightArm.yRot = 0
      this.rightArm.zRot = 0
      this.leftArm.xRot = f(-0.628_318_55)
      this.leftArm.yRot = 0
      this.leftArm.zRot = 0
      this.rightLeg.xRot = f(-1.413_716_7)
      this.rightLeg.yRot = f(0.314_159_27)
      this.rightLeg.zRot = f(0.078_539_82)
      this.leftLeg.xRot = f(-1.413_716_7)
      this.leftLeg.yRot = f(-0.314_159_27)
      this.leftLeg.zRot = f(-0.078_539_82)
    } else {
      const animationSpeed = state.walkAnimationSpeed as number
      const animationPos = state.walkAnimationPos as number
      this.rightArm.xRot = f(f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * 2) * animationSpeed) * 0.5)
      this.rightArm.yRot = 0
      this.rightArm.zRot = 0
      this.leftArm.xRot = f(f(f(cos(f(animationPos * f(0.6662))) * 2) * animationSpeed) * 0.5)
      this.leftArm.yRot = 0
      this.leftArm.zRot = 0
      this.rightLeg.xRot = f(f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed) * 0.5)
      this.rightLeg.yRot = 0
      this.rightLeg.zRot = 0
      this.leftLeg.xRot = f(f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed) * 0.5)
      this.leftLeg.yRot = 0
      this.leftLeg.zRot = 0
    }
    const pose = state.armPose as string
    if (pose === 'ATTACKING') {
      if (!state.mainHandItem) {
        AnimationUtils.animateZombieArms(this, this.leftArm, this.rightArm, true, state)
        AnimationUtils.bobArms(this, this.rightArm, this.leftArm, state.ageInTicks)
      } else {
        AnimationUtils.swingWeaponDown(this, this.rightArm, this.leftArm, state.mainArm, state.swingAnimation, state.ageInTicks)
      }
    } else if (pose === 'SPELLCASTING') {
      this.rightArm.z = 0
      this.rightArm.x = -5
      this.leftArm.z = 0
      this.leftArm.x = 5
      this.rightArm.xRot = f(cos(f(state.ageInTicks * f(0.6662))) * 0.25)
      this.leftArm.xRot = f(cos(f(state.ageInTicks * f(0.6662))) * 0.25)
      this.rightArm.zRot = f(2.356_194_5)
      this.leftArm.zRot = f(-2.356_194_5)
      this.rightArm.yRot = 0
      this.leftArm.yRot = 0
    } else if (pose === 'BOW_AND_ARROW') {
      this.rightArm.yRot = f(f(-0.1) + this.head.yRot)
      this.rightArm.xRot = f(-HALF_PI + this.head.xRot)
      this.leftArm.xRot = f(f(-0.942_477_9) + this.head.xRot)
      this.leftArm.yRot = f(this.head.yRot - f(0.4))
      this.leftArm.zRot = HALF_PI
    } else if (pose === 'CROSSBOW_HOLD') {
      AnimationUtils.animateCrossbowHold(this.rightArm, this.leftArm, this.head, true)
    } else if (pose === 'CROSSBOW_CHARGE') {
      AnimationUtils.animateCrossbowCharge(this.rightArm, this.leftArm, state.maxCrossbowChargeDuration, state.ticksUsingItem, true)
    } else if (pose === 'CELEBRATING') {
      this.rightArm.z = 0
      this.rightArm.x = -5
      this.rightArm.xRot = f(cos(f(state.ageInTicks * f(0.6662))) * f(0.05))
      this.rightArm.zRot = f(2.670_354)
      this.rightArm.yRot = 0
      this.leftArm.z = 0
      this.leftArm.x = 5
      this.leftArm.xRot = f(cos(f(state.ageInTicks * f(0.6662))) * f(0.05))
      this.leftArm.zRot = f(-2.356_194_5)
      this.leftArm.yRot = 0
    }
    const crossedArms = pose === 'CROSSED'
    this.arms.visible = crossedArms
    this.leftArm.visible = !crossedArms
    this.rightArm.visible = !crossedArms
  }
}

export class WitchModel extends AnimModel {
  head = this.part('head')
  nose = this.part('nose')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')
  arms = this.part('arms')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.rightLeg.xRot = f(f(f(cos(f(state.walkAnimationPos * f(0.6662))) * f(1.4)) * state.walkAnimationSpeed) * 0.5)
    this.leftLeg.xRot = f(f(f(cos(f(f(state.walkAnimationPos * f(0.6662)) + PI)) * f(1.4)) * state.walkAnimationSpeed) * 0.5)
    const speed = f(f(0.01) * (Math.trunc(state.entityId) % 10))
    this.nose.xRot = f(f(sin(f(state.ageInTicks * speed)) * f(4.5)) * DEG_TO_RAD)
    this.nose.zRot = f(f(cos(f(state.ageInTicks * speed)) * f(2.5)) * DEG_TO_RAD)
    if (state.isHoldingItem) {
      this.nose.setPos(0, 1, -1.5)
      this.nose.xRot = f(-0.9)
    }
  }
}

export class WardenModel extends AnimModel {
  bone = this.part('bone')
  body = this.part('body')
  head = this.part('head')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightTendril = this.part('right_tendril')
  leftTendril = this.part('left_tendril')
  rightRibcage = this.part('right_ribcage')
  leftRibcage = this.part('left_ribcage')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { model, c } = this
    this.animateHeadLookTarget(state.yRot, state.xRot)
    this.animateWalk(state.walkAnimationPos, state.walkAnimationSpeed)
    this.animateIdlePose(state.ageInTicks)
    this.animateTendrils(state, state.ageInTicks)
    applyAnimationState(model, c, 'WardenAnimation.WARDEN_ATTACK', state.attackAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'WardenAnimation.WARDEN_SONIC_BOOM', state.sonicBoomAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'WardenAnimation.WARDEN_DIG', state.diggingAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'WardenAnimation.WARDEN_EMERGE', state.emergeAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'WardenAnimation.WARDEN_ROAR', state.roarAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'WardenAnimation.WARDEN_SNIFF', state.sniffAnimationState, state.ageInTicks)
  }

  animateHeadLookTarget(yRot: number, xRot: number) {
    this.head.xRot = f(xRot * DEG_TO_RAD)
    this.head.yRot = f(yRot * DEG_TO_RAD)
  }

  animateIdlePose(ageInTicks: number) {
    const { sin, cos } = this.c
    const scaledAge = f(ageInTicks * f(0.1))
    const wobbleCosine = cos(scaledAge)
    const wobbleSine = sin(scaledAge)
    this.head.zRot = f(this.head.zRot + f(f(0.06) * wobbleCosine))
    this.head.xRot = f(this.head.xRot + f(f(0.06) * wobbleSine))
    this.body.zRot = f(this.body.zRot + f(f(0.025) * wobbleSine))
    this.body.xRot = f(this.body.xRot + f(f(0.025) * wobbleCosine))
  }

  animateWalk(animationPos: number, animationSpeed: number) {
    const { sin, cos } = this.c
    const speedModifier = Math.min(0.5, f(3 * animationSpeed))
    const adjustedPos = f(animationPos * f(0.8662))
    const adjustedPosCosine = cos(adjustedPos)
    const adjustedPosSine = sin(adjustedPos)
    const speedModifierWithMin = Math.min(f(0.35), speedModifier)
    this.head.zRot = f(this.head.zRot + f(f(f(0.3) * adjustedPosSine) * speedModifier))
    this.head.xRot = f(this.head.xRot + f(f(f(1.2) * cos(f(adjustedPos + HALF_PI))) * speedModifierWithMin))
    this.body.zRot = f(f(f(0.1) * adjustedPosSine) * speedModifier)
    this.body.xRot = f(f(1 * adjustedPosCosine) * speedModifierWithMin)
    this.leftLeg.xRot = f(f(1 * adjustedPosCosine) * speedModifier)
    this.rightLeg.xRot = f(f(1 * cos(f(adjustedPos + PI))) * speedModifier)
    this.leftArm.xRot = -f(f(f(0.8) * adjustedPosCosine) * speedModifier)
    this.leftArm.zRot = 0
    this.rightArm.xRot = -f(f(f(0.8) * adjustedPosSine) * speedModifier)
    this.rightArm.zRot = 0
    this.resetArmPoses()
  }

  resetArmPoses() {
    this.leftArm.yRot = 0
    this.leftArm.z = 1
    this.leftArm.x = 13
    this.leftArm.y = -13
    this.rightArm.yRot = 0
    this.rightArm.z = 1
    this.rightArm.x = -13
    this.rightArm.y = -13
  }

  animateTendrils(state: AnimState, ageInTicks: number) {
    // (float) (Math.cos(ageInTicks * 2.25) * Math.PI * 0.1F): double math
    const tendrilXRot = f(state.tendrilAnimation * f(Math.cos(ageInTicks * 2.25) * Math.PI * 0.100_000_001_490_116_12))
    this.leftTendril.xRot = tendrilXRot
    this.rightTendril.xRot = -tendrilXRot
  }
}

export class BreezeModel extends AnimModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { model, c } = this
    applyAnimationState(model, c, 'BreezeAnimation.IDLE', state.idle, state.ageInTicks)
    applyAnimationState(model, c, 'BreezeAnimation.SHOOT', state.shoot, state.ageInTicks)
    applyAnimationState(model, c, 'BreezeAnimation.SLIDE', state.slide, state.ageInTicks)
    applyAnimationState(model, c, 'BreezeAnimation.SLIDE_BACK', state.slideBack, state.ageInTicks)
    applyAnimationState(model, c, 'BreezeAnimation.INHALE', state.inhale, state.ageInTicks)
    applyAnimationState(model, c, 'BreezeAnimation.JUMP', state.longJump, state.ageInTicks)
  }
}

export class CreakingModel extends AnimModel {
  /** the model's "root" child, the part the animations are baked on */
  root = this.part('/root')
  head = this.part('head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { model, c, root } = this
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    if (state.canMove) applyWalkAnimation(model, c, 'CreakingAnimation.CREAKING_WALK', state.walkAnimationPos, state.walkAnimationSpeed, 1, 1, root)
    applyAnimationState(model, c, 'CreakingAnimation.CREAKING_ATTACK', state.attackAnimationState, state.ageInTicks, 1, root)
    applyAnimationState(model, c, 'CreakingAnimation.CREAKING_INVULNERABLE', state.invulnerabilityAnimationState, state.ageInTicks, 1, root)
    applyAnimationState(model, c, 'CreakingAnimation.CREAKING_DEATH', state.deathAnimationState, state.ageInTicks, 1, root)
  }
}

type Rotations = { x: number; y: number; z: number }

/**
 * ArmorStandArmorModel: a HumanoidModel posed by the stand's rotations. ArmorStandRenderState's headPose, bodyPose,
 * leftArmPose, rightArmPose, leftLegPose, rightLegPose are Rotations ({x, y, z} in degrees); its leftArmPose /
 * rightArmPose hide HumanoidRenderState's arm pose enums, which stay EMPTY for an armor stand (its renderer is not a
 * humanoid mob renderer), so the humanoid part of setupAnim sees EMPTY.
 */
export class ArmorStandArmorModel extends HumanoidModel {
  override setupAnim(state: AnimState) {
    super.setupAnim({ ...state, rightArmPose: 'EMPTY', leftArmPose: 'EMPTY' })
    const headPose = state.headPose as Rotations
    const bodyPose = state.bodyPose as Rotations
    const leftArmPose = state.leftArmPose as Rotations
    const rightArmPose = state.rightArmPose as Rotations
    const leftLegPose = state.leftLegPose as Rotations
    const rightLegPose = state.rightLegPose as Rotations
    this.head.xRot = f(DEG_TO_RAD * headPose.x)
    this.head.yRot = f(DEG_TO_RAD * headPose.y)
    this.head.zRot = f(DEG_TO_RAD * headPose.z)
    this.body.xRot = f(DEG_TO_RAD * bodyPose.x)
    this.body.yRot = f(DEG_TO_RAD * bodyPose.y)
    this.body.zRot = f(DEG_TO_RAD * bodyPose.z)
    this.leftArm.xRot = f(DEG_TO_RAD * leftArmPose.x)
    this.leftArm.yRot = f(DEG_TO_RAD * leftArmPose.y)
    this.leftArm.zRot = f(DEG_TO_RAD * leftArmPose.z)
    this.rightArm.xRot = f(DEG_TO_RAD * rightArmPose.x)
    this.rightArm.yRot = f(DEG_TO_RAD * rightArmPose.y)
    this.rightArm.zRot = f(DEG_TO_RAD * rightArmPose.z)
    this.leftLeg.xRot = f(DEG_TO_RAD * leftLegPose.x)
    this.leftLeg.yRot = f(DEG_TO_RAD * leftLegPose.y)
    this.leftLeg.zRot = f(DEG_TO_RAD * leftLegPose.z)
    this.rightLeg.xRot = f(DEG_TO_RAD * rightLegPose.x)
    this.rightLeg.yRot = f(DEG_TO_RAD * rightLegPose.y)
    this.rightLeg.zRot = f(DEG_TO_RAD * rightLegPose.z)
  }
}

export class ArmorStandModel extends ArmorStandArmorModel {
  rightBodyStick = this.part('right_body_stick')
  leftBodyStick = this.part('left_body_stick')
  shoulderStick = this.part('shoulder_stick')
  basePlate = this.part('base_plate')

  constructor(model: AnimModel['model'], c: AnimContext) {
    super(model, c)
    if (this.hat) this.hat.visible = false
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const bodyPose = state.bodyPose as Rotations
    this.basePlate.yRot = f(DEG_TO_RAD * -state.yRot)
    this.leftArm.visible = !!state.showArms
    this.rightArm.visible = !!state.showArms
    this.basePlate.visible = !!state.showBasePlate
    this.rightBodyStick.xRot = f(DEG_TO_RAD * bodyPose.x)
    this.rightBodyStick.yRot = f(DEG_TO_RAD * bodyPose.y)
    this.rightBodyStick.zRot = f(DEG_TO_RAD * bodyPose.z)
    this.leftBodyStick.xRot = f(DEG_TO_RAD * bodyPose.x)
    this.leftBodyStick.yRot = f(DEG_TO_RAD * bodyPose.y)
    this.leftBodyStick.zRot = f(DEG_TO_RAD * bodyPose.z)
    this.shoulderStick.xRot = f(DEG_TO_RAD * bodyPose.x)
    this.shoulderStick.yRot = f(DEG_TO_RAD * bodyPose.y)
    this.shoulderStick.zRot = f(DEG_TO_RAD * bodyPose.z)
  }
}

export class ArrowModel extends AnimModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const shake = state.shake as number
    if (shake > 0) {
      const pow = f(-this.c.sin(f(shake * 3)) * shake)
      const root = this.model.root
      root.zRot = f(root.zRot + f(pow * DEG_TO_RAD))
    }
  }
}

/** AbstractBoatModel.animatePaddle: a paddle's rotation at its rowing time (side 0 left, 1 right). */
export function animatePaddle({ sin }: SinCos, time: number, side: number, paddle: PartPose) {
  paddle.xRot = clampedLerp(f(f(sin(-time) + 1) / 2), f(-1.047_197_6), f(-0.261_799_4))
  paddle.yRot = clampedLerp(f(f(sin(f(-time + 1)) + 1) / 2), f(-0.785_398_2), f(0.785_398_2))
  if (side === 1) paddle.yRot = f(PI - paddle.yRot)
}

/** AbstractBoatModel (BoatModel, RaftModel): the paddles row. */
export class AbstractBoatModel extends AnimModel {
  leftPaddle = this.part('left_paddle')
  rightPaddle = this.part('right_paddle')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    animatePaddle(this.c, state.rowingTimeLeft, 0, this.leftPaddle)
    animatePaddle(this.c, state.rowingTimeRight, 1, this.rightPaddle)
  }
}

export class BoatModel extends AbstractBoatModel {}

export class RaftModel extends AbstractBoatModel {}

// JOML (1.10, no fast math, no Math.fma) in floats, as ModelPart.rotateBy computes
const jsin = (x: number) => f(Math.sin(x))
const jsqrt = (x: number) => f(Math.sqrt(x))
const jatan2 = (y: number, x: number) => f(Math.atan2(y, x))
const jfma = (a: number, b: number, c: number) => f(f(a * b) + c)
const PI_F = f(Math.PI)
const PI2_F = f(Math.PI * 2)
const PI_HALF_F = f(Math.PI * 0.5)
const cosFromSin = (sin: number, angle: number) => {
  const cos = jsqrt(f(1 - f(sin * sin)))
  const a = f(angle + PI_HALF_F)
  let b = f(a - f(Math.trunc(f(a / PI2_F)) * PI2_F))
  if (b < 0) b = f(PI2_F + b)
  return b >= PI_F ? -cos : cos
}

type Quat = { x: number; y: number; z: number; w: number }

/** Quaternionf.rotationY */
const quatRotationY = (angle: number): Quat => {
  const sin = jsin(f(angle * 0.5))
  const cos = cosFromSin(sin, f(angle * 0.5))
  return { x: 0, y: sin, z: 0, w: cos }
}

/** Quaternionf.setAngleAxis (the axis taken as given, not normalized) */
const quatAngleAxis = (angle: number, x: number, y: number, z: number): Quat => {
  const s = jsin(f(angle * 0.5))
  return { x: f(x * s), y: f(y * s), z: f(z * s), w: cosFromSin(s, f(angle * 0.5)) }
}

/** Quaternionf.rotateY */
const quatRotateY = (q: Quat, angle: number): Quat => {
  const sin = jsin(f(angle * 0.5))
  const cos = cosFromSin(sin, f(angle * 0.5))
  return {
    x: f(f(q.x * cos) - f(q.z * sin)),
    y: f(f(q.w * sin) + f(q.y * cos)),
    z: f(f(q.x * sin) + f(q.z * cos)),
    w: f(f(q.w * cos) - f(q.y * sin))
  }
}

/** Quaternionf.rotateAxis */
const quatRotateAxis = (q: Quat, angle: number, axisX: number, axisY: number, axisZ: number): Quat => {
  const hangle = f(angle / 2)
  const sinAngle = jsin(hangle)
  const invVLength = f(1 / jsqrt(jfma(axisX, axisX, jfma(axisY, axisY, f(axisZ * axisZ)))))
  const rx = f(f(axisX * invVLength) * sinAngle)
  const ry = f(f(axisY * invVLength) * sinAngle)
  const rz = f(f(axisZ * invVLength) * sinAngle)
  const rw = cosFromSin(sinAngle, hangle)
  return {
    x: jfma(q.w, rx, jfma(q.x, rw, jfma(q.y, rz, f(-q.z * ry)))),
    y: jfma(q.w, ry, jfma(-q.x, rz, jfma(q.y, rw, f(q.z * rx)))),
    z: jfma(q.w, rz, jfma(q.x, ry, jfma(-q.y, rx, f(q.z * rw)))),
    w: jfma(q.w, rw, jfma(-q.x, rx, jfma(-q.y, ry, f(-q.z * rz))))
  }
}

/** ModelPart.rotateBy: Matrix3f.rotationZYX(zRot, yRot, xRot).rotate(rotation).getEulerAnglesZYX -> setRotation. */
const rotateBy = (part: PartPose, q: Quat) => {
  // Matrix3f.rotationZYX
  const sinX = jsin(part.xRot)
  const cosX = cosFromSin(sinX, part.xRot)
  const sinY = jsin(part.yRot)
  const cosY = cosFromSin(sinY, part.yRot)
  const sinZ = jsin(part.zRot)
  const cosZ = cosFromSin(sinZ, part.zRot)
  const mSinZ = -sinZ
  const mSinY = -sinY
  const mSinX = -sinX
  const nm00 = cosZ
  const nm01 = sinZ
  const nm10 = mSinZ
  const nm11 = cosZ
  const nm20 = f(nm00 * sinY)
  const nm21 = f(nm01 * sinY)
  const nm22 = cosY
  const m00 = f(nm00 * cosY)
  const m01 = f(nm01 * cosY)
  const m02 = mSinY
  const m10 = f(f(nm10 * cosX) + f(nm20 * sinX))
  const m11 = f(f(nm11 * cosX) + f(nm21 * sinX))
  const m12 = f(nm22 * sinX)
  const m20 = f(f(nm10 * mSinX) + f(nm20 * cosX))
  const m21 = f(f(nm11 * mSinX) + f(nm21 * cosX))
  const m22 = f(nm22 * cosX)
  // Matrix3f.rotate(Quaternionfc)
  const w2 = f(q.w * q.w)
  const x2 = f(q.x * q.x)
  const y2 = f(q.y * q.y)
  const z2 = f(q.z * q.z)
  const zw = f(q.z * q.w)
  const dzw = f(zw + zw)
  const xy = f(q.x * q.y)
  const dxy = f(xy + xy)
  const xz = f(q.x * q.z)
  const dxz = f(xz + xz)
  const yw = f(q.y * q.w)
  const dyw = f(yw + yw)
  const yz = f(q.y * q.z)
  const dyz = f(yz + yz)
  const xw = f(q.x * q.w)
  const dxw = f(xw + xw)
  const rm00 = f(f(f(w2 + x2) - z2) - y2)
  const rm01 = f(dxy + dzw)
  const rm02 = f(dxz - dyw)
  const rm10 = f(dxy - dzw)
  const rm11 = f(f(f(y2 - z2) + w2) - x2)
  const rm12 = f(dyz + dxw)
  const rm20 = f(dyw + dxz)
  const rm21 = f(dyz - dxw)
  const rm22 = f(f(f(z2 - y2) - x2) + w2)
  const r00 = f(f(f(m00 * rm00) + f(m10 * rm01)) + f(m20 * rm02))
  const r01 = f(f(f(m01 * rm00) + f(m11 * rm01)) + f(m21 * rm02))
  const r02 = f(f(f(m02 * rm00) + f(m12 * rm01)) + f(m22 * rm02))
  const r12 = f(f(f(m02 * rm10) + f(m12 * rm11)) + f(m22 * rm12))
  const r22 = f(f(f(m02 * rm20) + f(m12 * rm21)) + f(m22 * rm22))
  // Matrix3f.getEulerAnglesZYX
  part.setRotation(jatan2(r12, r22), jatan2(-r02, jsqrt(f(1 - f(r02 * r02)))), jatan2(r01, r00))
}

const SIN_45 = f(Math.sin(0.785_398_163_397_448_3))

export class EndCrystalModel extends AnimModel {
  base = this.part('base')
  outerGlass = this.part('outer_glass')
  innerGlass = this.part('inner_glass')
  cube = this.part('cube')

  /** EndCrystalRenderer.getY */
  static getY(c: SinCos, timeInTicks: number) {
    let hh = f(f(c.sin(f(timeInTicks * f(0.2))) / 2) + 0.5)
    hh = f(f(f(hh * hh) + hh) * f(0.4))
    return f(hh - f(1.4))
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.base.visible = !!state.showsBottom
    const animationSpeed = f(state.ageInTicks * 3)
    const crystalY = f(EndCrystalModel.getY(this.c, state.ageInTicks) * 16)
    this.outerGlass.y = f(this.outerGlass.y + f(crystalY / 2))
    const tilt = f(1.047_197_6)
    rotateBy(this.outerGlass, quatRotateAxis(quatRotationY(f(animationSpeed * DEG_TO_RAD)), tilt, SIN_45, 0, SIN_45))
    rotateBy(this.innerGlass, quatRotateY(quatAngleAxis(tilt, SIN_45, 0, SIN_45), f(animationSpeed * DEG_TO_RAD)))
    rotateBy(this.cube, quatRotateY(quatAngleAxis(tilt, SIN_45, 0, SIN_45), f(animationSpeed * DEG_TO_RAD)))
  }
}

export class WindChargeModel extends AnimModel {
  bone = this.part('bone')
  wind = this.part('wind')
  windCharge = this.part('wind_charge')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.windCharge.yRot = f(f(-state.ageInTicks * 16) * DEG_TO_RAD)
    this.wind.yRot = f(f(state.ageInTicks * 16) * DEG_TO_RAD)
  }
}

export const MISC_MODELS: Record<string, AnimModelClass> = {
  IronGolemModel,
  SnowGolemModel,
  CopperGolemModel,
  VillagerModel,
  BabyVillagerModel: VillagerModel,
  IllagerModel,
  WitchModel,
  WardenModel,
  BreezeModel,
  CreakingModel,
  ArmorStandModel,
  ArrowModel,
  BoatModel,
  RaftModel,
  MinecartModel: AnimModel,
  EndCrystalModel,
  LeashKnotModel: AnimModel,
  WindChargeModel,
  CushionModel: AnimModel
}
