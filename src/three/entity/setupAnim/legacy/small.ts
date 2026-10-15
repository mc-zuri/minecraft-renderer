import { AnimModel, type AnimModelClass, type AnimState } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, f } from '../mth'

/**
 * The small animals of 1.8.9 - 1.13.2 (legacy Yarn names): wolves, ocelots, rabbits, chickens, parrots (1.12+), bats and
 * squids, posed from the entity: animateModel(entity, limbAngle, limbDistance, tickDelta) then setAngles(limbAngle,
 * limbDistance, age, headYaw, headPitch, scale, entity). Parts are the legacy layer's (field names: field_1562 ...,
 * arrays as field_1547_<n>); rotations are ModelPart.posX/Y/Z, positions pivotX/Y/Z.
 */

/** A synched data value by its index, or the data's default when the sample has none (no data names before 1.14). */
const data = (state: AnimState, index: number, fallback: unknown): any => state[`data.${index}`] ?? fallback

/** an entity field (legacy Yarn name), or its default */
const entity = (state: AnimState, name: string, fallback: unknown): any => state[`entity.${name}`] ?? fallback

/** Entity flags (index 0 in every legacy version): getFlag(index). */
const entityFlag = (state: AnimState, index: number) => ((data(state, 0, 0) as number) & (1 << index)) !== 0

/** 1.8.9 divides by the folded constant 180.0F / (float) Math.PI */
const DEGREES_PER_RADIAN_1_8 = f(180 / PI)

/** EntityModel: animateModel then setAngles, from the initial pose. */
class LegacyEntityModel extends AnimModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    // the render arguments a sample leaves out are 0
    const full = { walkAnimationPos: 0, walkAnimationSpeed: 0, ageInTicks: 0, yRot: 0, xRot: 0, partialTick: 0, ...state }
    this.animateModel(full)
    this.setAngles(full)
  }

  animateModel(_state: AnimState) {}

  setAngles(_state: AnimState) {}

  /** headPitch / headYaw in radians: `x * (float) (Math.PI / 180.0)` (1.9+), `x / (180.0F / (float) Math.PI)` (1.8) */
  radians(degrees: number) {
    return this.c.atLeast('1.9') ? f(degrees * DEG_TO_RAD) : f(degrees / DEGREES_PER_RADIAN_1_8)
  }

  /** TameableEntity's flags (sitting = 1, wolf angry = 2): dataTracker 16 in 1.8, a TrackedData<Byte> after */
  tameableFlags(state: AnimState): number {
    return data(state, this.c.atLeast('1.10') ? 13 : this.c.atLeast('1.9') ? 12 : 16, 0)
  }
}

export class WolfEntityModel extends LegacyEntityModel {
  head = this.part('field_1562')
  body = this.part('field_1563')
  rightHindLeg = this.part('field_1564')
  leftHindLeg = this.part('field_1565')
  rightFrontLeg = this.part('field_1566')
  leftFrontLeg = this.part('field_1567')
  tail = this.part('field_1568')
  mane = this.part('field_1569')

  override animateModel(state: AnimState) {
    const { cos } = this.c
    const limbAngle = state.walkAnimationPos as number
    const limbDistance = state.walkAnimationSpeed as number
    const tickDelta = state.partialTick as number
    const flags = this.tameableFlags(state)
    // isAngry
    if ((flags & 2) !== 0) {
      this.tail.yRot = 0
    } else {
      this.tail.yRot = f(f(cos(f(limbAngle * f(0.6662))) * f(1.4)) * limbDistance)
    }
    // isSitting
    if ((flags & 1) !== 0) {
      this.mane.setPos(-1, 16, -3)
      this.mane.xRot = f((Math.PI * 2) / 5)
      this.mane.yRot = 0
      this.body.setPos(0, 18, 0)
      this.body.xRot = f(Math.PI / 4)
      this.tail.setPos(-1, 21, 6)
      this.rightHindLeg.setPos(-2.5, 22, 2)
      this.rightHindLeg.xRot = f((Math.PI * 3) / 2)
      this.leftHindLeg.setPos(0.5, 22, 2)
      this.leftHindLeg.xRot = f((Math.PI * 3) / 2)
      this.rightFrontLeg.xRot = f(5.811_947)
      this.rightFrontLeg.setPos(f(-2.49), 17, -4)
      this.leftFrontLeg.xRot = f(5.811_947)
      this.leftFrontLeg.setPos(f(0.51), 17, -4)
    } else {
      this.body.setPos(0, 14, 2)
      this.body.xRot = f(Math.PI / 2)
      this.mane.setPos(-1, 14, -3)
      this.mane.xRot = this.body.xRot
      this.tail.setPos(-1, 12, 8)
      this.rightHindLeg.setPos(-2.5, 16, 7)
      this.leftHindLeg.setPos(0.5, 16, 7)
      this.rightFrontLeg.setPos(-2.5, 16, -4)
      this.leftFrontLeg.setPos(0.5, 16, -4)
      this.rightHindLeg.xRot = f(f(cos(f(limbAngle * f(0.6662))) * f(1.4)) * limbDistance)
      this.leftHindLeg.xRot = f(f(cos(f(f(limbAngle * f(0.6662)) + PI)) * f(1.4)) * limbDistance)
      this.rightFrontLeg.xRot = f(f(cos(f(f(limbAngle * f(0.6662)) + PI)) * f(1.4)) * limbDistance)
      this.leftFrontLeg.xRot = f(f(cos(f(limbAngle * f(0.6662))) * f(1.4)) * limbDistance)
    }
    this.head.zRot = f(this.begAnimationProgress(state, tickDelta) + this.shakeAnimationProgress(state, tickDelta, 0))
    this.mane.zRot = this.shakeAnimationProgress(state, tickDelta, f(-0.08))
    this.body.zRot = this.shakeAnimationProgress(state, tickDelta, f(-0.16))
    this.tail.zRot = this.shakeAnimationProgress(state, tickDelta, f(-0.2))
  }

  override setAngles(state: AnimState) {
    this.head.xRot = this.radians(state.xRot)
    this.head.yRot = this.radians(state.yRot)
    // the renderer passes the tail angle as the age
    this.tail.xRot = state.ageInTicks as number
  }

  /** WolfEntity.method_2880 (the begging head tilt): field_3727 / field_3728 = begAnimationProgress and its last tick's */
  begAnimationProgress(state: AnimState, tickDelta: number) {
    const last = entity(state, 'field_3728', 0) as number
    const current = entity(state, 'field_3727', 0) as number
    return f(f(f(last + f(f(current - last) * tickDelta)) * f(0.15)) * PI)
  }

  /** WolfEntity.method_2876 (shaking off water): field_3731 / field_3732 = shake progress and its last tick's */
  shakeAnimationProgress(state: AnimState, tickDelta: number, offset: number) {
    const { sin } = this.c
    const current = entity(state, 'field_3731', 0) as number
    const last = entity(state, 'field_3732', 0) as number
    let h = f(f(f(last + f(f(current - last) * tickDelta)) + offset) / f(1.8))
    if (h < 0) h = 0
    else if (h > 1) h = 1
    return f(f(f(sin(f(h * PI)) * sin(f(f(h * PI) * 11))) * f(0.15)) * PI)
  }
}

export class OcelotEntityModel extends LegacyEntityModel {
  backLeftLeg = this.part('field_1496')
  backRightLeg = this.part('field_1497')
  frontLeftLeg = this.part('field_1498')
  frontRightLeg = this.part('field_1499')
  upperTail = this.part('field_1500')
  lowerTail = this.part('field_1501')
  head = this.part('field_1502')
  body = this.part('field_1503')
  /** field_1504: 0 sneaking, 1 walking, 2 sprinting, 3 sitting (set by animateModel) */
  animationState = 1

  override setAngles(state: AnimState) {
    const { cos } = this.c
    const handSwing = state.walkAnimationPos as number
    const handSwingAmount = state.walkAnimationSpeed as number
    this.head.xRot = this.radians(state.xRot)
    this.head.yRot = this.radians(state.yRot)
    if (this.animationState !== 3) {
      this.body.xRot = f(Math.PI / 2)
      // 1.8 multiplies by 1.0F too (no change to the float)
      if (this.animationState === 2) {
        this.backLeftLeg.xRot = f(cos(f(handSwing * f(0.6662))) * handSwingAmount)
        this.backRightLeg.xRot = f(cos(f(f(handSwing * f(0.6662)) + f(0.3))) * handSwingAmount)
        this.frontLeftLeg.xRot = f(cos(f(f(f(handSwing * f(0.6662)) + PI) + f(0.3))) * handSwingAmount)
        this.frontRightLeg.xRot = f(cos(f(f(handSwing * f(0.6662)) + PI)) * handSwingAmount)
        this.lowerTail.xRot = f(f(1.727_876_1) + f(f(f(f(Math.PI / 10)) * cos(handSwing)) * handSwingAmount))
      } else {
        this.backLeftLeg.xRot = f(cos(f(handSwing * f(0.6662))) * handSwingAmount)
        this.backRightLeg.xRot = f(cos(f(f(handSwing * f(0.6662)) + PI)) * handSwingAmount)
        this.frontLeftLeg.xRot = f(cos(f(f(handSwing * f(0.6662)) + PI)) * handSwingAmount)
        this.frontRightLeg.xRot = f(cos(f(handSwing * f(0.6662))) * handSwingAmount)
        if (this.animationState === 1) {
          this.lowerTail.xRot = f(f(1.727_876_1) + f(f(f(Math.PI / 4) * cos(handSwing)) * handSwingAmount))
        } else {
          this.lowerTail.xRot = f(f(1.727_876_1) + f(f(f(0.471_238_94) * cos(handSwing)) * handSwingAmount))
        }
      }
    }
  }

  override animateModel(state: AnimState) {
    this.body.y = 12
    this.body.z = -10
    this.head.y = 15
    this.head.z = -9
    this.upperTail.y = 15
    this.upperTail.z = 8
    this.lowerTail.y = 20
    this.lowerTail.z = 14
    this.frontLeftLeg.y = f(13.8)
    this.frontLeftLeg.z = -5
    this.frontRightLeg.y = f(13.8)
    this.frontRightLeg.z = -5
    this.backLeftLeg.y = 18
    this.backLeftLeg.z = 5
    this.backRightLeg.y = 18
    this.backRightLeg.z = 5
    this.upperTail.xRot = f(0.9)
    if (entityFlag(state, 1)) {
      // isSneaking
      this.body.y = f(this.body.y + 1)
      this.head.y = f(this.head.y + 2)
      this.upperTail.y = f(this.upperTail.y + 1)
      this.lowerTail.y = f(this.lowerTail.y + -4)
      this.lowerTail.z = f(this.lowerTail.z + 2)
      this.upperTail.xRot = f(Math.PI / 2)
      this.lowerTail.xRot = f(Math.PI / 2)
      this.animationState = 0
    } else if (entityFlag(state, 3)) {
      // isSprinting
      this.lowerTail.y = this.upperTail.y
      this.lowerTail.z = f(this.lowerTail.z + 2)
      this.upperTail.xRot = f(Math.PI / 2)
      this.lowerTail.xRot = f(Math.PI / 2)
      this.animationState = 2
    } else if ((this.tameableFlags(state) & 1) !== 0) {
      // isSitting
      this.body.xRot = f(Math.PI / 4)
      this.body.y = f(this.body.y + -4)
      this.body.z = f(this.body.z + 5)
      this.head.y = f(this.head.y + f(-3.3))
      this.head.z = f(this.head.z + 1)
      this.upperTail.y = f(this.upperTail.y + 8)
      this.upperTail.z = f(this.upperTail.z + -2)
      this.lowerTail.y = f(this.lowerTail.y + 2)
      this.lowerTail.z = f(this.lowerTail.z + f(-0.8))
      this.upperTail.xRot = f(1.727_876_1)
      this.lowerTail.xRot = f(2.670_354)
      this.frontLeftLeg.xRot = f(-Math.PI / 20)
      this.frontLeftLeg.y = f(15.8)
      this.frontLeftLeg.z = -7
      this.frontRightLeg.xRot = f(-Math.PI / 20)
      this.frontRightLeg.y = f(15.8)
      this.frontRightLeg.z = -7
      this.backLeftLeg.xRot = f(-Math.PI / 2)
      this.backLeftLeg.y = 21
      this.backLeftLeg.z = 1
      this.backRightLeg.xRot = f(-Math.PI / 2)
      this.backRightLeg.y = 21
      this.backRightLeg.z = 1
      this.animationState = 3
    } else {
      this.animationState = 1
    }
  }
}

export class RabbitEntityModel extends LegacyEntityModel {
  leftFoot = this.part('field_10568')
  rightFoot = this.part('field_10569')
  leftBackLeg = this.part('field_10570')
  rightBackLeg = this.part('field_10571')
  leftFrontLeg = this.part('field_10573')
  rightFrontLeg = this.part('field_10574')
  head = this.part('field_10575')
  rightEar = this.part('field_10576')
  leftEar = this.part('field_10577')
  nose = this.part('field_10579')
  /** field_10580: the jump's leg swing */
  jumpSwing = 0

  /** RabbitEntity.getJumpProgress(delta) */
  jumpProgress(state: AnimState, delta: number) {
    const jumpDuration = entity(state, 'jumpDuration', 0) as number
    const jumpTicks = entity(state, 'jumpTicks', 0) as number
    return jumpDuration === 0 ? 0 : f(f(jumpTicks + delta) / jumpDuration)
  }

  override animateModel(state: AnimState) {
    // 1.9+: the same swing setAngles computes again (from the age)
    if (this.c.atLeast('1.9')) this.jumpSwing = this.c.sin(f(this.jumpProgress(state, state.partialTick) * PI))
  }

  override setAngles(state: AnimState) {
    const { sin } = this.c
    // tickDelta - entity.ticksAlive
    const l = f(state.ageInTicks - (entity(state, 'ticksAlive', 0) as number))
    // (already `* (float) (Math.PI / 180.0)` in 1.8)
    const headPitch = f(state.xRot * DEG_TO_RAD)
    const headYaw = f(state.yRot * DEG_TO_RAD)
    this.nose.xRot = headPitch
    this.head.xRot = headPitch
    this.rightEar.xRot = headPitch
    this.leftEar.xRot = headPitch
    this.nose.yRot = headYaw
    this.head.yRot = headYaw
    this.rightEar.yRot = f(this.nose.yRot - f(Math.PI / 12))
    this.leftEar.yRot = f(this.nose.yRot + f(Math.PI / 12))
    this.jumpSwing = sin(f(this.jumpProgress(state, l) * PI))
    const backLeg = f(f(f(this.jumpSwing * 50) - 21) * DEG_TO_RAD)
    this.leftBackLeg.xRot = backLeg
    this.rightBackLeg.xRot = backLeg
    const foot = f(f(this.jumpSwing * 50) * DEG_TO_RAD)
    this.leftFoot.xRot = foot
    this.rightFoot.xRot = foot
    const frontLeg = f(f(f(this.jumpSwing * -40) - 11) * DEG_TO_RAD)
    this.leftFrontLeg.xRot = frontLeg
    this.rightFrontLeg.xRot = frontLeg
  }
}

export class ChickenEntityModel extends LegacyEntityModel {
  head = this.part('head')
  torso = this.part('torso')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')
  beak = this.part('beak')
  wattle = this.part('wattle')

  override setAngles(state: AnimState) {
    const { cos } = this.c
    const handSwing = state.walkAnimationPos as number
    const handSwingAmount = state.walkAnimationSpeed as number
    this.head.xRot = this.radians(state.xRot)
    this.head.yRot = this.radians(state.yRot)
    this.beak.xRot = this.head.xRot
    this.beak.yRot = this.head.yRot
    this.wattle.xRot = this.head.xRot
    this.wattle.yRot = this.head.yRot
    this.torso.xRot = f(Math.PI / 2)
    this.rightLeg.xRot = f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount)
    this.leftLeg.xRot = f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount)
    // the renderer passes the wing flap as the age
    this.rightWing.zRot = state.ageInTicks as number
    this.leftWing.zRot = -state.ageInTicks
  }
}

/** ParrotEntityModel (1.12+): its pose (1.12.2 returns early where 1.13.2 nests; same result for a parrot entity) */
export class ParrotEntityModel extends LegacyEntityModel {
  body = this.part('field_16094')
  tail = this.part('field_16095')
  leftWing = this.part('field_16096')
  rightWing = this.part('field_16097')
  head = this.part('field_16098')
  feather = this.part('field_16102')
  leftLeg = this.part('field_16103')
  rightLeg = this.part('field_16104')
  pose: 'FLYING' | 'STANDING' | 'SITTING' | 'PARTY' | 'ON_SHOULDER' = 'STANDING'

  override setAngles(state: AnimState) {
    const { sin, cos } = this.c
    const handSwing = state.walkAnimationPos as number
    const handSwingAmount = state.walkAnimationSpeed as number
    const tickDelta = state.ageInTicks as number
    const l = f(tickDelta * f(0.3))
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.zRot = 0
    this.head.x = 0
    this.body.x = 0
    this.tail.x = 0
    this.rightWing.x = -1.5
    this.leftWing.x = 1.5
    if (this.pose !== 'SITTING') {
      if (this.pose === 'PARTY') {
        const ticksAlive = entity(state, 'ticksAlive', 0) as number
        const m = cos(ticksAlive)
        const n = sin(ticksAlive)
        this.head.x = m
        this.head.y = f(f(15.69) + n)
        this.head.xRot = 0
        this.head.yRot = 0
        this.head.zRot = f(sin(ticksAlive) * f(0.4))
        this.body.x = m
        this.body.y = f(16.5 + n)
        this.leftWing.zRot = f(f(-0.0873) - tickDelta)
        this.leftWing.x = f(1.5 + m)
        this.leftWing.y = f(f(16.94) + n)
        this.rightWing.zRot = f(f(0.0873) + tickDelta)
        this.rightWing.x = f(-1.5 + m)
        this.rightWing.y = f(f(16.94) + n)
        this.tail.x = m
        this.tail.y = f(f(21.07) + n)
      } else {
        if (this.pose === 'STANDING') {
          this.leftLeg.xRot = f(this.leftLeg.xRot + f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount))
          this.rightLeg.xRot = f(this.rightLeg.xRot + f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount))
        }
        this.head.y = f(f(15.69) + l)
        this.tail.xRot = f(f(1.015) + f(f(cos(f(handSwing * f(0.6662))) * f(0.3)) * handSwingAmount))
        this.tail.y = f(f(21.07) + l)
        this.body.y = f(16.5 + l)
        this.leftWing.zRot = f(f(-0.0873) - tickDelta)
        this.leftWing.y = f(f(16.94) + l)
        this.rightWing.zRot = f(f(0.0873) + tickDelta)
        this.rightWing.y = f(f(16.94) + l)
        this.leftLeg.y = f(22 + l)
        this.rightLeg.y = f(22 + l)
      }
    }
  }

  override animateModel(state: AnimState) {
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
    // method_14106: dancing to a jukebox (field_15567)
    if (entity(state, 'field_15567', false)) {
      this.leftLeg.zRot = f(-Math.PI / 9)
      this.rightLeg.zRot = f(Math.PI / 9)
      this.pose = 'PARTY'
      return
    }
    if ((this.tameableFlags(state) & 1) !== 0) {
      // isSitting
      this.head.y = f(17.59)
      this.tail.xRot = f(1.538_898_8)
      this.tail.y = f(22.97)
      this.body.y = f(18.4)
      this.leftWing.zRot = f(-0.0873)
      this.leftWing.y = f(18.84)
      this.rightWing.zRot = f(0.0873)
      this.rightWing.y = f(18.84)
      // the decompiler prints `++` for these: the bytecode adds the local 1.9F and HALF_PI
      this.leftLeg.y = f(this.leftLeg.y + f(1.9))
      this.rightLeg.y = f(this.rightLeg.y + f(1.9))
      this.leftLeg.xRot = f(this.leftLeg.xRot + HALF_PI)
      this.rightLeg.xRot = f(this.rightLeg.xRot + HALF_PI)
      this.pose = 'SITTING'
    } else if (!entity(state, 'onGround', false)) {
      // method_14101: in the air
      this.leftLeg.xRot = f(this.leftLeg.xRot + f((Math.PI * 2) / 9))
      this.rightLeg.xRot = f(this.rightLeg.xRot + f((Math.PI * 2) / 9))
      this.pose = 'FLYING'
    } else {
      this.pose = 'STANDING'
    }
    this.leftLeg.zRot = 0
    this.rightLeg.zRot = 0
  }
}

export class BatEntityModel extends LegacyEntityModel {
  head = this.part('head')
  body = this.part('body')
  rightWing = this.part('right_wing')
  leftWing = this.part('left_wing')
  rightWingTip = this.part('right_wing_tip')
  leftWingTip = this.part('left_wing_tip')

  override setAngles(state: AnimState) {
    const { cos } = this.c
    const tickDelta = state.ageInTicks as number
    // isRoosting: the bat's flags (dataTracker 16 in 1.8, a TrackedData<Byte> after)
    const flags = data(state, this.c.atLeast('1.10') ? 12 : this.c.atLeast('1.9') ? 11 : 16, 0) as number
    if ((flags & 1) !== 0) {
      this.head.xRot = this.radians(state.xRot)
      this.head.yRot = f(PI - this.radians(state.yRot))
      this.head.zRot = PI
      this.head.setPos(0, -2, 0)
      this.rightWing.setPos(-3, 0, 3)
      this.leftWing.setPos(3, 0, 3)
      this.body.xRot = PI
      this.rightWing.xRot = f(-Math.PI / 20)
      this.rightWing.yRot = f((-Math.PI * 2) / 5)
      this.rightWingTip.yRot = f(-1.727_876_1)
      this.leftWing.xRot = this.rightWing.xRot
      this.leftWing.yRot = -this.rightWing.yRot
      this.leftWingTip.yRot = -this.rightWingTip.yRot
    } else {
      this.head.xRot = this.radians(state.xRot)
      this.head.yRot = this.radians(state.yRot)
      this.head.zRot = 0
      this.head.setPos(0, 0, 0)
      this.rightWing.setPos(0, 0, 0)
      this.leftWing.setPos(0, 0, 0)
      this.body.xRot = f(f(Math.PI / 4) + f(cos(f(tickDelta * f(0.1))) * f(0.15)))
      this.body.yRot = 0
      this.rightWing.yRot = f(f(cos(f(tickDelta * f(1.3))) * PI) * 0.25)
      this.leftWing.yRot = -this.rightWing.yRot
      this.rightWingTip.yRot = f(this.rightWing.yRot * 0.5)
      this.leftWingTip.yRot = f(-this.rightWing.yRot * 0.5)
    }
  }
}

export class SquidEntityModel extends LegacyEntityModel {
  tentacles = Array.from({ length: 8 }, (_, i) => this.part(`field_1547_${i}`))

  override setAngles(state: AnimState) {
    for (const tentacle of this.tentacles) tentacle.xRot = state.ageInTicks as number
  }
}

export const LEGACY_SMALL_MODELS: Record<string, AnimModelClass> = {
  WolfEntityModel,
  OcelotEntityModel,
  RabbitEntityModel,
  ChickenEntityModel,
  ParrotEntityModel,
  BatEntityModel,
  SquidEntityModel
}
