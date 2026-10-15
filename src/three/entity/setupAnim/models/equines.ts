import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, clamp, f, lerp } from '../mth'
import { applyAnimationState, applyStaticAnimation, applyWalkAnimation } from '../keyframes'

/**
 * Horses, donkeys and mules (AbstractEquineModel), camels, sniffers, armadillos and striders, 26.3; the 1.21.2 - 1.21.11
 * code (one class per kind, the baby a scaled adult mesh) branches inside the same classes.
 */

/** AbstractEquineModel */
export class AbstractEquineModel extends AnimModel {
  body = this.part('body')
  // the baby donkey's parts sit under body; their names are unique in every equine model, so the lookup is the same
  headParts = this.part('head_parts')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')
  tail = this.part('tail')
  // before 1.21.5 the saddle was part of the main model (EquineSaddleModel since)
  private readonly saddleParts = this.c.atLeast('1.21.5')
    ? []
    : ['saddle', 'left_saddle_mouth', 'right_saddle_mouth', 'head_saddle', 'mouth_saddle_wrap'].map(name => this.part(name))
  private readonly saddledRidingParts = this.c.atLeast('1.21.5') ? [] : [this.part('left_saddle_line'), this.part('right_saddle_line')]

  override setupAnim(state: AnimState) {
    if (!this.c.atLeast('26.1')) {
      this.setupAnimBefore26_1(state)
      return
    }
    super.setupAnim(state)
    const { sin, cos } = this.c
    const clampedYRot = clamp(state.yRot, -20, 20)
    let headRotXRad = f(state.xRot * DEG_TO_RAD)
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    if (animationSpeed > f(0.2)) {
      headRotXRad = f(headRotXRad + f(f(cos(f(animationPos * f(0.8))) * f(0.15)) * animationSpeed))
    }
    const eating = state.eatAnimation as number
    const standing = state.standAnimation as number
    const iStanding = f(1 - standing)
    const feedingAnim = state.feedingAnimation as number
    const animateTail = !!state.animateTail
    this.headParts.xRot = f(f(0.523_598_8) + headRotXRad)
    this.headParts.yRot = f(clampedYRot * DEG_TO_RAD)
    const waterMultiplier = state.isInWater ? f(0.2) : 1
    const legAnim1 = cos(f(f(f(waterMultiplier * animationPos) * f(0.6662)) + PI))
    const legXRotAnim = f(f(legAnim1 * f(0.8)) * animationSpeed)
    const notStandingOrEating = f(1 - Math.max(standing, eating))
    const baseHeadAngle = f(notStandingOrEating * f(f(f(0.523_598_8) + headRotXRad) + f(f(feedingAnim * sin(state.ageInTicks)) * f(0.05))))
    this.headParts.xRot = f(
      f(f(standing * f(f(0.261_799_4) + headRotXRad)) + f(eating * f(f(2.181_661_6) + f(sin(state.ageInTicks) * f(0.05))))) + baseHeadAngle
    )
    this.headParts.yRot = f(f(f(standing * clampedYRot) * DEG_TO_RAD) + f(notStandingOrEating * this.headParts.yRot))
    this.animateHeadPartsPlacement(eating, standing)
    this.body.xRot = f(f(standing * f(-0.785_398_2)) + f(iStanding * this.body.xRot))
    this.leftFrontLeg.y = f(this.leftFrontLeg.y - f(this.getLegStandingYOffset() * standing))
    this.leftFrontLeg.z = f(this.leftFrontLeg.z + f(this.getLegStandingZOffset() * standing))
    this.rightFrontLeg.y = this.leftFrontLeg.y
    this.rightFrontLeg.z = this.leftFrontLeg.z
    const standAngle = f(this.getLegStandAngle() * standing)
    const bobValue = cos(f(f(state.ageInTicks * f(0.6)) + PI))
    const legStandingXRotOffset = this.getLegStandingXRotOffset()
    const rlegRot = f(f(f(legStandingXRotOffset + bobValue) * standing) + f(legXRotAnim * iStanding))
    const llegRot = f(f(f(legStandingXRotOffset - bobValue) * standing) - f(legXRotAnim * iStanding))
    const hindLegAnim = f(f(f(legAnim1 * 0.5) * animationSpeed) * iStanding)
    this.leftHindLeg.xRot = f(standAngle - hindLegAnim)
    this.rightHindLeg.xRot = f(standAngle + hindLegAnim)
    this.leftFrontLeg.xRot = rlegRot
    this.rightFrontLeg.xRot = llegRot
    this.offsetLegPositionWhenStanding(standing)
    const ageScale = state.ageScale as number
    this.tail.xRot = f(f(this.getTailXRotOffset() + f(0.523_598_8)) + f(animationSpeed * 0.75))
    this.tail.y = f(this.tail.y + f(animationSpeed * ageScale))
    this.tail.z = f(this.tail.z + f(f(animationSpeed * 2) * ageScale))
    if (animateTail) {
      this.tail.yRot = cos(f(state.ageInTicks * f(0.7)))
    } else {
      this.tail.yRot = 0
    }
  }

  /** 1.21.2 - 1.21.11: no per-model hooks, the head and front leg offsets scale with ageScale; the saddle before 1.21.5. */
  private setupAnimBefore26_1(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    for (const part of this.saddleParts) part.visible = !!state.isSaddled
    for (const part of this.saddledRidingParts) part.visible = !!state.isRidden && !!state.isSaddled
    const clampedYRot = clamp(state.yRot, -20, 20)
    let headRotXRad = f(state.xRot * DEG_TO_RAD)
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    if (animationSpeed > f(0.2)) {
      headRotXRad = f(headRotXRad + f(f(cos(f(animationPos * f(0.8))) * f(0.15)) * animationSpeed))
    }
    const eating = state.eatAnimation as number
    const standing = state.standAnimation as number
    const iStanding = f(1 - standing)
    const feedingAnim = state.feedingAnimation as number
    const animateTail = !!state.animateTail
    this.headParts.xRot = f(f(0.523_598_8) + headRotXRad)
    this.headParts.yRot = f(clampedYRot * DEG_TO_RAD)
    const waterMultiplier = state.isInWater ? f(0.2) : 1
    const legAnim1 = cos(f(f(f(waterMultiplier * animationPos) * f(0.6662)) + PI))
    const legXRotAnim = f(f(legAnim1 * f(0.8)) * animationSpeed)
    const baseHeadAngle = f(f(1 - Math.max(standing, eating)) * f(f(f(0.523_598_8) + headRotXRad) + f(f(feedingAnim * sin(state.ageInTicks)) * f(0.05))))
    this.headParts.xRot = f(
      f(f(standing * f(f(0.261_799_4) + headRotXRad)) + f(eating * f(f(2.181_661_6) + f(sin(state.ageInTicks) * f(0.05))))) + baseHeadAngle
    )
    this.headParts.yRot = f(f(f(standing * clampedYRot) * DEG_TO_RAD) + f(f(1 - Math.max(standing, eating)) * this.headParts.yRot))
    const ageScale = state.ageScale as number
    this.headParts.y = f(this.headParts.y + lerp(eating, lerp(standing, 0, f(-8 * ageScale)), f(7 * ageScale)))
    this.headParts.z = lerp(standing, this.headParts.z, f(-4 * ageScale))
    this.body.xRot = f(f(standing * f(-0.785_398_2)) + f(iStanding * this.body.xRot))
    const standAngle = f(f(0.261_799_4) * standing)
    const bobValue = cos(f(f(state.ageInTicks * f(0.6)) + PI))
    this.leftFrontLeg.y = f(this.leftFrontLeg.y - f(f(12 * ageScale) * standing))
    this.leftFrontLeg.z = f(this.leftFrontLeg.z + f(f(4 * ageScale) * standing))
    this.rightFrontLeg.y = this.leftFrontLeg.y
    this.rightFrontLeg.z = this.leftFrontLeg.z
    const rlegRot = f(f(f(f(-1.047_197_6) + bobValue) * standing) + f(legXRotAnim * iStanding))
    const llegRot = f(f(f(f(-1.047_197_6) - bobValue) * standing) - f(legXRotAnim * iStanding))
    this.leftHindLeg.xRot = f(standAngle - f(f(f(legAnim1 * 0.5) * animationSpeed) * iStanding))
    this.rightHindLeg.xRot = f(standAngle + f(f(f(legAnim1 * 0.5) * animationSpeed) * iStanding))
    this.leftFrontLeg.xRot = rlegRot
    this.rightFrontLeg.xRot = llegRot
    this.tail.xRot = f(f(0.523_598_8) + f(animationSpeed * 0.75))
    this.tail.y = f(this.tail.y + f(animationSpeed * ageScale))
    this.tail.z = f(this.tail.z + f(f(animationSpeed * 2) * ageScale))
    if (animateTail) {
      this.tail.yRot = cos(f(state.ageInTicks * f(0.7)))
    } else {
      this.tail.yRot = 0
    }
  }

  protected offsetLegPositionWhenStanding(_standing: number) {}

  protected getLegStandAngle() {
    return f(0.261_799_4)
  }

  protected getLegStandingYOffset() {
    return 12
  }

  protected getLegStandingZOffset() {
    return 4
  }

  protected getLegStandingXRotOffset() {
    return f(-1.047_197_6)
  }

  protected getTailXRotOffset() {
    return 0
  }

  protected animateHeadPartsPlacement(eating: number, standing: number) {
    this.headParts.y = f(this.headParts.y + lerp(eating, lerp(standing, 0, -8), 7))
    this.headParts.z = lerp(standing, this.headParts.z, -4)
  }
}

/** HorseModel */
export class HorseModel extends AbstractEquineModel {}

/** BabyHorseModel */
export class BabyHorseModel extends HorseModel {
  protected override getLegStandingYOffset() {
    return 4
  }

  protected override getLegStandingZOffset() {
    return 0
  }

  protected override getTailXRotOffset() {
    return -HALF_PI
  }

  protected override animateHeadPartsPlacement(eating: number, standing: number) {
    this.headParts.y = f(this.headParts.y + lerp(eating, lerp(standing, 0, -2), 2))
    this.headParts.z = lerp(standing, this.headParts.z, -4)
  }
}

/** DonkeyModel (donkeys and mules) */
export class DonkeyModel extends AbstractEquineModel {
  leftChest = this.part('left_chest')
  rightChest = this.part('right_chest')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.leftChest.visible = !!state.hasChest
    this.rightChest.visible = !!state.hasChest
  }
}

/** BabyDonkeyModel */
export class BabyDonkeyModel extends DonkeyModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin } = this.c
    // the game writes this into the render state too
    state.xRot = -30
    const headRotXRad = f(state.xRot * DEG_TO_RAD)
    const eating = state.eatAnimation as number
    const standing = state.standAnimation as number
    const feedingAnim = state.feedingAnimation as number
    const baseHeadAngle = f(f(1 - Math.max(standing, eating)) * f(f(f(0.523_598_8) + headRotXRad) + f(f(feedingAnim * sin(state.ageInTicks)) * f(0.05))))
    this.headParts.xRot = f(f(f(standing * f(f(0.261_799_4) + headRotXRad)) + f(eating * f(HALF_PI + f(sin(state.ageInTicks) * f(0.05))))) + baseHeadAngle)
  }

  protected override offsetLegPositionWhenStanding(standing: number) {
    this.leftHindLeg.y = lerp(standing, this.leftHindLeg.y, f(-0.3))
    this.rightHindLeg.y = lerp(standing, this.leftHindLeg.y, f(-0.3))
  }

  protected override getLegStandAngle() {
    return f(1.047_197_6)
  }

  protected override getLegStandingYOffset() {
    return 1
  }

  protected override getLegStandingZOffset() {
    return 0.5
  }

  protected override getLegStandingXRotOffset() {
    return 0
  }

  protected override getTailXRotOffset() {
    return f(-0.785_398_2)
  }

  protected override animateHeadPartsPlacement(eating: number, standing: number) {
    this.headParts.y = lerp(eating, this.headParts.y, f(-1.2))
    this.headParts.z = lerp(standing, this.headParts.z, f(-3.6))
  }
}

/** EquineSaddleModel */
export class EquineSaddleModel extends AbstractEquineModel {
  ridingParts = [this.part('left_saddle_line'), this.part('right_saddle_line')]

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    for (const part of this.ridingParts) part.visible = !!state.isRidden
  }
}

/** The keyframe animations a CamelModel subclass passes its constructor. */
type CamelAnimations = { walk: string; sit: string; sitPose: string; standup: string; idle: string; dash: string }

/** CamelModel */
export abstract class CamelModel extends AnimModel {
  head = this.part('head')
  protected abstract readonly animations: CamelAnimations
  // before 1.21.5 the saddle was part of the main model (CamelSaddleModel since)
  private readonly saddleParts = this.c.atLeast('1.21.5') ? [] : [this.part('saddle'), this.part('bridle')]
  private readonly ridingParts = this.c.atLeast('1.21.5') ? [] : [this.part('reins')]

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { model, c, animations } = this
    this.applyHeadRotation(state, state.yRot, state.xRot)
    if (!c.atLeast('1.21.5')) this.toggleInvisibleParts(state)
    applyWalkAnimation(model, c, animations.walk, state.walkAnimationPos, state.walkAnimationSpeed, 2, 2.5)
    applyAnimationState(model, c, animations.sit, state.sitAnimationState, state.ageInTicks)
    applyAnimationState(model, c, animations.sitPose, state.sitPoseAnimationState, state.ageInTicks)
    applyAnimationState(model, c, animations.standup, state.sitUpAnimationState, state.ageInTicks)
    applyAnimationState(model, c, animations.idle, state.idleAnimationState, state.ageInTicks)
    applyAnimationState(model, c, animations.dash, state.dashAnimationState, state.ageInTicks)
  }

  private applyHeadRotation(state: AnimState, yRot: number, xRot: number) {
    yRot = clamp(yRot, -30, 30)
    xRot = clamp(xRot, -25, 45)
    if (state.jumpCooldown > 0) {
      const headRotation = f(f(45 * state.jumpCooldown) / 55)
      xRot = clamp(f(xRot + headRotation), -25, 70)
    }
    this.head.yRot = f(yRot * DEG_TO_RAD)
    this.head.xRot = f(xRot * DEG_TO_RAD)
  }

  /** before 1.21.5 */
  private toggleInvisibleParts(state: AnimState) {
    const saddled = !!state.isSaddled
    const ridden = !!state.isRidden
    for (const part of this.saddleParts) part.visible = saddled
    for (const part of this.ridingParts) part.visible = ridden && saddled
  }
}

/** AdultCamelModel */
export class AdultCamelModel extends CamelModel {
  protected readonly animations: CamelAnimations = {
    walk: 'CamelAnimation.CAMEL_WALK',
    sit: 'CamelAnimation.CAMEL_SIT',
    sitPose: 'CamelAnimation.CAMEL_SIT_POSE',
    standup: 'CamelAnimation.CAMEL_STANDUP',
    idle: 'CamelAnimation.CAMEL_IDLE',
    dash: 'CamelAnimation.CAMEL_DASH'
  }
}

/** BabyCamelModel */
export class BabyCamelModel extends CamelModel {
  protected readonly animations: CamelAnimations = {
    walk: 'CamelBabyAnimation.CAMEL_BABY_WALK',
    sit: 'CamelBabyAnimation.CAMEL_BABY_SIT',
    sitPose: 'CamelBabyAnimation.CAMEL_BABY_SIT_POSE',
    standup: 'CamelBabyAnimation.CAMEL_BABY_STANDUP',
    idle: 'CamelBabyAnimation.CAMEL_BABY_IDLE',
    dash: 'CamelBabyAnimation.CAMEL_BABY_DASH'
  }
}

/** CamelSaddleModel */
export class CamelSaddleModel extends AdultCamelModel {
  reins = this.part('reins')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.reins.visible = !!state.isRidden
  }
}

/** SnifferModel */
export class SnifferModel extends AnimModel {
  head = this.part('head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { model, c } = this
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    if (state.isSearching) {
      applyWalkAnimation(model, c, 'SnifferAnimation.SNIFFER_SNIFF_SEARCH', state.walkAnimationPos, state.walkAnimationSpeed, 9, 100)
    } else {
      applyWalkAnimation(model, c, 'SnifferAnimation.SNIFFER_WALK', state.walkAnimationPos, state.walkAnimationSpeed, 9, 100)
    }
    applyAnimationState(model, c, 'SnifferAnimation.SNIFFER_DIG', state.diggingAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'SnifferAnimation.SNIFFER_LONGSNIFF', state.sniffingAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'SnifferAnimation.SNIFFER_STAND_UP', state.risingAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'SnifferAnimation.SNIFFER_HAPPY', state.feelingHappyAnimationState, state.ageInTicks)
    applyAnimationState(model, c, 'SnifferAnimation.SNIFFER_SNIFFSNIFF', state.scentingAnimationState, state.ageInTicks)
    // before 26.1 the baby was this model (SniffletModel since)
    if (!c.atLeast('26.1') && state.isBaby) {
      applyStaticAnimation(model, c, 'SnifferAnimation.BABY_TRANSFORM')
    }
  }
}

/** SniffletModel */
export class SniffletModel extends SnifferModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    applyStaticAnimation(this.model, this.c, 'SnifferAnimation.BABY_TRANSFORM')
  }
}

/** The keyframe animations an ArmadilloModel subclass passes its constructor. */
type ArmadilloAnimations = { walk: string; rollOut: string; rollUp: string; peek: string }

/** ArmadilloModel */
export abstract class ArmadilloModel extends AnimModel {
  body = this.part('body')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  head = this.part('head')
  tail = this.part('tail')
  cube = this.part('cube')
  protected abstract readonly animations: ArmadilloAnimations

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { model, c, animations } = this
    if (state.isHidingInShell) {
      this.body.skipDraw = true
      this.leftHindLeg.visible = false
      this.rightHindLeg.visible = false
      this.tail.visible = false
      this.cube.visible = true
    } else {
      this.body.skipDraw = false
      this.leftHindLeg.visible = true
      this.rightHindLeg.visible = true
      this.tail.visible = true
      this.cube.visible = false
      this.head.xRot = f(clamp(state.xRot, -22.5, 25) * DEG_TO_RAD)
      this.head.yRot = f(clamp(state.yRot, -32.5, 32.5) * DEG_TO_RAD)
    }
    // before 26.1 the walk animation played in the shell too
    if (!state.isHidingInShell || !c.atLeast('26.1')) {
      applyWalkAnimation(model, c, animations.walk, state.walkAnimationPos, state.walkAnimationSpeed, 16.5, 2.5)
    }
    applyAnimationState(model, c, animations.rollOut, state.rollOutAnimationState, state.ageInTicks)
    applyAnimationState(model, c, animations.rollUp, state.rollUpAnimationState, state.ageInTicks)
    applyAnimationState(model, c, animations.peek, state.peekAnimationState, state.ageInTicks)
  }
}

/** AdultArmadilloModel */
export class AdultArmadilloModel extends ArmadilloModel {
  protected readonly animations: ArmadilloAnimations = {
    walk: 'ArmadilloAnimation.ARMADILLO_WALK',
    rollOut: 'ArmadilloAnimation.ARMADILLO_ROLL_OUT',
    rollUp: 'ArmadilloAnimation.ARMADILLO_ROLL_UP',
    peek: 'ArmadilloAnimation.ARMADILLO_PEEK'
  }
}

/** BabyArmadilloModel */
export class BabyArmadilloModel extends ArmadilloModel {
  protected readonly animations: ArmadilloAnimations = {
    walk: 'BabyArmadilloAnimation.ARMADILLO_BABY_WALK',
    rollOut: 'BabyArmadilloAnimation.ARMADILLO_BABY_ROLL_OUT',
    rollUp: 'BabyArmadilloAnimation.ARMADILLO_BABY_ROLL_UP',
    peek: 'BabyArmadilloAnimation.ARMADILLO_BABY_PEEK'
  }
}

/** StriderModel */
export abstract class StriderModel extends AnimModel {
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')
  body = this.part('body')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const animationPos = state.walkAnimationPos as number
    const animationSpeed = Math.min(state.walkAnimationSpeed as number, 0.25)
    if (!state.isRidden) {
      this.body.xRot = f(state.xRot * DEG_TO_RAD)
      this.body.yRot = f(state.yRot * DEG_TO_RAD)
    } else {
      this.body.xRot = 0
      this.body.yRot = 0
    }
    const pos = f(animationPos * 1.5)
    const halfPos = f(pos * 0.5)
    this.body.zRot = f(f(f(f(0.1) * sin(pos)) * 4) * animationSpeed)
    this.leftLeg.xRot = f(f(sin(halfPos) * 2) * animationSpeed)
    this.rightLeg.xRot = f(f(sin(f(halfPos + PI)) * 2) * animationSpeed)
    this.leftLeg.zRot = f(f(f(0.174_532_92) * cos(halfPos)) * animationSpeed)
    this.rightLeg.zRot = f(f(f(0.174_532_92) * cos(f(halfPos + PI))) * animationSpeed)
    this.customAnimations(animationPos, animationSpeed, state.ageInTicks)
  }

  protected abstract customAnimations(animationPos: number, animationSpeed: number, ageInTicks: number): void

  animateBristle(ageInTicks: number, bristleFlow: number, firstBristle: PartPose, secondBristle: PartPose, thirdBristle: PartPose, addRotation: (part: PartPose, rotation: number) => void) {
    const { sin } = this.c
    addRotation(firstBristle, f(bristleFlow * f(0.6)))
    addRotation(secondBristle, f(bristleFlow * f(1.2)))
    addRotation(thirdBristle, f(bristleFlow * f(1.3)))
    addRotation(firstBristle, f(f(0.1) * sin(f(ageInTicks * f(0.4)))))
    addRotation(secondBristle, f(f(0.1) * sin(f(ageInTicks * f(0.2)))))
    addRotation(thirdBristle, f(f(0.05) * sin(f(ageInTicks * f(-0.4)))))
  }
}

/** AdultStriderModel */
export class AdultStriderModel extends StriderModel {
  rightBottomBristle = this.part('right_bottom_bristle')
  rightMiddleBristle = this.part('right_middle_bristle')
  rightTopBristle = this.part('right_top_bristle')
  leftTopBristle = this.part('left_top_bristle')
  leftMiddleBristle = this.part('left_middle_bristle')
  leftBottomBristle = this.part('left_bottom_bristle')

  protected customAnimations(animationPos: number, animationSpeed: number, ageInTicks: number) {
    const { sin, cos } = this.c
    this.rightBottomBristle.zRot = f(-1.221_730_5)
    this.rightMiddleBristle.zRot = f(-1.134_464)
    this.rightTopBristle.zRot = f(-0.872_664_63)
    this.leftTopBristle.zRot = f(0.872_664_63)
    this.leftMiddleBristle.zRot = f(1.134_464)
    this.leftBottomBristle.zRot = f(1.221_730_5)
    const pos = f(animationPos * 1.5)
    const bristleFlow = f(cos(f(pos + PI)) * animationSpeed)
    const addZRot = (part: PartPose, rotation: number) => {
      part.zRot = f(part.zRot + rotation)
    }
    this.animateBristle(ageInTicks, bristleFlow, this.rightTopBristle, this.rightMiddleBristle, this.rightBottomBristle, addZRot)
    this.animateBristle(ageInTicks, bristleFlow, this.leftTopBristle, this.leftMiddleBristle, this.leftBottomBristle, addZRot)
    this.body.y = 2
    this.body.y = f(this.body.y - f(f(f(2 * cos(pos)) * 2) * animationSpeed))
    this.leftLeg.y = f(8 + f(f(f(2 * sin(f(f(pos * 0.5) + PI))) * 2) * animationSpeed))
    this.rightLeg.y = f(8 + f(f(f(2 * sin(f(pos * 0.5))) * 2) * animationSpeed))
  }
}

/** BabyStriderModel */
export class BabyStriderModel extends StriderModel {
  frontBristle = this.part('bristle2')
  middleBristle = this.part('bristle1')
  bottomBristle = this.part('bristle0')

  protected customAnimations(animationPos: number, animationSpeed: number, ageInTicks: number) {
    const { sin, cos } = this.c
    const pos = f(animationPos * 1.5)
    this.body.y = 17.25
    this.body.y = f(this.body.y - f(f(f(1 * cos(pos)) * 2) * animationSpeed))
    this.leftLeg.y = f(20 + f(f(f(2 * sin(f(f(pos * 0.5) + PI))) * 2) * animationSpeed))
    this.rightLeg.y = f(20 + f(f(f(2 * sin(f(pos * 0.5))) * 2) * animationSpeed))
    const bristleFlow = f(cos(f(pos + PI)) * animationSpeed)
    this.animateBristle(ageInTicks, bristleFlow, this.frontBristle, this.middleBristle, this.bottomBristle, (part, rotation) => {
      part.xRot = f(part.xRot + rotation)
    })
  }
}

export const EQUINES_MODELS: Record<string, AnimModelClass> = {
  // 1.21.2 - 1.21.11 HorseModel, DonkeyModel and EquineSaddleModel are the same classes (branching on the version)
  HorseModel,
  BabyHorseModel,
  DonkeyModel,
  BabyDonkeyModel,
  EquineSaddleModel,
  // 1.21.2 - 1.21.11: CamelModel (adult and baby, the saddle in it before 1.21.5), ArmadilloModel, StriderModel were the
  // adult models' code (26.1 made them abstract with Adult and Baby subclasses)
  CamelModel: AdultCamelModel,
  ArmadilloModel: AdultArmadilloModel,
  StriderModel: AdultStriderModel,
  AdultCamelModel,
  BabyCamelModel,
  CamelSaddleModel,
  SnifferModel,
  SniffletModel,
  AdultArmadilloModel,
  BabyArmadilloModel,
  AdultStriderModel,
  BabyStriderModel
}
