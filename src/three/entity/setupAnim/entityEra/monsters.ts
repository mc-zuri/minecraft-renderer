import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, f, lerp } from '../mth'
import { HumanoidModel } from './humanoid'

/**
 * Monsters of 1.14.4 - 1.21.1 (creeper, spider, slimes, blaze, ghast, phantom, silverfish, endermite, shulker, shulker
 * bullet, wither, ender dragon), posed from the entity: prepareMobModel then setupAnim, as the version's classes do.
 * 1.14.4 - 1.16.5 draw the legacy layers, whose parts are the classes' fields (leg0, body_parts_2...); 1.17 on, the
 * layer definitions' names (right_hind_leg, segment2...).
 */

const DEG = DEG_TO_RAD

/** An input of the state; absent = 0 (the base inputs too: a sample may leave them out). */
const num = (state: AnimState, name: string) => (state[name] as number | undefined) ?? 0

/** Entity-era inputs: the entity's own fields are `entity.<field>`. */
const entity = (state: AnimState, field: string, fallback: number) => (state['entity.' + field] as number | undefined) ?? fallback

export class CreeperModel extends AnimModel {
  head = this.part('head')
  // 1.17 on, the fields are crossed: leftHindLeg is the right_hind_leg part and so on; before, leg0..leg3 (right hind,
  // left hind, right front, left front)
  rightHindLeg = this.part(this.c.atLeast('1.17') ? 'left_hind_leg' : 'leg0')
  leftHindLeg = this.part(this.c.atLeast('1.17') ? 'right_hind_leg' : 'leg1')
  rightFrontLeg = this.part(this.c.atLeast('1.17') ? 'left_front_leg' : 'leg2')
  leftFrontLeg = this.part(this.c.atLeast('1.17') ? 'right_front_leg' : 'leg3')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const f1 = num(state, 'walkAnimationPos')
    const g = num(state, 'walkAnimationSpeed')
    this.head.yRot = f(num(state, 'yRot') * DEG)
    this.head.xRot = f(num(state, 'xRot') * DEG)
    this.rightHindLeg.xRot = f(f(cos(f(f1 * f(0.6662))) * f(1.4)) * g)
    this.leftHindLeg.xRot = f(f(cos(f(f(f1 * f(0.6662)) + PI)) * f(1.4)) * g)
    this.rightFrontLeg.xRot = f(f(cos(f(f(f1 * f(0.6662)) + PI)) * f(1.4)) * g)
    this.leftFrontLeg.xRot = f(f(cos(f(f1 * f(0.6662))) * f(1.4)) * g)
  }
}

/**
 * EndermanModel: HumanoidModel's pose, damped and clamped. Its own fields `model.carrying` / `model.creepy` (set by the
 * renderer from the carried block and the creepy synched data) are read from the state.
 */
export class EndermanModel extends HumanoidModel {
  carrying = false
  creepy = false

  override readModelFields(state: AnimState) {
    super.readModelFields(state)
    this.carrying = state['model.carrying'] ?? false
    this.creepy = state['model.creepy'] ?? false
  }

  override setupAnim(state: AnimState) {
    // the base inputs a sample leaves out are 0
    super.setupAnim({ walkAnimationPos: 0, walkAnimationSpeed: 0, ageInTicks: 0, yRot: 0, xRot: 0, partialTick: 0, ...state })
    this.head.visible = true
    this.body.xRot = 0
    this.body.y = -14
    this.body.z = -0
    this.rightLeg.xRot = f(this.rightLeg.xRot - 0)
    this.leftLeg.xRot = f(this.leftLeg.xRot - 0)
    // (float) (xRot * 0.5) before 1.18, xRot *= 0.5F after: the same float
    this.rightArm.xRot = f(this.rightArm.xRot * 0.5)
    this.leftArm.xRot = f(this.leftArm.xRot * 0.5)
    this.rightLeg.xRot = f(this.rightLeg.xRot * 0.5)
    this.leftLeg.xRot = f(this.leftLeg.xRot * 0.5)
    const max = f(0.4)
    if (this.rightArm.xRot > max) this.rightArm.xRot = max
    if (this.leftArm.xRot > max) this.leftArm.xRot = max
    if (this.rightArm.xRot < -max) this.rightArm.xRot = -max
    if (this.leftArm.xRot < -max) this.leftArm.xRot = -max
    if (this.rightLeg.xRot > max) this.rightLeg.xRot = max
    if (this.leftLeg.xRot > max) this.leftLeg.xRot = max
    if (this.rightLeg.xRot < -max) this.rightLeg.xRot = -max
    if (this.leftLeg.xRot < -max) this.leftLeg.xRot = -max
    if (this.carrying) {
      this.rightArm.xRot = -0.5
      this.leftArm.xRot = -0.5
      this.rightArm.zRot = f(0.05)
      this.leftArm.zRot = f(-0.05)
    }
    if (!this.c.atLeast('1.17')) {
      this.rightArm.z = 0
      this.leftArm.z = 0
    }
    this.rightLeg.z = 0
    this.leftLeg.z = 0
    this.rightLeg.y = -5
    this.leftLeg.y = -5
    this.head.z = -0
    this.head.y = -13
    this.hat.x = this.head.x
    this.hat.y = this.head.y
    this.hat.z = this.head.z
    this.hat.xRot = this.head.xRot
    this.hat.yRot = this.head.yRot
    this.hat.zRot = this.head.zRot
    if (this.creepy) this.head.y = f(this.head.y - 5)
    if (this.c.atLeast('1.15')) {
      this.rightArm.setPos(-5, -12, 0)
      this.leftArm.setPos(5, -12, 0)
    }
  }
}

const QUARTER_PI = f(Math.PI / 4)
const EIGHTH_PI = f(Math.PI / 8)
const THREE_HALF_PI = f((Math.PI * 3) / 2)

export class SpiderModel extends AnimModel {
  head = this.part('head')
  rightHindLeg = this.part(this.c.atLeast('1.17') ? 'right_hind_leg' : 'leg0')
  leftHindLeg = this.part(this.c.atLeast('1.17') ? 'left_hind_leg' : 'leg1')
  rightMiddleHindLeg = this.part(this.c.atLeast('1.17') ? 'right_middle_hind_leg' : 'leg2')
  leftMiddleHindLeg = this.part(this.c.atLeast('1.17') ? 'left_middle_hind_leg' : 'leg3')
  rightMiddleFrontLeg = this.part(this.c.atLeast('1.17') ? 'right_middle_front_leg' : 'leg4')
  leftMiddleFrontLeg = this.part(this.c.atLeast('1.17') ? 'left_middle_front_leg' : 'leg5')
  rightFrontLeg = this.part(this.c.atLeast('1.17') ? 'right_front_leg' : 'leg6')
  leftFrontLeg = this.part(this.c.atLeast('1.17') ? 'left_front_leg' : 'leg7')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const f1 = num(state, 'walkAnimationPos')
    const g = num(state, 'walkAnimationSpeed')
    this.head.yRot = f(num(state, 'yRot') * DEG)
    this.head.xRot = f(num(state, 'xRot') * DEG)
    this.rightHindLeg.zRot = -QUARTER_PI
    this.leftHindLeg.zRot = QUARTER_PI
    this.rightMiddleHindLeg.zRot = f(-0.581_194_64)
    this.leftMiddleHindLeg.zRot = f(0.581_194_64)
    this.rightMiddleFrontLeg.zRot = f(-0.581_194_64)
    this.leftMiddleFrontLeg.zRot = f(0.581_194_64)
    this.rightFrontLeg.zRot = -QUARTER_PI
    this.leftFrontLeg.zRot = QUARTER_PI
    this.rightHindLeg.yRot = QUARTER_PI
    this.leftHindLeg.yRot = -QUARTER_PI
    this.rightMiddleHindLeg.yRot = EIGHTH_PI
    this.leftMiddleHindLeg.yRot = -EIGHTH_PI
    this.rightMiddleFrontLeg.yRot = -EIGHTH_PI
    this.leftMiddleFrontLeg.yRot = EIGHTH_PI
    this.rightFrontLeg.yRot = -QUARTER_PI
    this.leftFrontLeg.yRot = QUARTER_PI
    const swing = (offset: number) => f(-f(cos(f(f(f(f1 * f(0.6662)) * 2) + offset)) * f(0.4)) * g)
    const step = (offset: number) => f(Math.abs(f(sin(f(f(f1 * f(0.6662)) + offset)) * f(0.4))) * g)
    const n = swing(0)
    const o = swing(PI)
    const p = swing(HALF_PI)
    const q = swing(THREE_HALF_PI)
    const r = step(0)
    const s = step(PI)
    const t = step(HALF_PI)
    const u = step(THREE_HALF_PI)
    this.rightHindLeg.yRot = f(this.rightHindLeg.yRot + n)
    this.leftHindLeg.yRot = f(this.leftHindLeg.yRot + -n)
    this.rightMiddleHindLeg.yRot = f(this.rightMiddleHindLeg.yRot + o)
    this.leftMiddleHindLeg.yRot = f(this.leftMiddleHindLeg.yRot + -o)
    this.rightMiddleFrontLeg.yRot = f(this.rightMiddleFrontLeg.yRot + p)
    this.leftMiddleFrontLeg.yRot = f(this.leftMiddleFrontLeg.yRot + -p)
    this.rightFrontLeg.yRot = f(this.rightFrontLeg.yRot + q)
    this.leftFrontLeg.yRot = f(this.leftFrontLeg.yRot + -q)
    this.rightHindLeg.zRot = f(this.rightHindLeg.zRot + r)
    this.leftHindLeg.zRot = f(this.leftHindLeg.zRot + -r)
    this.rightMiddleHindLeg.zRot = f(this.rightMiddleHindLeg.zRot + s)
    this.leftMiddleHindLeg.zRot = f(this.leftMiddleHindLeg.zRot + -s)
    this.rightMiddleFrontLeg.zRot = f(this.rightMiddleFrontLeg.zRot + t)
    this.leftMiddleFrontLeg.zRot = f(this.leftMiddleFrontLeg.zRot + -t)
    this.rightFrontLeg.zRot = f(this.rightFrontLeg.zRot + u)
    this.leftFrontLeg.zRot = f(this.leftFrontLeg.zRot + -u)
  }
}

/** LavaSlimeModel: prepareMobModel squashes the cubes (setupAnim is empty). Reads `entity.squish` / `entity.oSquish`. */
export class LavaSlimeModel extends AnimModel {
  bodyCubes = Array.from({ length: 8 }, (_, i) => this.part(this.c.atLeast('1.17') ? `cube${i}` : `body_cubes_${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.prepareMobModel(state)
  }

  prepareMobModel(state: AnimState) {
    let i = lerp(num(state, 'partialTick'), entity(state, 'oSquish', 0), entity(state, 'squish', 0))
    if (i < 0) i = 0
    for (let j = 0; j < this.bodyCubes.length; j++) {
      // (float) -(4 - j), written j - 4 so that j = 4 gives 0 rather than -0
      this.bodyCubes[j]!.y = f(f((j - 4) * i) * f(1.7))
    }
  }
}

export class BlazeModel extends AnimModel {
  upperBodyParts = Array.from({ length: 12 }, (_, i) => this.part(this.c.atLeast('1.17') ? `part${i}` : `upper_body_parts_${i}`))
  head = this.part('head')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const h = num(state, 'ageInTicks')
    // the decompiled sources read k++, but the bytecode adds HALF_PI: each rod is a quarter turn from the last
    let k = f(f(h * PI) * f(-0.1))
    for (let l = 0; l < 4; l++) {
      const part = this.upperBodyParts[l]!
      part.y = f(-2 + cos(f(f(l * 2 + h) * 0.25)))
      part.x = f(cos(k) * 9)
      part.z = f(sin(k) * 9)
      k = f(k + HALF_PI)
    }
    k = f(QUARTER_PI + f(f(h * PI) * f(0.03)))
    for (let l = 4; l < 8; l++) {
      const part = this.upperBodyParts[l]!
      part.y = f(2 + cos(f(f(l * 2 + h) * 0.25)))
      part.x = f(cos(k) * 7)
      part.z = f(sin(k) * 7)
      k = f(k + HALF_PI)
    }
    k = f(f(0.471_238_94) + f(f(h * PI) * f(-0.05)))
    for (let l = 8; l < 12; l++) {
      const part = this.upperBodyParts[l]!
      part.y = f(11 + cos(f(f(f(l * 1.5) + h) * 0.5)))
      part.x = f(cos(k) * 5)
      part.z = f(sin(k) * 5)
      k = f(k + HALF_PI)
    }
    this.head.yRot = f(num(state, 'yRot') * DEG)
    this.head.xRot = f(num(state, 'xRot') * DEG)
  }
}

export class GhastModel extends AnimModel {
  tentacles = Array.from({ length: 9 }, (_, i) => this.part(this.c.atLeast('1.17') ? `tentacle${i}` : `tentacles_${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin } = this.c
    for (let k = 0; k < this.tentacles.length; k++) {
      this.tentacles[k]!.xRot = f(f(f(0.2) * sin(f(f(num(state, 'ageInTicks') * f(0.3)) + k))) + f(0.4))
    }
  }
}

/**
 * The fixtures' entities have ids around a million (the sample generator's world), which makes the phantom's flap angle
 * overflow the sin table's int index the same way at any age: this default reproduces it. A renderer passes the
 * entity's network id as `entity.id`.
 */
const DEFAULT_ENTITY_ID = 1_000_000

/**
 * PhantomModel. Reads `entity.id` (Entity.getId(), not in the fixture): the wings flap from a per-entity offset of
 * id * 3 ticks.
 */
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
    // getId() * 3, an int (getUniqueFlapTickOffset from 1.17), plus ageInTicks in float
    const offset = Math.imul(entity(state, 'id', DEFAULT_ENTITY_ID), 3)
    const k = this.c.atLeast('1.17') ? f(f(f(offset + num(state, 'ageInTicks')) * f(7.448_451)) * DEG) : f(f(offset + num(state, 'ageInTicks')) * f(0.13))
    this.leftWingBase.zRot = f(f(cos(k) * 16) * DEG)
    this.leftWingTip.zRot = f(f(cos(k) * 16) * DEG)
    this.rightWingBase.zRot = -this.leftWingBase.zRot
    this.rightWingTip.zRot = -this.leftWingTip.zRot
    this.tailBase.xRot = f(-f(5 + f(cos(f(k * 2)) * 5)) * DEG)
    this.tailTip.xRot = f(-f(5 + f(cos(f(k * 2)) * 5)) * DEG)
  }
}

export class SilverfishModel extends AnimModel {
  bodyParts = Array.from({ length: 7 }, (_, i) => this.part(this.c.atLeast('1.17') ? `segment${i}` : `body_parts_${i}`))
  bodyLayers = Array.from({ length: 3 }, (_, i) => this.part(this.c.atLeast('1.17') ? `layer${i}` : `body_layers_${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const h = num(state, 'ageInTicks')
    for (let k = 0; k < this.bodyParts.length; k++) {
      const angle = f(f(h * f(0.9)) + f(f(k * f(0.15)) * PI))
      this.bodyParts[k]!.yRot = f(f(f(cos(angle) * PI) * f(0.05)) * (1 + Math.abs(k - 2)))
      this.bodyParts[k]!.x = f(f(f(sin(angle) * PI) * f(0.2)) * Math.abs(k - 2))
    }
    this.bodyLayers[0]!.yRot = this.bodyParts[2]!.yRot
    this.bodyLayers[1]!.yRot = this.bodyParts[4]!.yRot
    this.bodyLayers[1]!.x = this.bodyParts[4]!.x
    this.bodyLayers[2]!.yRot = this.bodyParts[1]!.yRot
    this.bodyLayers[2]!.x = this.bodyParts[1]!.x
  }
}

export class EndermiteModel extends AnimModel {
  bodyParts = Array.from({ length: 4 }, (_, i) => this.part(this.c.atLeast('1.17') ? `segment${i}` : `body_parts_${i}`))

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const h = num(state, 'ageInTicks')
    for (let k = 0; k < this.bodyParts.length; k++) {
      const angle = f(f(h * f(0.9)) + f(f(k * f(0.15)) * PI))
      this.bodyParts[k]!.yRot = f(f(f(cos(angle) * PI) * f(0.01)) * (1 + Math.abs(k - 2)))
      this.bodyParts[k]!.x = f(f(f(sin(angle) * PI) * f(0.1)) * Math.abs(k - 2))
    }
  }
}

/**
 * ShulkerModel. Reads `entity.currentPeekAmountO` / `entity.currentPeekAmount` (Shulker.getClientPeekAmount),
 * `entity.tickCount` (absent = 0: the sample generator's shulker never ticked, so the peek is lerped by ageInTicks
 * itself), and from 1.16 `entity.yHeadRot` / `entity.yBodyRot`.
 */
export class ShulkerModel extends AnimModel {
  lid = this.part('lid')
  head = this.part('head')

  /** Shulker.getClientPeekAmount */
  static getClientPeekAmount(state: AnimState, partialTick: number) {
    return lerp(partialTick, entity(state, 'currentPeekAmountO', 0), entity(state, 'currentPeekAmount', 0))
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin } = this.c
    const h = num(state, 'ageInTicks')
    const k = f(h - entity(state, 'tickCount', 0))
    const l = f(f(0.5 + ShulkerModel.getClientPeekAmount(state, k)) * PI)
    const m = f(-1 + sin(l))
    let n = 0
    if (l > PI) n = f(sin(f(h * f(0.1))) * f(0.7))
    this.lid.setPos(0, f(f(16 + f(sin(l) * 8)) + n), 0)
    if (ShulkerModel.getClientPeekAmount(state, k) > f(0.3)) this.lid.yRot = f(f(f(f(f(m * m) * m) * m) * PI) * f(0.125))
    else this.lid.yRot = 0
    this.head.xRot = f(num(state, 'xRot') * DEG)
    if (this.c.atLeast('1.16')) this.head.yRot = f(f(f(entity(state, 'yHeadRot', 0) - 180) - entity(state, 'yBodyRot', 0)) * DEG)
    else this.head.yRot = f(num(state, 'yRot') * DEG)
  }
}

export class ShulkerBulletModel extends AnimModel {
  main = this.part('main')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.main.yRot = f(num(state, 'yRot') * DEG)
    this.main.xRot = f(num(state, 'xRot') * DEG)
  }
}

/**
 * WitherBossModel. prepareMobModel reads `entity.yBodyRot` and the side heads' `entity.yRotHeads` / `entity.xRotHeads`
 * (WitherBoss float[2] fields, [right, left], degrees; not in the fixture, absent = [0, 0] as a new wither's).
 */
export class WitherBossModel extends AnimModel {
  ribcage = this.part(this.c.atLeast('1.17') ? 'ribcage' : 'upper_body_parts_1')
  tail = this.part(this.c.atLeast('1.17') ? 'tail' : 'upper_body_parts_2')
  centerHead = this.part(this.c.atLeast('1.17') ? 'center_head' : 'heads_0')
  rightHead = this.part(this.c.atLeast('1.17') ? 'right_head' : 'heads_1')
  leftHead = this.part(this.c.atLeast('1.17') ? 'left_head' : 'heads_2')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.prepareMobModel(state)
    const { sin, cos } = this.c
    const k = cos(f(num(state, 'ageInTicks') * f(0.1)))
    this.ribcage.xRot = f(f(f(0.065) + f(f(0.05) * k)) * PI)
    this.tail.setPos(-2, f(f(6.9) + f(cos(this.ribcage.xRot) * 10)), f(-0.5 + f(sin(this.ribcage.xRot) * 10)))
    this.tail.xRot = f(f(f(0.265) + f(f(0.1) * k)) * PI)
    this.centerHead.yRot = f(num(state, 'yRot') * DEG)
    this.centerHead.xRot = f(num(state, 'xRot') * DEG)
  }

  prepareMobModel(state: AnimState) {
    WitherBossModel.setupHeadRotation(state, this.rightHead, 0)
    WitherBossModel.setupHeadRotation(state, this.leftHead, 1)
  }

  /** (inlined in prepareMobModel's loop before 1.17: the same math) */
  static setupHeadRotation(state: AnimState, head: PartPose, i: number) {
    const yRotHeads = state['entity.yRotHeads'] as number[] | undefined
    const xRotHeads = state['entity.xRotHeads'] as number[] | undefined
    head.yRot = f(f(f(yRotHeads?.[i] ?? 0) - entity(state, 'yBodyRot', 0)) * DEG)
    head.xRot = f(f(xRotHeads?.[i] ?? 0) * DEG)
  }
}

export const ENTITY_ERA_MONSTERS_MODELS: Record<string, AnimModelClass> = {
  CreeperModel,
  EndermanModel,
  SpiderModel,
  // no animation: the cube, eyes and mouth stay as built
  SlimeModel: AnimModel,
  LavaSlimeModel,
  BlazeModel,
  GhastModel,
  PhantomModel,
  SilverfishModel,
  EndermiteModel,
  ShulkerModel,
  ShulkerBulletModel,
  WitherBossModel,
  // EnderDragonRenderer.DragonModel: setupAnim is empty (prepareMobModel only keeps the partial tick); the dragon is
  // posed in renderToBuffer, which draws the neck and tail parts several times at computed poses
  DragonModel: AnimModel
}
