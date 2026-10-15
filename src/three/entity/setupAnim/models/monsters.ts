import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, clamp, f, rotLerp, wrapDegrees } from '../mth'
import { HumanoidModel } from './humanoid'

/**
 * Monsters (creeper, enderman, spider, slimes, blaze, ghasts, phantom, silverfish, endermite, shulker, wither, ender
 * dragon), 26.3.
 */

export class CreeperModel extends AnimModel {
  head = this.part('head')
  // the game's fields are crossed: its leftHindLeg is the right_hind_leg part and so on
  leftHindLeg = this.part('right_hind_leg')
  rightHindLeg = this.part('left_hind_leg')
  leftFrontLeg = this.part('right_front_leg')
  rightFrontLeg = this.part('left_front_leg')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    this.rightHindLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
    this.leftHindLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
    this.rightFrontLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
    this.leftFrontLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
  }
}

/**
 * EndermanModel. `state.carriedBlock` (not in the fixture; EndermanRenderState.carriedBlock is a BlockModelRenderState):
 * truthy while the enderman carries a block, which the renderer must provide; absent = empty hands.
 */
export class EndermanModel extends HumanoidModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.head.visible = true
    this.rightArm.xRot = f(this.rightArm.xRot * 0.5)
    this.leftArm.xRot = f(this.leftArm.xRot * 0.5)
    this.rightLeg.xRot = f(this.rightLeg.xRot * 0.5)
    this.leftLeg.xRot = f(this.leftLeg.xRot * 0.5)
    const max = f(0.4)
    this.rightArm.xRot = clamp(this.rightArm.xRot, -max, max)
    this.leftArm.xRot = clamp(this.leftArm.xRot, -max, max)
    this.rightLeg.xRot = clamp(this.rightLeg.xRot, -max, max)
    this.leftLeg.xRot = clamp(this.leftLeg.xRot, -max, max)
    if (state.carriedBlock) {
      this.rightArm.xRot = -0.5
      this.leftArm.xRot = -0.5
      this.rightArm.zRot = f(0.05)
      this.leftArm.zRot = f(-0.05)
    }
    if (state.isCreepy) {
      this.head.y = f(this.head.y - 5)
      this.hat!.y = f(this.hat!.y + 5)
    }
  }
}

export class SpiderModel extends AnimModel {
  head = this.part('head')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  rightMiddleHindLeg = this.part('right_middle_hind_leg')
  leftMiddleHindLeg = this.part('left_middle_hind_leg')
  rightMiddleFrontLeg = this.part('right_middle_front_leg')
  leftMiddleFrontLeg = this.part('left_middle_front_leg')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    const animationPos = f(state.walkAnimationPos * f(0.6662))
    const animationSpeed = state.walkAnimationSpeed as number
    const swing = (offset: number) => f(-f(cos(f(f(animationPos * 2) + offset)) * f(0.4)) * animationSpeed)
    const step = (offset: number) => f(Math.abs(f(sin(f(animationPos + offset)) * f(0.4))) * animationSpeed)
    const swingHind = swing(0)
    const swingMiddleHind = swing(PI)
    const swingMiddleFront = swing(f(1.570_796_4))
    const swingFront = swing(f(4.712_389))
    const stepHind = step(0)
    const stepMiddleHind = step(PI)
    const stepMiddleFrontHind = step(f(1.570_796_4))
    const stepFront = step(f(4.712_389))
    this.rightHindLeg.yRot = f(this.rightHindLeg.yRot + swingHind)
    this.leftHindLeg.yRot = f(this.leftHindLeg.yRot - swingHind)
    this.rightMiddleHindLeg.yRot = f(this.rightMiddleHindLeg.yRot + swingMiddleHind)
    this.leftMiddleHindLeg.yRot = f(this.leftMiddleHindLeg.yRot - swingMiddleHind)
    this.rightMiddleFrontLeg.yRot = f(this.rightMiddleFrontLeg.yRot + swingMiddleFront)
    this.leftMiddleFrontLeg.yRot = f(this.leftMiddleFrontLeg.yRot - swingMiddleFront)
    this.rightFrontLeg.yRot = f(this.rightFrontLeg.yRot + swingFront)
    this.leftFrontLeg.yRot = f(this.leftFrontLeg.yRot - swingFront)
    this.rightHindLeg.zRot = f(this.rightHindLeg.zRot + stepHind)
    this.leftHindLeg.zRot = f(this.leftHindLeg.zRot - stepHind)
    this.rightMiddleHindLeg.zRot = f(this.rightMiddleHindLeg.zRot + stepMiddleHind)
    this.leftMiddleHindLeg.zRot = f(this.leftMiddleHindLeg.zRot - stepMiddleHind)
    this.rightMiddleFrontLeg.zRot = f(this.rightMiddleFrontLeg.zRot + stepMiddleFrontHind)
    this.leftMiddleFrontLeg.zRot = f(this.leftMiddleFrontLeg.zRot - stepMiddleFrontHind)
    this.rightFrontLeg.zRot = f(this.rightFrontLeg.zRot + stepFront)
    this.leftFrontLeg.zRot = f(this.leftFrontLeg.zRot - stepFront)
  }
}

export class MagmaCubeModel extends AnimModel {
  bodyCubes = Array.from({ length: 8 }, (_, i) => this.part(`cube${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const slimeSquish = Math.max(0, state.squish as number)
    for (let i = 0; i < this.bodyCubes.length; i++) {
      // (float) -(4 - i), written i - 4 so that i = 4 gives 0 rather than -0
      this.bodyCubes[i]!.y = f(f((i - 4) * slimeSquish) * f(1.7))
    }
  }
}

export class BlazeModel extends AnimModel {
  head = this.part('head')
  upperBodyParts = Array.from({ length: 12 }, (_, i) => this.part(`part${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const ageInTicks = state.ageInTicks as number
    // the decompiled source reads ++angle, but the game's poses (the fixture) step each rod a quarter turn: HALF_PI
    let angle = f(f(ageInTicks * PI) * f(-0.1))
    for (let i = 0; i < 4; i++) {
      const part = this.upperBodyParts[i]!
      part.y = f(-2 + cos(f(f(i * 2 + ageInTicks) * 0.25)))
      part.x = f(cos(angle) * 9)
      part.z = f(sin(angle) * 9)
      angle = f(angle + HALF_PI)
    }
    angle = f(f(0.785_398_2) + f(f(ageInTicks * PI) * f(0.03)))
    for (let i = 4; i < 8; i++) {
      const part = this.upperBodyParts[i]!
      part.y = f(2 + cos(f(f(i * 2 + ageInTicks) * 0.25)))
      part.x = f(cos(angle) * 7)
      part.z = f(sin(angle) * 7)
      angle = f(angle + HALF_PI)
    }
    angle = f(f(0.471_238_94) + f(f(ageInTicks * PI) * f(-0.05)))
    for (let i = 8; i < 12; i++) {
      const part = this.upperBodyParts[i]!
      part.y = f(11 + cos(f(f(f(i * 1.5) + ageInTicks) * 0.5)))
      part.x = f(cos(angle) * 5)
      part.z = f(sin(angle) * 5)
      angle = f(angle + HALF_PI)
    }
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
  }
}

/** GhastModel.animateTentacles */
const animateTentacles = (m: AnimModel, state: AnimState, tentacles: PartPose[]) => {
  const { sin } = m.c
  for (let i = 0; i < tentacles.length; i++) {
    tentacles[i]!.xRot = f(f(f(0.2) * sin(f(f(state.ageInTicks * f(0.3)) + i))) + f(0.4))
  }
}

export class GhastModel extends AnimModel {
  tentacles = Array.from({ length: 9 }, (_, i) => this.part(`tentacle${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    animateTentacles(this, state, this.tentacles)
  }
}

/**
 * HappyGhastModel. `state.bodyItem` (not in the fixture; HappyGhastRenderState.bodyItem is an ItemStack): truthy while the
 * happy ghast wears a body item (a harness), which the renderer must provide; absent = none.
 */
export class HappyGhastModel extends AnimModel {
  body = this.part('body')
  tentacles = Array.from({ length: 9 }, (_, i) => this.part(`body/tentacle${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    if (state.bodyItem) {
      this.body.xScale = f(0.9375)
      this.body.yScale = f(0.9375)
      this.body.zScale = f(0.9375)
    }
    animateTentacles(this, state, this.tentacles)
  }
}

export class HappyGhastHarnessModel extends AnimModel {
  goggles = this.part('goggles')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    if (state.isRidden) {
      this.goggles.xRot = 0
      this.goggles.y = 14
    } else {
      this.goggles.xRot = f(-0.7854)
      this.goggles.y = 9
    }
  }
}

export class PhantomModel extends AnimModel {
  tailBase = this.part('tail_base')
  tailTip = this.part('tail_tip')
  leftWingBase = this.part('left_wing_base')
  leftWingTip = this.part('left_wing_tip')
  rightWingBase = this.part('right_wing_base')
  rightWingTip = this.part('right_wing_tip')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const anim = f(f(state.flapTime * f(7.448_451)) * DEG_TO_RAD)
    this.leftWingBase.zRot = f(f(cos(anim) * 16) * DEG_TO_RAD)
    this.leftWingTip.zRot = f(f(cos(anim) * 16) * DEG_TO_RAD)
    this.rightWingBase.zRot = -this.leftWingBase.zRot
    this.rightWingTip.zRot = -this.leftWingTip.zRot
    this.tailBase.xRot = f(-f(5 + f(cos(f(anim * 2)) * 5)) * DEG_TO_RAD)
    this.tailTip.xRot = f(-f(5 + f(cos(f(anim * 2)) * 5)) * DEG_TO_RAD)
  }
}

export class SilverfishModel extends AnimModel {
  bodyParts = Array.from({ length: 7 }, (_, i) => this.part(`segment${i}`))
  bodyLayers = Array.from({ length: 3 }, (_, i) => this.part(`layer${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    for (let i = 0; i < this.bodyParts.length; i++) {
      const t = f(f(state.ageInTicks * f(0.9)) + f(f(i * f(0.15)) * PI))
      this.bodyParts[i]!.yRot = f(f(f(cos(t) * PI) * f(0.05)) * (1 + Math.abs(i - 2)))
      this.bodyParts[i]!.x = f(f(f(sin(t) * PI) * f(0.2)) * Math.abs(i - 2))
    }
    this.bodyLayers[0]!.yRot = this.bodyParts[2]!.yRot
    this.bodyLayers[1]!.yRot = this.bodyParts[4]!.yRot
    this.bodyLayers[1]!.x = this.bodyParts[4]!.x
    this.bodyLayers[2]!.yRot = this.bodyParts[1]!.yRot
    this.bodyLayers[2]!.x = this.bodyParts[1]!.x
  }
}

export class EndermiteModel extends AnimModel {
  bodyParts = Array.from({ length: 4 }, (_, i) => this.part(`segment${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    for (let i = 0; i < this.bodyParts.length; i++) {
      const t = f(f(state.ageInTicks * f(0.9)) + f(f(i * f(0.15)) * PI))
      this.bodyParts[i]!.yRot = f(f(f(cos(t) * PI) * f(0.01)) * (1 + Math.abs(i - 2)))
      this.bodyParts[i]!.x = f(f(f(sin(t) * PI) * f(0.1)) * Math.abs(i - 2))
    }
  }
}

export class ShulkerModel extends AnimModel {
  lid = this.part('lid')
  head = this.part('head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin } = this.c
    const peekAmount = state.peekAmount as number
    const bs = f(f(0.5 + peekAmount) * PI)
    const q = f(-1 + sin(bs))
    let extra = 0
    if (bs > PI) extra = f(sin(f(state.ageInTicks * f(0.1))) * f(0.7))
    this.lid.setPos(0, f(f(16 + f(sin(bs) * 8)) + extra), 0)
    if (peekAmount > f(0.3)) this.lid.yRot = f(f(f(f(f(q * q) * q) * q) * PI) * f(0.125))
    else this.lid.yRot = 0
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(f(f(state.yHeadRot - 180) - state.yBodyRot) * DEG_TO_RAD)
  }
}

export class ShulkerBulletModel extends AnimModel {
  main = this.part('main')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.main.yRot = f(state.yRot * DEG_TO_RAD)
    this.main.xRot = f(state.xRot * DEG_TO_RAD)
  }
}

/**
 * WitherBossModel. `state.xHeadRots` / `state.yHeadRots` (WitherRenderState's float[2] arrays, not in the fixture): the
 * side heads' pitch and yaw in degrees, [right, left], which the renderer must provide; absent = [0, 0] (the game's
 * initial values).
 */
export class WitherBossModel extends AnimModel {
  ribcage = this.part('ribcage')
  tail = this.part('tail')
  centerHead = this.part('center_head')
  rightHead = this.part('right_head')
  leftHead = this.part('left_head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    WitherBossModel.setupHeadRotation(state, this.rightHead, 0)
    WitherBossModel.setupHeadRotation(state, this.leftHead, 1)
    const anim = cos(f(state.ageInTicks * f(0.1)))
    this.ribcage.xRot = f(f(f(0.065) + f(f(0.05) * anim)) * PI)
    this.tail.setPos(-2, f(f(6.9) + f(cos(this.ribcage.xRot) * 10)), f(-0.5 + f(sin(this.ribcage.xRot) * 10)))
    this.tail.xRot = f(f(f(0.265) + f(f(0.1) * anim)) * PI)
    this.centerHead.yRot = f(state.yRot * DEG_TO_RAD)
    this.centerHead.xRot = f(state.xRot * DEG_TO_RAD)
  }

  static setupHeadRotation(state: AnimState, head: PartPose, headIndex: number) {
    const yHeadRot = f(state.yHeadRots?.[headIndex] ?? 0)
    const xHeadRot = f(state.xHeadRots?.[headIndex] ?? 0)
    head.yRot = f(f(yHeadRot - state.bodyRot) * DEG_TO_RAD)
    head.xRot = f(xHeadRot * DEG_TO_RAD)
  }
}

/** DragonFlightHistory.Sample: y is a double, yRot a float. */
type DragonSample = { y: number; yRot: number }

/**
 * DragonFlightHistory, as the renderer gives it in `state.flightHistory` (not in the fixture): the 64 recorded samples
 * ({ y, yRot }, the dragon's y and yaw each tick) and the index of the latest one; absent = the game's new history (64
 * zero samples, head -1).
 */
export type DragonFlightHistory = { samples: DragonSample[]; head: number }

const ZERO_SAMPLE: DragonSample = { y: 0, yRot: 0 }

/**
 * EnderDragonModel. Besides `state.flightHistory` (see DragonFlightHistory), `state.distanceToEgg` (a double, not in the
 * fixture) is read while landing or taking off; absent = 0 (the game's initial value).
 */
export class EnderDragonModel extends AnimModel {
  head = this.part('head')
  jaw = this.part('jaw')
  neckParts = Array.from({ length: 5 }, (_, i) => this.part(`neck${i}`))
  tailParts = Array.from({ length: 12 }, (_, i) => this.part(`tail${i}`))
  body = this.part('body')
  leftWing = this.part('left_wing')
  leftWingTip = this.part('left_wing_tip')
  leftFrontLeg = this.part('left_front_leg')
  leftFrontLegTip = this.part('left_front_leg_tip')
  leftFrontFoot = this.part('left_front_foot')
  leftRearLeg = this.part('left_hind_leg')
  leftRearLegTip = this.part('left_hind_leg_tip')
  leftRearFoot = this.part('left_hind_foot')
  rightWing = this.part('right_wing')
  rightWingTip = this.part('right_wing_tip')
  rightFrontLeg = this.part('right_front_leg')
  rightFrontLegTip = this.part('right_front_leg_tip')
  rightFrontFoot = this.part('right_front_foot')
  rightRearLeg = this.part('right_hind_leg')
  rightRearLegTip = this.part('right_hind_leg_tip')
  rightRearFoot = this.part('right_hind_foot')

  /** EnderDragonRenderState.getHistoricalPos: DragonFlightHistory.get(delay, partialTicks). */
  static getHistoricalPos(state: AnimState, delay: number): DragonSample {
    const history = state.flightHistory as DragonFlightHistory | undefined
    const get = (d: number) => (history ? (history.samples[(history.head - d) & 63] ?? ZERO_SAMPLE) : ZERO_SAMPLE)
    const sample = get(delay)
    const sampleOld = get(delay + 1)
    const partialTicks = state.partialTicks as number
    return { y: sampleOld.y + partialTicks * (sample.y - sampleOld.y), yRot: rotLerp(partialTicks, f(sampleOld.yRot), f(sample.yRot)) }
  }

  /** EnderDragonRenderState.getHeadPartYOffset */
  static getHeadPartYOffset(state: AnimState, part: number, bodyPos: DragonSample, partPos: DragonSample) {
    let result: number
    if (state.isLandingOrTakingOff) result = part / Math.max((state.distanceToEgg ?? 0) / 4, 1)
    else if (state.isSitting) result = part
    else if (part === 6) result = 0
    else result = partPos.y - bodyPos.y
    return f(result)
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const root = this.model.root
    const flapTime = f(state.flapTime * f(6.283_185_5))
    this.jaw.xRot = f(f(sin(flapTime) + 1) * f(0.2))
    let bounce = f(sin(f(flapTime - 1)) + 1)
    bounce = f(f(f(bounce * bounce) + f(bounce * 2)) * f(0.05))
    root.y = f(f(bounce - 2) * 16)
    root.z = -48
    root.xRot = f(f(bounce * 2) * DEG_TO_RAD)
    let xx = this.neckParts[0]!.x
    let yy = this.neckParts[0]!.y
    let zz = this.neckParts[0]!.z
    const rotScale = 1.5
    let start = EnderDragonModel.getHistoricalPos(state, 6)
    const rot2 = wrapDegrees(f(EnderDragonModel.getHistoricalPos(state, 5).yRot - EnderDragonModel.getHistoricalPos(state, 10).yRot))
    const rot = wrapDegrees(f(EnderDragonModel.getHistoricalPos(state, 5).yRot + f(rot2 / 2)))
    for (let i = 0; i < 5; i++) {
      const neck = this.neckParts[i]!
      const point = EnderDragonModel.getHistoricalPos(state, 5 - i)
      const neckXRot = f(cos(f(f(i * f(0.45)) + flapTime)) * f(0.15))
      neck.yRot = f(f(wrapDegrees(f(point.yRot - start.yRot)) * DEG_TO_RAD) * rotScale)
      neck.xRot = f(neckXRot + f(f(f(EnderDragonModel.getHeadPartYOffset(state, i, start, point) * DEG_TO_RAD) * rotScale) * 5))
      neck.zRot = f(f(-wrapDegrees(f(point.yRot - rot)) * DEG_TO_RAD) * rotScale)
      neck.y = yy
      neck.z = zz
      neck.x = xx
      xx = f(xx - f(f(sin(neck.yRot) * cos(neck.xRot)) * 10))
      yy = f(yy + f(sin(neck.xRot) * 10))
      zz = f(zz - f(f(cos(neck.yRot) * cos(neck.xRot)) * 10))
    }
    this.head.y = yy
    this.head.z = zz
    this.head.x = xx
    const current = EnderDragonModel.getHistoricalPos(state, 0)
    this.head.yRot = f(wrapDegrees(f(current.yRot - start.yRot)) * DEG_TO_RAD)
    this.head.xRot = f(f(f(wrapDegrees(EnderDragonModel.getHeadPartYOffset(state, 6, start, current)) * DEG_TO_RAD) * rotScale) * 5)
    this.head.zRot = f(-wrapDegrees(f(current.yRot - rot)) * DEG_TO_RAD)
    this.body.zRot = f(f(-rot2 * rotScale) * DEG_TO_RAD)
    this.leftWing.xRot = f(0.125 - f(cos(flapTime) * f(0.2)))
    this.leftWing.yRot = -0.25
    this.leftWing.zRot = f(-f(sin(flapTime) + 0.125) * f(0.8))
    this.leftWingTip.zRot = f(f(sin(f(flapTime + 2)) + 0.5) * f(0.75))
    this.rightWing.xRot = this.leftWing.xRot
    this.rightWing.yRot = -this.leftWing.yRot
    this.rightWing.zRot = -this.leftWing.zRot
    this.rightWingTip.zRot = -this.leftWingTip.zRot
    this.poseLimbs(bounce, this.leftFrontLeg, this.leftFrontLegTip, this.leftFrontFoot, this.leftRearLeg, this.leftRearLegTip, this.leftRearFoot)
    this.poseLimbs(bounce, this.rightFrontLeg, this.rightFrontLegTip, this.rightFrontFoot, this.rightRearLeg, this.rightRearLegTip, this.rightRearFoot)
    let tailXRot = 0
    yy = this.tailParts[0]!.y
    zz = this.tailParts[0]!.z
    xx = this.tailParts[0]!.x
    start = EnderDragonModel.getHistoricalPos(state, 11)
    for (let i = 0; i < 12; i++) {
      const point = EnderDragonModel.getHistoricalPos(state, 12 + i)
      tailXRot = f(tailXRot + f(sin(f(f(i * f(0.45)) + flapTime)) * f(0.05)))
      const tail = this.tailParts[i]!
      tail.yRot = f(f(f(wrapDegrees(f(point.yRot - start.yRot)) * rotScale) + 180) * DEG_TO_RAD)
      tail.xRot = f(tailXRot + f(f(f(f(point.y - start.y) * DEG_TO_RAD) * rotScale) * 5))
      tail.zRot = f(f(wrapDegrees(f(point.yRot - rot)) * DEG_TO_RAD) * rotScale)
      tail.y = yy
      tail.z = zz
      tail.x = xx
      yy = f(yy + f(sin(tail.xRot) * 10))
      zz = f(zz - f(f(cos(tail.yRot) * cos(tail.xRot)) * 10))
      xx = f(xx - f(f(sin(tail.yRot) * cos(tail.xRot)) * 10))
    }
  }

  poseLimbs(bounce: number, frontLeg: PartPose, frontLegTip: PartPose, frontFoot: PartPose, rearLeg: PartPose, rearLegTip: PartPose, rearFoot: PartPose) {
    rearLeg.xRot = f(1 + f(bounce * f(0.1)))
    rearLegTip.xRot = f(0.5 + f(bounce * f(0.1)))
    rearFoot.xRot = f(0.75 + f(bounce * f(0.1)))
    frontLeg.xRot = f(f(1.3) + f(bounce * f(0.1)))
    frontLegTip.xRot = f(-0.5 - f(bounce * f(0.1)))
    frontFoot.xRot = f(0.75 + f(bounce * f(0.1)))
  }
}

export const MONSTERS_MODELS: Record<string, AnimModelClass> = {
  CreeperModel,
  EndermanModel,
  SpiderModel,
  SlimeModel: AnimModel,
  MagmaCubeModel,
  SulfurCubeModel: AnimModel,
  SmallSulfurCubeModel: AnimModel,
  BlazeModel,
  GhastModel,
  HappyGhastModel,
  HappyGhastHarnessModel,
  PhantomModel,
  SilverfishModel,
  EndermiteModel,
  ShulkerModel,
  ShulkerBulletModel,
  WitherBossModel,
  EnderDragonModel
}
