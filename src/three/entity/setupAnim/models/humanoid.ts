import { AnimModel, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, clamp, f, inverseLerp, lerp, rotLerpRad } from '../mth'

/**
 * HumanoidModel and the models built on it (zombies, skeletons, piglins, players...), 26.3.
 */

/** The arm a hand is with this main arm (InteractionHand.asArm). */
export const handArm = (hand: string | undefined, mainArm: string) => (hand === 'OFF_HAND' ? (mainArm === 'RIGHT' ? 'LEFT' : 'RIGHT') : mainArm)

const TWO_HANDED = new Set(['BOW_AND_ARROW', 'CROSSBOW_CHARGE', 'CROSSBOW_HOLD'])
const AFFECTS_OFFHAND = new Set(['BOW_AND_ARROW', 'THROW_TRIDENT', 'CROSSBOW_CHARGE', 'CROSSBOW_HOLD'])

/** AnimationUtils */
export class AnimationUtils {
  static animateCrossbowHold(rightArm: PartPose, leftArm: PartPose, head: PartPose, holdingInRightArm: boolean) {
    const holdingArm = holdingInRightArm ? rightArm : leftArm
    const shootingArm = holdingInRightArm ? leftArm : rightArm
    holdingArm.yRot = f((holdingInRightArm ? f(-0.3) : f(0.3)) + head.yRot)
    shootingArm.yRot = f((holdingInRightArm ? f(0.6) : f(-0.6)) + head.yRot)
    holdingArm.xRot = f(f(-HALF_PI + head.xRot) + f(0.1))
    shootingArm.xRot = f(-1.5 + head.xRot)
  }

  static animateCrossbowCharge(rightArm: PartPose, leftArm: PartPose, maxCrossbowChargeDuration: number, ticksUsingItem: number, holdingInRightArm: boolean) {
    const holdingArm = holdingInRightArm ? rightArm : leftArm
    const pullingArm = holdingInRightArm ? leftArm : rightArm
    holdingArm.yRot = holdingInRightArm ? f(-0.8) : f(0.8)
    holdingArm.xRot = f(-0.970_796_35)
    pullingArm.xRot = holdingArm.xRot
    const useTicks = clamp(ticksUsingItem, 0, maxCrossbowChargeDuration)
    const lerpAlpha = f(useTicks / maxCrossbowChargeDuration)
    pullingArm.yRot = f(lerp(lerpAlpha, f(0.4), f(0.85)) * (holdingInRightArm ? 1 : -1))
    pullingArm.xRot = lerp(lerpAlpha, pullingArm.xRot, -HALF_PI)
  }

  static swingWeaponDown(m: AnimModel, rightArm: PartPose, leftArm: PartPose, mainArm: string, attackTime: number, ageInTicks: number) {
    const { sin, cos } = m.c
    const attack2 = sin(f(attackTime * PI))
    const attack = sin(f(f(1 - f(f(1 - attackTime) * f(1 - attackTime))) * PI))
    rightArm.zRot = 0
    leftArm.zRot = 0
    rightArm.yRot = f(0.157_079_64)
    leftArm.yRot = f(-0.157_079_64)
    if (mainArm === 'RIGHT') {
      rightArm.xRot = f(f(-1.884_955_8) + f(cos(f(ageInTicks * f(0.09))) * f(0.15)))
      leftArm.xRot = f(0 + f(cos(f(ageInTicks * f(0.19))) * 0.5))
      rightArm.xRot = f(rightArm.xRot + f(f(attack2 * f(2.2)) - f(attack * f(0.4))))
      leftArm.xRot = f(leftArm.xRot + f(f(attack2 * f(1.2)) - f(attack * f(0.4))))
    } else {
      rightArm.xRot = f(0 + f(cos(f(ageInTicks * f(0.19))) * 0.5))
      leftArm.xRot = f(f(-1.884_955_8) + f(cos(f(ageInTicks * f(0.09))) * f(0.15)))
      rightArm.xRot = f(rightArm.xRot + f(f(attack2 * f(1.2)) - f(attack * f(0.4))))
      leftArm.xRot = f(leftArm.xRot + f(f(attack2 * f(2.2)) - f(attack * f(0.4))))
    }
    AnimationUtils.bobArms(m, rightArm, leftArm, ageInTicks)
  }

  static bobModelPart(m: AnimModel, part: PartPose, ageInTicks: number, scale: number) {
    const { sin, cos } = m.c
    part.zRot = f(part.zRot + f(scale * f(f(cos(f(ageInTicks * f(0.09))) * f(0.05)) + f(0.05))))
    part.xRot = f(part.xRot + f(f(scale * sin(f(ageInTicks * f(0.067)))) * f(0.05)))
  }

  static bobArms(m: AnimModel, rightArm: PartPose, leftArm: PartPose, ageInTicks: number) {
    AnimationUtils.bobModelPart(m, rightArm, ageInTicks, 1)
    AnimationUtils.bobModelPart(m, leftArm, ageInTicks, -1)
  }

  static animateZombieArms(m: AnimModel, leftArm: PartPose, rightArm: PartPose, aggressive: boolean, state: AnimState) {
    const { sin } = m.c
    const usingSpear = state.rightArmPose === 'SPEAR' || state.leftArmPose === 'SPEAR'
    if (usingSpear) return
    // a baby holding something keeps its arms down
    const raiseArms = !state.isBaby || !state.mainHandItem
    const armDrop = raiseArms ? f(-PI / (aggressive ? 1.5 : f(2.25))) : 0
    const swing = state.swingAnimation as number
    const attackYRotModifier = f((raiseArms ? 1 : -1) * sin(f(swing * PI)))
    const attackXRotModifier = sin(f(f(1 - f(f(1 - swing) * f(1 - swing))) * PI))
    const xRot = f(f(armDrop + f(attackYRotModifier * f(1.2))) - f(attackXRotModifier * f(0.4)))
    const yRot = f(f(0.1) - f(attackYRotModifier * f(0.6)))
    if (state.rightArmPose !== 'THROW_TRIDENT') {
      rightArm.xRot = xRot
      rightArm.yRot = raiseArms ? -yRot : yRot
      rightArm.zRot = 0
    }
    if (state.leftArmPose !== 'THROW_TRIDENT') {
      leftArm.xRot = xRot
      leftArm.yRot = raiseArms ? yRot : -yRot
      leftArm.zRot = 0
    }
  }

  /**
   * animateZombieArms before 26.3 (called after the whole humanoid setupAnim, from the attack time): 1.21.11 skips the
   * attack pose for a stab, 26.1 leaves a baby holding something alone, 26.2 keeps its arms down instead.
   */
  static animateZombieArmsLegacy(m: AnimModel, leftArm: PartPose, rightArm: PartPose, aggressive: boolean, state: AnimState) {
    const { c } = m
    const { sin } = c
    const babyHolding = !!state.isBaby && !!state.mainHandItem
    if (c.atLeast('26.1') && !c.atLeast('26.2') && babyHolding) return
    if (!c.atLeast('1.21.11') || (state.swingAnimationType ?? 'WHACK') !== 'STAB') {
      const attackTime = state.attackTime as number
      if (c.atLeast('26.2')) {
        // animateAttackArms
        const raiseArms = !babyHolding
        const armDrop = raiseArms ? f(-PI / (aggressive ? 1.5 : f(2.25))) : 0
        const attackYRotModifier = f((raiseArms ? 1 : -1) * sin(f(attackTime * PI)))
        const attackXRotModifier = sin(f(f(1 - f(f(1 - attackTime) * f(1 - attackTime))) * PI))
        const xRot = f(f(armDrop + f(attackYRotModifier * f(1.2))) - f(attackXRotModifier * f(0.4)))
        const yRot = f(f(0.1) - f(attackYRotModifier * f(0.6)))
        rightArm.xRot = xRot
        rightArm.yRot = raiseArms ? -yRot : yRot
        rightArm.zRot = 0
        leftArm.xRot = xRot
        leftArm.yRot = raiseArms ? yRot : -yRot
        leftArm.zRot = 0
      } else {
        const armDrop = f(-PI / (aggressive ? 1.5 : f(2.25)))
        const attack2 = sin(f(attackTime * PI))
        const attack = sin(f(f(1 - f(f(1 - attackTime) * f(1 - attackTime))) * PI))
        rightArm.zRot = 0
        leftArm.zRot = 0
        rightArm.yRot = -f(f(0.1) - f(attack2 * f(0.6)))
        leftArm.yRot = f(f(0.1) - f(attack2 * f(0.6)))
        rightArm.xRot = armDrop
        leftArm.xRot = armDrop
        rightArm.xRot = f(rightArm.xRot + f(f(attack2 * f(1.2)) - f(attack * f(0.4))))
        leftArm.xRot = f(leftArm.xRot + f(f(attack2 * f(1.2)) - f(attack * f(0.4))))
      }
    }
    AnimationUtils.bobArms(m, rightArm, leftArm, state.ageInTicks)
  }
}

/** The use parameters of a kinetic weapon (spears): the item's kinetic_weapon component, as the renderer gives it. */
export type KineticWeaponData = { delayTicks: number; dismountMaxDurationTicks?: number; knockbackMaxDurationTicks?: number; damageMaxDurationTicks?: number }

const progress = (time: number, start: number, end: number) => clamp(inverseLerp(time, start, end), 0, 1)

/** SpearAnimations (1.21.11+), the parts the model's code poses. */
export class SpearAnimations {
  static useParams(m: AnimModel, weapon: KineticWeaponData, time: number) {
    const { sin, ease } = m.c
    const finishRaisingTick = weapon.delayTicks
    const finishSwayingTick = (weapon.dismountMaxDurationTicks ?? 0) + finishRaisingTick
    const startSwayingTick = finishSwayingTick - 20
    const finishLoweringTick = (weapon.knockbackMaxDurationTicks ?? 0) + finishRaisingTick
    const startLoweringTick = finishLoweringTick - 40
    const finishRaisingBackTick = (weapon.damageMaxDurationTicks ?? 0) + finishRaisingTick
    const raiseProgress = progress(time, 0, finishRaisingTick)
    const raiseProgressStart = progress(raiseProgress, 0, 0.5)
    const raiseProgressMiddle = progress(raiseProgress, 0.5, f(0.8))
    const raiseProgressEnd = progress(raiseProgress, f(0.8), 1)
    const swayProgress = progress(time, startSwayingTick, finishSwayingTick)
    const lowerProgress = ease.outCubic(ease.inOutElastic(progress(f(time - 20), startLoweringTick, finishLoweringTick)))
    const raiseBackProgress = progress(time, finishRaisingBackTick - 5, finishRaisingBackTick)
    const swayIntensity = f(f(2 * ease.outCirc(swayProgress)) - f(2 * ease.inCirc(raiseBackProgress)))
    const swayScaleSlow = f(sin(f(f(time * 19) * DEG_TO_RAD)) * swayIntensity)
    const swayScaleFast = f(sin(f(f(time * 30) * DEG_TO_RAD)) * swayIntensity)
    return { raiseProgress, raiseProgressStart, raiseProgressMiddle, raiseProgressEnd, swayProgress, lowerProgress, raiseBackProgress, swayIntensity, swayScaleSlow, swayScaleFast }
  }

  static thirdPersonHandUse(m: AnimModel, arm: PartPose, head: PartPose, holdingArm: string, weapon: KineticWeaponData | undefined, state: AnimState) {
    const invert = holdingArm === 'RIGHT' ? 1 : -1
    arm.yRot = f(f(f(-0.1) * invert) + head.yRot)
    arm.xRot = f(f(-HALF_PI + head.xRot) + f(0.8))
    if (state.isFallFlying || state.swimAmount > 0) arm.xRot = f(arm.xRot - f(0.959_931_1))
    arm.yRot = f(DEG_TO_RAD * clamp(f(f(57.295_776) * arm.yRot), -60, 60))
    arm.xRot = f(DEG_TO_RAD * clamp(f(f(57.295_776) * arm.xRot), -120, 30))
    // before 26.3 the hand in use is compared to the arm's side, not to the arm it is with the main arm
    const usedArm = m.c.atLeast('26.3') ? handArm(state.useItemHand, state.mainArm) === holdingArm : state.useItemHand === (holdingArm === 'RIGHT' ? 'MAIN_HAND' : 'OFF_HAND')
    if (!(state.ticksUsingItem <= 0) && (!state.isUsingItem || usedArm) && weapon) {
      const p = SpearAnimations.useParams(m, weapon, state.ticksUsingItem)
      arm.yRot = f(arm.yRot + f(f(f(-invert * p.swayScaleFast) * DEG_TO_RAD) * p.swayIntensity))
      arm.zRot = f(arm.zRot + f(f(f(f(-invert * p.swayScaleSlow) * DEG_TO_RAD) * p.swayIntensity) * 0.5))
      arm.xRot = f(
        arm.xRot +
          f(
            DEG_TO_RAD *
              f(
                f(-40 * p.raiseProgressStart) +
                  f(30 * p.raiseProgressMiddle) +
                  f(-20 * p.raiseProgressEnd) +
                  f(20 * p.lowerProgress) +
                  f(10 * p.raiseBackProgress) +
                  f(f(f(0.6) * p.swayScaleSlow) * p.swayIntensity)
              )
          )
      )
    }
  }

  static thirdPersonAttackHand(m: HumanoidModel, animation: number, arm: string) {
    const { ease } = m.c
    m.rightArm.yRot = f(m.rightArm.yRot - m.body.yRot)
    m.leftArm.yRot = f(m.leftArm.yRot - m.body.yRot)
    m.leftArm.xRot = f(m.leftArm.xRot - m.body.yRot)
    const prepare = ease.inOutSine(progress(animation, 0, f(0.05)))
    const attack = ease.inQuad(progress(animation, f(0.05), f(0.2)))
    const retract = ease.inOutExpo(progress(animation, f(0.4), 1))
    const part = m.getArm(arm)
    part.xRot = f(part.xRot + f(f(f(f(90 * prepare) - f(120 * attack)) + f(30 * retract)) * DEG_TO_RAD))
  }
}

/** ArmPose.affectsOffhandPose of 1.21.11 - 26.2 (SPEAR too; 26.3 dropped it) */
const AFFECTS_OFFHAND_1_21_11 = new Set([...AFFECTS_OFFHAND, 'SPEAR'])
/** THROW_TRIDENT, named THROW_SPEAR before 1.21.11 */
const isThrowTrident = (pose: string | undefined) => pose === 'THROW_TRIDENT' || pose === 'THROW_SPEAR'

/**
 * HumanoidModel. 26.3 runs the attack swing from the render state's current swing and lets subclasses replace the swim
 * animation; before it (1.21.2 - 26.2) the swing comes from attackTime / attackArm, the swimming head turns before the
 * walk, and zombies pose their arms after the whole humanoid setupAnim (see each subclass). Before 1.21.4 the arm poses
 * are the model's own getArmPose (EMPTY unless a subclass knows better), from 1.21.4 the render state's.
 */
export class HumanoidModel extends AnimModel {
  head = this.part('head')
  hat = this.model.maybe('hat')
  body = this.part('body')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')

  override setupAnim(state: AnimState) {
    if (!this.c.atLeast('26.3')) {
      this.setupAnimLegacy(state)
      return
    }
    super.setupAnim(state)
    const swimAmount = state.swimAmount as number
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    if (state.isFallFlying) this.head.xRot = f(-0.785_398_2)
    const animationPos = state.walkAnimationPos as number
    this.setupWalkAnimation(state)
    let prioritizeArm: string
    if (state.isUsingItem) {
      prioritizeArm = handArm(state.useItemHand, state.mainArm)
    } else {
      const offHandArm = handArm('OFF_HAND', state.mainArm)
      prioritizeArm = TWO_HANDED.has(this.armPose(state, offHandArm)) ? state.mainArm : offHandArm
    }
    if (prioritizeArm === 'RIGHT') {
      this.poseRightArm(state)
      if (!AFFECTS_OFFHAND.has(state.rightArmPose)) this.poseLeftArm(state)
    } else {
      this.poseLeftArm(state)
      if (!AFFECTS_OFFHAND.has(state.leftArmPose)) this.poseRightArm(state)
    }
    this.setupAttackAnimation(state)
    this.setupCrouchAnimation(state)
    if (state.rightArmPose !== 'SPYGLASS') AnimationUtils.bobModelPart(this, this.rightArm, state.ageInTicks, 1)
    if (state.leftArmPose !== 'SPYGLASS') AnimationUtils.bobModelPart(this, this.leftArm, state.ageInTicks, -1)
    if (swimAmount > 0) this.setupSwimAnimation(state, animationPos, swimAmount)
  }

  /** HumanoidModel.setupAnim before 26.3 */
  setupAnimLegacy(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const since1_21_11 = this.c.atLeast('1.21.11')
    const leftArmPose = this.legacyArmPose(state, 'LEFT')
    const rightArmPose = this.legacyArmPose(state, 'RIGHT')
    const swimAmount = state.swimAmount as number
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    if (state.isFallFlying) this.head.xRot = f(-0.785_398_2)
    else if (swimAmount > 0) this.head.xRot = rotLerpRad(swimAmount, this.head.xRot, f(-0.785_398_2))
    const animationPos = state.walkAnimationPos as number
    this.setupWalkAnimation(state)
    // 1.21.11 also poses the other arm unless the first arm's pose affects it; before, using an item poses only its arm
    const affectsOffhand = (pose: string) => since1_21_11 && AFFECTS_OFFHAND_1_21_11.has(pose)
    const rightHanded = state.mainArm === 'RIGHT'
    if (state.isUsingItem) {
      const mainHandUsed = state.useItemHand === 'MAIN_HAND'
      if (mainHandUsed === rightHanded) {
        this.poseArm(state, true, rightArmPose)
        if (since1_21_11 && !affectsOffhand(rightArmPose)) this.poseArm(state, false, leftArmPose)
      } else {
        this.poseArm(state, false, leftArmPose)
        if (since1_21_11 && !affectsOffhand(leftArmPose)) this.poseArm(state, true, rightArmPose)
      }
    } else {
      const twoHandedOffhand = TWO_HANDED.has(rightHanded ? leftArmPose : rightArmPose)
      if (rightHanded !== twoHandedOffhand) {
        this.poseArm(state, false, leftArmPose)
        if (!affectsOffhand(leftArmPose)) this.poseArm(state, true, rightArmPose)
      } else {
        this.poseArm(state, true, rightArmPose)
        if (!affectsOffhand(rightArmPose)) this.poseArm(state, false, leftArmPose)
      }
    }
    this.setupAttackAnimation(state)
    this.setupCrouchAnimation(state)
    if (rightArmPose !== 'SPYGLASS') AnimationUtils.bobModelPart(this, this.rightArm, state.ageInTicks, 1)
    if (leftArmPose !== 'SPYGLASS') AnimationUtils.bobModelPart(this, this.leftArm, state.ageInTicks, -1)
    if (swimAmount > 0) {
      const swimPos = f(animationPos % 26)
      const attacking = state.attackTime > 0
      const rightArmSwimAmount = (since1_21_11 && state.rightArmPose === 'SPEAR') || (state.attackArm === 'RIGHT' && attacking) ? 0 : swimAmount
      const leftArmSwimAmount = (since1_21_11 && state.leftArmPose === 'SPEAR') || (state.attackArm === 'LEFT' && attacking) ? 0 : swimAmount
      if (!state.isUsingItem) this.swimArms(swimPos, leftArmSwimAmount, rightArmSwimAmount)
      this.leftLeg.xRot = lerp(swimAmount, this.leftLeg.xRot, f(f(0.3) * cos(f(f(animationPos * f(0.333_333_34)) + PI))))
      this.rightLeg.xRot = lerp(swimAmount, this.rightLeg.xRot, f(f(0.3) * cos(f(animationPos * f(0.333_333_34)))))
    }
  }

  /**
   * The arm pose setupAnim uses before 26.3: from 1.21.4 the render state's; before, the model's getArmPose, EMPTY here
   * (SkeletonModel and DrownedModel override it).
   */
  legacyArmPose(state: AnimState, arm: string): string {
    if (!this.c.atLeast('1.21.4')) return 'EMPTY'
    return (arm === 'RIGHT' ? state.rightArmPose : state.leftArmPose) ?? 'EMPTY'
  }

  /** The swing progress the attack animations read: 26.3's swingAnimation, attackTime before. */
  attackTime(state: AnimState): number {
    return (this.c.atLeast('26.3') ? state.swingAnimation : state.attackTime) ?? 0
  }

  setupWalkAnimation(state: AnimState) {
    const { cos } = this.c
    const animationPos = state.walkAnimationPos as number
    const animationSpeed = state.walkAnimationSpeed as number
    const speedValue = state.speedValue as number
    this.rightArm.xRot = f(f(f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * 2) * animationSpeed) * 0.5) / speedValue)
    this.leftArm.xRot = f(f(f(f(cos(f(animationPos * f(0.6662))) * 2) * animationSpeed) * 0.5) / speedValue)
    this.rightLeg.xRot = f(f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed) / speedValue)
    this.leftLeg.xRot = f(f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed) / speedValue)
    this.rightLeg.yRot = f(0.005)
    this.leftLeg.yRot = f(-0.005)
    this.rightLeg.zRot = f(0.005)
    this.leftLeg.zRot = f(-0.005)
    if (state.isPassenger) {
      this.rightArm.xRot = f(this.rightArm.xRot + f(-0.628_318_55))
      this.leftArm.xRot = f(this.leftArm.xRot + f(-0.628_318_55))
      this.rightLeg.xRot = f(-1.413_716_7)
      this.rightLeg.yRot = f(0.314_159_27)
      this.rightLeg.zRot = f(0.078_539_82)
      this.leftLeg.xRot = f(-1.413_716_7)
      this.leftLeg.yRot = f(-0.314_159_27)
      this.leftLeg.zRot = f(-0.078_539_82)
    }
  }

  setupCrouchAnimation(state: AnimState) {
    if (state.isCrouching) {
      this.body.xRot = 0.5
      this.rightArm.xRot = f(this.rightArm.xRot + f(0.4))
      this.leftArm.xRot = f(this.leftArm.xRot + f(0.4))
      this.rightLeg.z = f(this.rightLeg.z + 4)
      this.leftLeg.z = f(this.leftLeg.z + 4)
      this.head.y = f(this.head.y + f(4.2))
      this.body.y = f(this.body.y + f(3.2))
      this.leftArm.y = f(this.leftArm.y + f(3.2))
      this.rightArm.y = f(this.rightArm.y + f(3.2))
    }
  }

  /** HumanoidRenderState.getArmPose */
  armPose(state: AnimState, arm: string): string {
    return arm === 'RIGHT' ? state.rightArmPose : state.leftArmPose
  }

  getArm(arm: string) {
    return arm === 'LEFT' ? this.leftArm : this.rightArm
  }

  setupSwimAnimation(state: AnimState, animationPos: number, swimAmount: number) {
    const { cos } = this.c
    if (!state.isFallFlying) this.head.xRot = rotLerpRad(swimAmount, this.head.xRot, f(-0.785_398_2))
    const swimPos = f(animationPos % 26)
    const swingArm = state.currentSwing ? handArm(state.currentSwing.hand, state.mainArm) : undefined
    const rightArmSwimAmount = state.rightArmPose !== 'SPEAR' && swingArm !== 'RIGHT' ? swimAmount : 0
    const leftArmSwimAmount = state.leftArmPose !== 'SPEAR' && swingArm !== 'LEFT' ? swimAmount : 0
    if (!state.isUsingItem) this.swimArms(swimPos, leftArmSwimAmount, rightArmSwimAmount)
    this.leftLeg.xRot = lerp(swimAmount, this.leftLeg.xRot, f(f(0.3) * cos(f(f(animationPos * f(0.333_333_34)) + PI))))
    this.rightLeg.xRot = lerp(swimAmount, this.rightLeg.xRot, f(f(0.3) * cos(f(animationPos * f(0.333_333_34)))))
  }

  /** The swimming arm strokes (the !isUsingItem part of the swim animation). */
  swimArms(swimPos: number, leftArmSwimAmount: number, rightArmSwimAmount: number) {
    const quadratic = (x: number) => f(f(-65 * x) + f(x * x))
    if (swimPos < 14) {
      this.leftArm.xRot = rotLerpRad(leftArmSwimAmount, this.leftArm.xRot, 0)
      this.rightArm.xRot = lerp(rightArmSwimAmount, this.rightArm.xRot, 0)
      this.leftArm.yRot = rotLerpRad(leftArmSwimAmount, this.leftArm.yRot, PI)
      this.rightArm.yRot = lerp(rightArmSwimAmount, this.rightArm.yRot, PI)
      this.leftArm.zRot = rotLerpRad(leftArmSwimAmount, this.leftArm.zRot, f(PI + f(f(f(1.870_796_4) * quadratic(swimPos)) / quadratic(14))))
      this.rightArm.zRot = lerp(rightArmSwimAmount, this.rightArm.zRot, f(PI - f(f(f(1.870_796_4) * quadratic(swimPos)) / quadratic(14))))
    } else if (swimPos >= 14 && swimPos < 22) {
      const internalSwimPos = f(f(swimPos - 14) / 8)
      this.leftArm.xRot = rotLerpRad(leftArmSwimAmount, this.leftArm.xRot, f(HALF_PI * internalSwimPos))
      this.rightArm.xRot = lerp(rightArmSwimAmount, this.rightArm.xRot, f(HALF_PI * internalSwimPos))
      this.leftArm.yRot = rotLerpRad(leftArmSwimAmount, this.leftArm.yRot, PI)
      this.rightArm.yRot = lerp(rightArmSwimAmount, this.rightArm.yRot, PI)
      this.leftArm.zRot = rotLerpRad(leftArmSwimAmount, this.leftArm.zRot, f(f(5.012_389) - f(f(1.870_796_4) * internalSwimPos)))
      this.rightArm.zRot = lerp(rightArmSwimAmount, this.rightArm.zRot, f(f(1.270_796_3) + f(f(1.870_796_4) * internalSwimPos)))
    } else if (swimPos >= 22 && swimPos < 26) {
      const internalSwimPos = f(f(swimPos - 22) / 4)
      this.leftArm.xRot = rotLerpRad(leftArmSwimAmount, this.leftArm.xRot, f(HALF_PI - f(HALF_PI * internalSwimPos)))
      this.rightArm.xRot = lerp(rightArmSwimAmount, this.rightArm.xRot, f(HALF_PI - f(HALF_PI * internalSwimPos)))
      this.leftArm.yRot = rotLerpRad(leftArmSwimAmount, this.leftArm.yRot, PI)
      this.rightArm.yRot = lerp(rightArmSwimAmount, this.rightArm.yRot, PI)
      this.leftArm.zRot = rotLerpRad(leftArmSwimAmount, this.leftArm.zRot, PI)
      this.rightArm.zRot = lerp(rightArmSwimAmount, this.rightArm.zRot, PI)
    }
  }

  poseArm(state: AnimState, right: boolean, pose: string = right ? state.rightArmPose : state.leftArmPose) {
    const arm = right ? this.rightArm : this.leftArm
    const side = right ? 'RIGHT' : 'LEFT'
    switch (pose) {
      case 'EMPTY':
        arm.yRot = 0
        break
      case 'ITEM':
        arm.xRot = f(f(arm.xRot * 0.5) - f(0.314_159_27))
        arm.yRot = 0
        break
      case 'BLOCK':
        this.poseBlockingArm(arm, right)
        break
      case 'BOW_AND_ARROW':
        if (right) {
          this.rightArm.yRot = f(f(-0.1) + this.head.yRot)
          this.leftArm.yRot = f(f(f(0.1) + this.head.yRot) + f(0.4))
        } else {
          this.rightArm.yRot = f(f(f(-0.1) + this.head.yRot) - f(0.4))
          this.leftArm.yRot = f(f(0.1) + this.head.yRot)
        }
        this.rightArm.xRot = f(-HALF_PI + this.head.xRot)
        this.leftArm.xRot = f(-HALF_PI + this.head.xRot)
        break
      case 'THROW_TRIDENT':
      case 'THROW_SPEAR':
        arm.xRot = f(f(arm.xRot * 0.5) - PI)
        arm.yRot = 0
        break
      case 'CROSSBOW_CHARGE':
        AnimationUtils.animateCrossbowCharge(this.rightArm, this.leftArm, state.maxCrossbowChargeDuration, state.ticksUsingItem, right)
        break
      case 'CROSSBOW_HOLD':
        AnimationUtils.animateCrossbowHold(this.rightArm, this.leftArm, this.head, right)
        break
      case 'SPYGLASS':
        arm.xRot = clamp(f(f(this.head.xRot - f(1.919_862_2)) - (state.isCrouching ? f(0.261_799_4) : 0)), f(-2.4), f(3.3))
        arm.yRot = f(this.head.yRot + (right ? f(-0.261_799_4) : f(0.261_799_4)))
        break
      case 'TOOT_HORN':
        arm.xRot = f(clamp(this.head.xRot, f(-1.2), f(1.2)) - f(1.483_529_8))
        arm.yRot = f(this.head.yRot + (right ? f(-0.523_598_8) : f(0.523_598_8)))
        break
      case 'BRUSH':
        arm.xRot = f(f(arm.xRot * 0.5) - f(0.628_318_55))
        arm.yRot = 0
        break
      case 'SPEAR':
        SpearAnimations.thirdPersonHandUse(this, arm, this.head, side, this.useItemKineticWeapon(state, side), state)
        break
    }
  }

  /** HumanoidRenderState.getUseItemStackForArm's kinetic weapon: the item in that arm's hand. */
  useItemKineticWeapon(state: AnimState, arm: string): KineticWeaponData | undefined {
    return arm === state.mainArm ? state.mainHandKineticWeapon : state.offHandKineticWeapon
  }

  poseRightArm(state: AnimState) {
    this.poseArm(state, true)
  }

  poseLeftArm(state: AnimState) {
    this.poseArm(state, false)
  }

  poseBlockingArm(arm: PartPose, right: boolean) {
    arm.xRot = f(f(f(arm.xRot * 0.5) - f(0.942_477_9)) + clamp(this.head.xRot, f(-1.396_263_4), f(0.436_332_32)))
    arm.yRot = f(f((right ? -30 : 30) * DEG_TO_RAD) + clamp(this.head.yRot, f(-0.523_598_8), f(0.523_598_8)))
  }

  /**
   * 26.3: the current swing (its hand and animation type) at swingAnimation. Before: attackTime on attackArm, a whack
   * (1.21.11 - 26.2: the main hand item's swingAnimationType).
   */
  setupAttackAnimation(state: AnimState) {
    const { sin, cos, ease } = this.c
    let swingAnimation: number
    let swingArm: string
    let type: string
    if (this.c.atLeast('26.3')) {
      swingAnimation = state.swingAnimation as number
      const swing = state.currentSwing as { hand: string; animation: { type: string } } | null
      if (swingAnimation <= 0 || !swing) return
      swingArm = handArm(swing.hand, state.mainArm)
      type = swing.animation.type
    } else {
      swingAnimation = (state.attackTime ?? 0) as number
      if (swingAnimation <= 0) return
      swingArm = state.attackArm
      type = this.c.atLeast('1.21.11') ? (state.swingAnimationType ?? 'WHACK') : 'WHACK'
    }
    this.body.yRot = f(sin(f(f(Math.sqrt(swingAnimation)) * f(6.283_185_5))) * f(0.2))
    if (swingArm === 'LEFT') this.body.yRot = f(this.body.yRot * -1)
    const ageScale = state.ageScale as number
    this.rightArm.z = f(f(sin(this.body.yRot) * 5) * ageScale)
    this.rightArm.x = f(f(-cos(this.body.yRot) * 5) * ageScale)
    this.leftArm.z = f(f(-sin(this.body.yRot) * 5) * ageScale)
    this.leftArm.x = f(f(cos(this.body.yRot) * 5) * ageScale)
    this.rightArm.yRot = f(this.rightArm.yRot + this.body.yRot)
    this.leftArm.yRot = f(this.leftArm.yRot + this.body.yRot)
    this.leftArm.xRot = f(this.leftArm.xRot + this.body.yRot)
    switch (type) {
      case 'WHACK': {
        // Ease.outQuart, or (before 1.21.11) the same 1 - (1 - t)^4 written out
        const aa = sin(f(ease.outQuart(swingAnimation) * PI))
        const bb = f(f(f(sin(f(swingAnimation * PI)) * -f(this.head.xRot - f(0.7))) * f(0.75)))
        const attackArm = this.getArm(swingArm)
        attackArm.xRot = f(attackArm.xRot - f(f(aa * f(1.2)) + bb))
        attackArm.yRot = f(attackArm.yRot + f(this.body.yRot * 2))
        attackArm.zRot = f(attackArm.zRot + f(sin(f(swingAnimation * PI)) * f(-0.4)))
        break
      }
      case 'STAB':
        SpearAnimations.thirdPersonAttackHand(this, swingAnimation, swingArm)
        break
    }
  }
}

/**
 * ZombieModel (and GiantZombieModel, ZombieVillagerModel: same code). 26.3 poses the arms in setupAttackAnimation;
 * before (AbstractZombieModel) after the whole humanoid setupAnim.
 */
export class ZombieModel extends HumanoidModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    if (!this.c.atLeast('26.3')) AnimationUtils.animateZombieArmsLegacy(this, this.leftArm, this.rightArm, state.isAggressive, state)
  }

  override setupAttackAnimation(state: AnimState) {
    super.setupAttackAnimation(state)
    if (this.c.atLeast('26.3')) AnimationUtils.animateZombieArms(this, this.leftArm, this.rightArm, state.isAggressive, state)
  }
}

/**
 * DrownedModel. Before 26.3 it adds its trident pose and its swimming on top of the humanoid (and zombie) pose; 26.3
 * replaces the humanoid swim animation. Before 1.21.4 its own getArmPose throws a trident held in the main hand by an
 * aggressive drowned (`state.isHoldingTrident`, optional: the main hand item is a trident, 1.21.2 / 1.21.3 only).
 */
export class DrownedModel extends ZombieModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    if (this.c.atLeast('26.3')) return
    if (isThrowTrident(this.legacyArmPose(state, 'LEFT'))) {
      this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - PI)
      this.leftArm.yRot = 0
    }
    if (isThrowTrident(this.legacyArmPose(state, 'RIGHT'))) {
      this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - PI)
      this.rightArm.yRot = 0
    }
    const swimAmount = state.swimAmount as number
    if (swimAmount > 0) this.drownedSwim(state, swimAmount)
  }

  override legacyArmPose(state: AnimState, arm: string): string {
    if (this.c.atLeast('1.21.4')) return super.legacyArmPose(state, arm)
    return state.isHoldingTrident && state.isAggressive && state.mainArm === arm ? 'THROW_SPEAR' : 'EMPTY'
  }

  override setupSwimAnimation(state: AnimState, _animationPos: number, swimAmount: number) {
    this.drownedSwim(state, swimAmount)
  }

  drownedSwim(state: AnimState, swimAmount: number) {
    const { sin } = this.c
    const wave = sin(f(f(0.1) * state.ageInTicks))
    this.rightArm.xRot = f(rotLerpRad(swimAmount, this.rightArm.xRot, f(-2.513_274_2)) + f(f(swimAmount * f(0.35)) * wave))
    this.leftArm.xRot = f(rotLerpRad(swimAmount, this.leftArm.xRot, f(-2.513_274_2)) - f(f(swimAmount * f(0.35)) * wave))
    this.rightArm.zRot = rotLerpRad(swimAmount, this.rightArm.zRot, f(-0.15))
    this.leftArm.zRot = rotLerpRad(swimAmount, this.leftArm.zRot, f(0.15))
    this.leftLeg.xRot = f(this.leftLeg.xRot - f(f(swimAmount * f(0.55)) * wave))
    this.rightLeg.xRot = f(this.rightLeg.xRot + f(f(swimAmount * f(0.55)) * wave))
    this.head.xRot = 0
  }
}

/** SkeletonModel. Before 1.21.4 its getArmPose draws the bow of an aggressive skeleton holding one in the main hand. */
export class SkeletonModel extends HumanoidModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    if (state.isAggressive && !state.isHoldingBow) {
      const { sin } = this.c
      const swingAnimation = this.attackTime(state)
      const swing2 = sin(f(swingAnimation * PI))
      const swing = sin(f(f(1 - f(f(1 - swingAnimation) * f(1 - swingAnimation))) * PI))
      this.rightArm.zRot = 0
      this.leftArm.zRot = 0
      this.rightArm.yRot = -f(f(0.1) - f(swing2 * f(0.6)))
      this.leftArm.yRot = f(f(0.1) - f(swing2 * f(0.6)))
      this.rightArm.xRot = -HALF_PI
      this.leftArm.xRot = -HALF_PI
      this.rightArm.xRot = f(this.rightArm.xRot - f(f(swing2 * f(1.2)) - f(swing * f(0.4))))
      this.leftArm.xRot = f(this.leftArm.xRot - f(f(swing2 * f(1.2)) - f(swing * f(0.4))))
      AnimationUtils.bobArms(this, this.rightArm, this.leftArm, state.ageInTicks)
    }
  }

  override legacyArmPose(state: AnimState, arm: string): string {
    if (this.c.atLeast('1.21.4')) return super.legacyArmPose(state, arm)
    return state.isHoldingBow && state.isAggressive && state.mainArm === arm ? 'BOW_AND_ARROW' : 'EMPTY'
  }
}

export class BoggedModel extends SkeletonModel {
  mushrooms = this.part('mushrooms')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.mushrooms.visible = !state.isSheared
  }
}

export class AbstractPiglinModel extends HumanoidModel {
  rightEar = this.part('right_ear')
  leftEar = this.part('left_ear')
  defaultEarAngleInDegrees = 30

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const animationPos = state.walkAnimationPos as number
    const animationSpeed = state.walkAnimationSpeed as number
    const defaultAngle = f(this.defaultEarAngleInDegrees * DEG_TO_RAD)
    const frequency = f(f(state.ageInTicks * f(0.1)) + f(animationPos * 0.5))
    const amplitude = f(f(0.08) + f(animationSpeed * f(0.4)))
    this.leftEar.zRot = f(-defaultAngle - f(cos(f(frequency * f(1.2))) * amplitude))
    this.rightEar.zRot = f(defaultAngle + f(cos(frequency) * amplitude))
  }
}

export class PiglinModel extends AbstractPiglinModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const swingAnimation = this.attackTime(state)
    const pose = state.armPose as string
    if (pose === 'DANCING') {
      const dancePos = f(state.ageInTicks / 60)
      this.rightEar.zRot = f(f(0.523_598_8) + f(f(DEG_TO_RAD * sin(f(dancePos * 30))) * 10))
      this.leftEar.zRot = f(f(-0.523_598_8) - f(f(DEG_TO_RAD * cos(f(dancePos * 30))) * 10))
      this.head.x = f(this.head.x + sin(f(dancePos * 10)))
      this.head.y = f(this.head.y + f(sin(f(dancePos * 40)) + f(0.4)))
      this.rightArm.zRot = f(DEG_TO_RAD * f(70 + f(cos(f(dancePos * 40)) * 10)))
      this.leftArm.zRot = f(this.rightArm.zRot * -1)
      this.rightArm.y = f(this.rightArm.y + f(f(sin(f(dancePos * 40)) * 0.5) - 0.5))
      this.leftArm.y = f(this.leftArm.y + f(f(sin(f(dancePos * 40)) * 0.5) + 0.5))
      this.body.y = f(this.body.y + f(sin(f(dancePos * 40)) * f(0.35)))
    } else if (pose === 'ATTACKING_WITH_MELEE_WEAPON' && swingAnimation === 0) {
      if (state.mainArm === 'LEFT') this.leftArm.xRot = f(-1.8)
      else this.rightArm.xRot = f(-1.8)
    } else if (pose === 'CROSSBOW_HOLD') {
      AnimationUtils.animateCrossbowHold(this.rightArm, this.leftArm, this.head, state.mainArm === 'RIGHT')
    } else if (pose === 'CROSSBOW_CHARGE') {
      AnimationUtils.animateCrossbowCharge(this.rightArm, this.leftArm, state.maxCrossbowChageDuration, state.ticksUsingItem, state.mainArm === 'RIGHT')
    } else if (pose === 'ADMIRING_ITEM') {
      this.head.xRot = 0.5
      this.head.yRot = 0
      if (state.mainArm === 'LEFT') {
        this.rightArm.yRot = -0.5
        this.rightArm.xRot = f(-0.9)
      } else {
        this.leftArm.yRot = 0.5
        this.leftArm.xRot = f(-0.9)
      }
    }
  }

  override setupAttackAnimation(state: AnimState) {
    const swingAnimation = this.attackTime(state)
    if (swingAnimation > 0 && state.armPose === 'ATTACKING_WITH_MELEE_WEAPON') {
      AnimationUtils.swingWeaponDown(this, this.rightArm, this.leftArm, state.mainArm, swingAnimation, state.ageInTicks)
    } else {
      super.setupAttackAnimation(state)
    }
  }
}

export class BabyPiglinModel extends PiglinModel {
  override defaultEarAngleInDegrees = 5
}

/** ZombifiedPiglinModel: zombie arms in setupAttackAnimation (26.3), after the whole setupAnim before. */
export class ZombifiedPiglinModel extends AbstractPiglinModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    if (!this.c.atLeast('26.3')) AnimationUtils.animateZombieArmsLegacy(this, this.leftArm, this.rightArm, state.isAggressive, state)
  }

  override setupAttackAnimation(state: AnimState) {
    super.setupAttackAnimation(state)
    if (this.c.atLeast('26.3')) AnimationUtils.animateZombieArms(this, this.leftArm, this.rightArm, state.isAggressive, state)
  }
}

export class BabyZombifiedPiglinModel extends ZombifiedPiglinModel {
  override defaultEarAngleInDegrees = 5
}

export const HUMANOID_MODELS = {
  HumanoidModel,
  // 1.21.2 - 1.21.8: the armor layers' model (HumanoidModel's code)
  HumanoidArmorModel: HumanoidModel,
  ZombieModel,
  BabyZombieModel: ZombieModel,
  GiantZombieModel: ZombieModel,
  ZombieVillagerModel: ZombieModel,
  BabyZombieVillagerModel: ZombieModel,
  DrownedModel,
  BabyDrownedModel: DrownedModel,
  SkeletonModel,
  BoggedModel,
  // before 26.1 there is one PiglinModel / ZombifiedPiglinModel class for adults and babies (30 degree ears)
  PiglinModel,
  ZombifiedPiglinModel,
  AdultPiglinModel: PiglinModel,
  BabyPiglinModel,
  AdultZombifiedPiglinModel: ZombifiedPiglinModel,
  BabyZombifiedPiglinModel
}
