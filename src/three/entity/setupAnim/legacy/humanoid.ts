import { AnimModel, type AnimContext, type AnimModelClass, type AnimState } from '../types'
import { PartPose } from '../modelPose'
import { DEG_TO_RAD, HALF_PI, PI, TWO_PI, f, lerp, rem, rotLerpRad, sqrt } from '../mth'

/**
 * The humanoid and monster models of 1.8.9 - 1.13.2 (legacy Yarn names): BiPedModel and its subclasses (zombies,
 * skeletons, endermen, armor stands, vexes), the villager-shaped models (villager, witch, illagers: class_3086 / class_3091
 * in 1.11.2, class_3087 from 1.12.2, the 1.13.2 witch class_4201) and the monsters (creeper, spider, slime, magma cube,
 * blaze, ghast, silverfish, endermite, shulker bullet, wither, ender dragon, guardian, end crystal, wither skull).
 *
 * Each model: animateModel(entity, limbAngle, limbDistance, tickDelta) then setAngles(limbAngle, limbDistance, age, headYaw,
 * headPitch, scale, entity), from the initial pose. ModelPart fields: pivotX/Y/Z = x, y, z; posX/Y/Z = xRot, yRot, zRot;
 * offsetX/Y/Z are added to the pivot as block units (x = pivotX + offsetX * 16).
 *
 * Versions:
 * - 1.8.9: the head turns by `angle / (180F / PI)`, BiPedModel has int arm poses (model.leftArmPose / rightArmPose:
 *   0 none, 1 item, 3 blocking) and `aiming`, always swings the right arm (handSwingProgress > -9990), the zombies' arms
 *   are -PI/2 down, the 1.8.9 skeleton is a zombie model, the witch nose computes `* 4.5F * PI / 180F`;
 * - 1.9: `angle * (PI / 180)`, ArmPose enums (model.field_13384 = left, model.field_13385 = right), the swinging arm is
 *   the main arm's, fall flying (entity.field_14548 > 4) looks down and damps the swing, legs splay when riding, zombies
 *   raise their arms by armsRaised, skeletons draw their bow / swing their arms (data), vex (1.11);
 * - 1.11: the swinging arm is the main arm's only when the entity's last swing was its main hand (entity.mainHand);
 * - 1.12: one illager model (class_3087) posed by the illager's state (crossed, attacking, spellcasting, bow);
 * - 1.13: swimming (entity.field_16813 / field_16814 = swim amount / its previous value, Entity flag 4), THROW_SPEAR;
 *   the guardian's rotation vector is computed the new way.
 *
 * The state: walkAnimationPos, walkAnimationSpeed, ageInTicks, yRot, xRot, partialTick; model.<field>
 * (handSwingProgress, riding, sneaking, arm poses, aiming, carryingBlock, angry, field_5133 / field_20606 the witch's
 * drinking); data.<index> (synched data by index, the indices per version below); entity.<field>. Optional inputs this
 * file reads beyond the fixtures' (absent: their defaults): `item.mainhand` (a skeleton's bow), `entity.velocityX/Y/Z`
 * (fall flying damping), `entity.mainHand` ('MAIN_HAND' / 'OFF_HAND': the hand of the entity's last swing, 1.11+; absent: null, as before
 * any swing, which swings the other arm), `entity.id` and
 * `entity.ticksAlive` (the witch's nose wobble, the guardian's tick), `entity.yaw` (the armor stand's base plate; default
 * 180, the yaw the fixtures were sampled at), `entity.sideHeadYaws` / `entity.sideHeadPitches` (the wither's side heads,
 * [left, right] in degrees), `entity.prevPitch` (the guardian), `cameraOffset` (the camera entity's eye position minus
 * the guardian's, [x, y, z]; default [0, 1, -1]: the camera of the fixtures, in front of a guardian facing yaw 180 and
 * above it), `beamTargetOffset` (the guardian's beam target's eye position minus the guardian's; absent: the target is
 * not loaded), `entityType` (which illager the 1.12+ illager model draws: evoker / evocation_illager (default),
 * vindicator / vindication_illager, illusioner / illusion_illager).
 */

type Version = '1.8' | '1.9' | '1.10' | '1.11' | '1.12' | '1.13'

/** The value of the newest version the context is at least (tables newest first). */
function byVersion<T>(c: AnimContext, table: Array<[Version, T]>): T | undefined {
  for (const [version, value] of table) if (c.atLeast(version)) return value
  return undefined
}

/** A synched data value by index, or the default when the state lacks it (or the version lacks the data). */
function legacyData<T = any>(state: AnimState, index: number | undefined, defaultValue: T): T {
  if (index === undefined) return defaultValue
  const value = state[`data.${index}`]
  return value === undefined || value === null ? defaultValue : (value as T)
}

const num = (state: AnimState, key: string, defaultValue = 0): number => (state[key] as number | undefined) ?? defaultValue

/** Synched data indices, per version (Entity: flags at 0; LivingEntity from 5 (6 from 1.10); MobEntity flags after). */
const DATA = {
  /** MobEntity flags (bit 2: left handed), 1.9+ */
  mobFlags: (c: AnimContext) =>
    byVersion(c, [
      ['1.10', 11],
      ['1.9', 10]
    ]),
  /** ZombieEntity armsRaised (method_13247), 1.9+ */
  zombieArmsRaised: (c: AnimContext) =>
    byVersion(c, [
      ['1.11', 14],
      ['1.10', 15],
      ['1.9', 14]
    ]),
  /** 1.8.9 SkeletonEntity type (1: wither skeleton) */
  skeletonType: (c: AnimContext) => (c.atLeast('1.9') ? undefined : 13),
  /** SkeletonEntity / AbstractSkeleton swinging arms (method_13239 / method_14059), 1.9+ */
  skeletonSwingingArms: (c: AnimContext) =>
    byVersion(c, [
      ['1.11', 12],
      ['1.10', 13],
      ['1.9', 12]
    ]),
  /** ArmorStandEntity flags (1 small, 4 show arms, 8 no base plate); the six rotations follow */
  armorStandFlags: (c: AnimContext) =>
    byVersion(c, [
      ['1.10', 11],
      ['1.8', 10]
    ])!,
  /** VexEntity flags (1: charging), 1.11+ */
  vexFlags: (c: AnimContext) => byVersion(c, [['1.11', 12]]),
  /** class_3162 (illager) flags (1: attacking / aiming), 1.12+ */
  illagerFlags: (c: AnimContext) => byVersion(c, [['1.12', 12]]),
  /** class_3168 (spellcasting illager) spell, 1.12+ */
  illagerSpell: (c: AnimContext) => byVersion(c, [['1.12', 13]]),
  /** GuardianEntity beam target id */
  guardianTarget: (c: AnimContext) =>
    byVersion(c, [
      ['1.10', 13],
      ['1.9', 12],
      ['1.8', 17]
    ])!
}

/** LivingEntity.getDurability (the main arm): a mob's from its flags (1.9+), else RIGHT. */
const mainArm = (m: AnimModel, state: AnimState): 'LEFT' | 'RIGHT' => ((legacyData(state, DATA.mobFlags(m.c), 0) & 2) !== 0 ? 'LEFT' : 'RIGHT')

/** 180F / (float) Math.PI: 1.8.9 turns degrees into radians by dividing by it */
const DEG_DIVISOR = f(180 / PI)

/** The degrees to radians of the version: 1.8.9 `a / (180F / PI)`, later `a * (float) (PI / 180)`. */
const toRad = (c: AnimContext, degrees: number) => (c.atLeast('1.9') ? f(degrees * DEG_TO_RAD) : f(degrees / DEG_DIVISOR))

/** 1.8.9's int arm pose (0 none, 1 item, 3 blocking), also from the ArmPose names of a state made for 1.9 (1.9 and 1.9.2 draw from the 1.8.9 export). */
const intArmPose = (pose: unknown) => (typeof pose === 'number' ? pose : pose === 'ITEM' ? 1 : pose === 'BLOCK' ? 3 : 0)

/** A part the drawn layer lacks (a feature layer exports only the parts it draws): poses go nowhere. */
const detached = (name: string) => new PartPose(name, `<detached ${name}>`, [], [])

/** EntityModel: the model fields the renderer sets, animateModel then setAngles. */
export class LegacyEntityModel extends AnimModel {
  handSwingProgress = 0
  riding = false
  child = false

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.readModelFields(state)
    this.animateModel(state)
    this.setAngles(state)
  }

  /** The model fields the renderer sets before posing (model.<field> in the state). */
  readModelFields(state: AnimState) {
    this.handSwingProgress = num(state, 'model.handSwingProgress')
    this.riding = state['model.riding'] ?? false
    this.child = state['model.child'] ?? false
  }

  /** animateModel(entity, limbAngle, limbDistance, tickDelta) */
  animateModel(_state: AnimState) {}

  /** setAngles(limbAngle, limbDistance, age, headYaw, headPitch, scale, entity) */
  setAngles(_state: AnimState) {}

  /** A part by name, or a detached one when the layer lacks it. */
  opt(...names: string[]): PartPose {
    for (const name of names) {
      const part = this.model.maybe(name)
      if (part) return part
    }
    return detached(names[0]!)
  }
}

/** BiPedModel */
export class BiPedModel extends LegacyEntityModel {
  head = this.opt('head', 'model_part')
  hat = this.opt('hat')
  body = this.opt('body')
  rightArm = this.opt('right_arm')
  leftArm = this.opt('left_arm')
  rightLeg = this.opt('right_leg')
  leftLeg = this.opt('left_leg')

  /** 1.8.9: int arm poses (0 none, 1 item, 3 blocking); 1.9+: field_13384 (left) / field_13385 (right) enum names */
  leftArmPose: number | string = 0
  rightArmPose: number | string = 0
  sneaking = false
  /** 1.8.9 */
  aiming = false
  /** 1.13 field_20533: the swim amount */
  swimAmount = 0

  override readModelFields(state: AnimState) {
    super.readModelFields(state)
    this.sneaking = state['model.sneaking'] ?? false
    if (this.c.atLeast('1.9')) {
      this.leftArmPose = state['model.field_13384'] ?? 'EMPTY'
      this.rightArmPose = state['model.field_13385'] ?? 'EMPTY'
    } else {
      this.leftArmPose = intArmPose(state['model.leftArmPose'])
      this.rightArmPose = intArmPose(state['model.rightArmPose'])
      this.aiming = state['model.aiming'] ?? false
    }
  }

  override animateModel(state: AnimState) {
    if (this.c.atLeast('1.13')) {
      // LivingEntity.method_15642: the previous swim amount + (swim amount - previous) * tickDelta
      const previous = num(state, 'entity.field_16814')
      this.swimAmount = f(previous + f(f(num(state, 'entity.field_16813') - previous) * num(state, 'partialTick')))
    }
  }

  override setAngles(state: AnimState) {
    this.bipedSetAngles(state)
  }

  /** BiPedModel.setAngles (subclasses that skip a parent's setAngles call it directly, like Java's super chain) */
  bipedSetAngles(state: AnimState) {
    if (!this.c.atLeast('1.9')) {
      this.setAngles1_8(state)
      return
    }
    const { sin, cos } = this.c
    const handSwing = num(state, 'walkAnimationPos')
    const handSwingAmount = num(state, 'walkAnimationSpeed')
    const age = num(state, 'ageInTicks')
    const headYaw = num(state, 'yRot')
    const headPitch = num(state, 'xRot')
    const v1_13 = this.c.atLeast('1.13')
    // LivingEntity.method_13056: the fall flying ticks
    const fallFlying = num(state, 'entity.field_14548') > 4
    // Entity.method_15584: swimming (Entity flag 4)
    const swimming = v1_13 && (legacyData(state, 0, 0) & (1 << 4)) !== 0
    this.head.yRot = f(headYaw * DEG_TO_RAD)
    if (fallFlying) {
      this.head.xRot = f(-Math.PI / 4)
    } else if (v1_13 && this.swimAmount > 0) {
      if (swimming) this.head.xRot = rotLerpRad(this.swimAmount, this.head.xRot, f(-Math.PI / 4))
      else this.head.xRot = rotLerpRad(this.swimAmount, this.head.xRot, f(headPitch * DEG_TO_RAD))
    } else {
      this.head.xRot = f(headPitch * DEG_TO_RAD)
    }

    this.body.yRot = 0
    this.rightArm.z = 0
    this.rightArm.x = -5
    this.leftArm.z = 0
    this.leftArm.x = 5
    let l = 1
    if (fallFlying) {
      const vx = num(state, 'entity.velocityX')
      const vy = num(state, 'entity.velocityY')
      const vz = num(state, 'entity.velocityZ')
      l = f(vx * vx + vy * vy + vz * vz)
      l = f(l / f(0.2))
      l = f(l * f(l * l))
    }
    if (l < 1) l = 1

    this.rightArm.xRot = f(f(f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * 2) * handSwingAmount) * 0.5) / l)
    this.leftArm.xRot = f(f(f(f(cos(f(handSwing * f(0.6662))) * 2) * handSwingAmount) * 0.5) / l)
    this.rightArm.zRot = 0
    this.leftArm.zRot = 0
    this.rightLeg.xRot = f(f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount) / l)
    this.leftLeg.xRot = f(f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount) / l)
    this.rightLeg.yRot = 0
    this.leftLeg.yRot = 0
    this.rightLeg.zRot = 0
    this.leftLeg.zRot = 0
    if (this.riding) {
      this.rightArm.xRot = f(this.rightArm.xRot + f(-Math.PI / 5))
      this.leftArm.xRot = f(this.leftArm.xRot + f(-Math.PI / 5))
      this.rightLeg.xRot = f(-1.413_716_7)
      this.rightLeg.yRot = f(Math.PI / 10)
      this.rightLeg.zRot = f(0.078_539_82)
      this.leftLeg.xRot = f(-1.413_716_7)
      this.leftLeg.yRot = f(-Math.PI / 10)
      this.leftLeg.zRot = f(-0.078_539_82)
    }

    this.rightArm.yRot = 0
    this.rightArm.zRot = 0
    switch (this.leftArmPose) {
      case 'EMPTY':
        this.leftArm.yRot = 0
        break
      case 'BLOCK':
        this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - f(0.942_477_9))
        this.leftArm.yRot = f(Math.PI / 6)
        break
      case 'ITEM':
        this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - f(Math.PI / 10))
        this.leftArm.yRot = 0
        break
    }
    switch (this.rightArmPose) {
      case 'EMPTY':
        this.rightArm.yRot = 0
        break
      case 'BLOCK':
        this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - f(0.942_477_9))
        this.rightArm.yRot = f(-Math.PI / 6)
        break
      case 'ITEM':
        this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - f(Math.PI / 10))
        this.rightArm.yRot = 0
        break
      case 'THROW_SPEAR':
        if (v1_13) {
          this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - PI)
          this.rightArm.yRot = 0
        }
        break
    }
    if (
      v1_13 &&
      this.leftArmPose === 'THROW_SPEAR' &&
      this.rightArmPose !== 'BLOCK' &&
      this.rightArmPose !== 'THROW_SPEAR' &&
      this.rightArmPose !== 'BOW_AND_ARROW'
    ) {
      this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - PI)
      this.leftArm.yRot = 0
    }

    if (this.handSwingProgress > 0) {
      const arm = this.swingingArm(state)
      const swinging = this.armPart(arm)
      let m = this.handSwingProgress
      this.body.yRot = f(sin(f(sqrt(m) * TWO_PI)) * f(0.2))
      if (arm === 'LEFT') this.body.yRot = f(this.body.yRot * -1)
      this.rightArm.z = f(sin(this.body.yRot) * 5)
      this.rightArm.x = f(-cos(this.body.yRot) * 5)
      this.leftArm.z = f(-sin(this.body.yRot) * 5)
      this.leftArm.x = f(cos(this.body.yRot) * 5)
      this.rightArm.yRot = f(this.rightArm.yRot + this.body.yRot)
      this.leftArm.yRot = f(this.leftArm.yRot + this.body.yRot)
      this.leftArm.xRot = f(this.leftArm.xRot + this.body.yRot)
      m = f(1 - this.handSwingProgress)
      m = f(m * m)
      m = f(m * m)
      m = f(1 - m)
      const n = sin(f(m * PI))
      const o = f(f(sin(f(this.handSwingProgress * PI)) * -f(this.head.xRot - f(0.7))) * 0.75)
      swinging.xRot = f(swinging.xRot - (n * 1.2 + o))
      swinging.yRot = f(swinging.yRot + f(this.body.yRot * 2))
      swinging.zRot = f(swinging.zRot + f(sin(f(this.handSwingProgress * PI)) * f(-0.4)))
    }

    this.sneakPose()
    this.bobArms(age)
    if (this.rightArmPose === 'BOW_AND_ARROW') {
      this.rightArm.yRot = f(f(-0.1) + this.head.yRot)
      this.leftArm.yRot = f(f(f(0.1) + this.head.yRot) + f(0.4))
      this.rightArm.xRot = f(-HALF_PI + this.head.xRot)
      this.leftArm.xRot = f(-HALF_PI + this.head.xRot)
    } else if (this.leftArmPose === 'BOW_AND_ARROW' && (!v1_13 || (this.rightArmPose !== 'THROW_SPEAR' && this.rightArmPose !== 'BLOCK'))) {
      this.rightArm.yRot = f(f(f(-0.1) + this.head.yRot) - f(0.4))
      this.leftArm.yRot = f(f(0.1) + this.head.yRot)
      this.rightArm.xRot = f(-HALF_PI + this.head.xRot)
      this.leftArm.xRot = f(-HALF_PI + this.head.xRot)
    }

    if (v1_13 && this.swimAmount > 0) this.swimPose(handSwing)
    this.hat.copyFrom(this.head)
  }

  /** 1.13: the swimming strokes */
  swimPose(handSwing: number) {
    const { cos } = this.c
    const swim = this.swimAmount
    const p = rem(handSwing, 26)
    const q = this.handSwingProgress > 0 ? 0 : swim
    const stroke = (x: number) => f(f(-65 * x) + f(x * x))
    if (p < 14) {
      this.leftArm.xRot = rotLerpRad(swim, this.leftArm.xRot, 0)
      this.rightArm.xRot = lerp(q, this.rightArm.xRot, 0)
      this.leftArm.yRot = rotLerpRad(swim, this.leftArm.yRot, PI)
      this.rightArm.yRot = lerp(q, this.rightArm.yRot, PI)
      this.leftArm.zRot = rotLerpRad(swim, this.leftArm.zRot, f(PI + f(f(f(1.870_796_4) * stroke(p)) / stroke(14))))
      this.rightArm.zRot = lerp(q, this.rightArm.zRot, f(PI - f(f(f(1.870_796_4) * stroke(p)) / stroke(14))))
    } else if (p >= 14 && p < 22) {
      const m = f(f(p - 14) / 8)
      this.leftArm.xRot = rotLerpRad(swim, this.leftArm.xRot, f(HALF_PI * m))
      this.rightArm.xRot = lerp(q, this.rightArm.xRot, f(HALF_PI * m))
      this.leftArm.yRot = rotLerpRad(swim, this.leftArm.yRot, PI)
      this.rightArm.yRot = lerp(q, this.rightArm.yRot, PI)
      this.leftArm.zRot = rotLerpRad(swim, this.leftArm.zRot, f(f(5.012_389) - f(f(1.870_796_4) * m)))
      this.rightArm.zRot = lerp(q, this.rightArm.zRot, f(f(1.270_796_3) + f(f(1.870_796_4) * m)))
    } else if (p >= 22 && p < 26) {
      const m = f(f(p - 22) / 4)
      this.leftArm.xRot = rotLerpRad(swim, this.leftArm.xRot, f(HALF_PI - f(HALF_PI * m)))
      this.rightArm.xRot = lerp(q, this.rightArm.xRot, f(HALF_PI - f(HALF_PI * m)))
      this.leftArm.yRot = rotLerpRad(swim, this.leftArm.yRot, PI)
      this.rightArm.yRot = lerp(q, this.rightArm.yRot, PI)
      this.leftArm.zRot = rotLerpRad(swim, this.leftArm.zRot, PI)
      this.rightArm.zRot = lerp(q, this.rightArm.zRot, PI)
    }
    this.leftLeg.xRot = lerp(swim, this.leftLeg.xRot, f(f(0.3) * cos(f(f(handSwing * f(0.333_333_34)) + PI))))
    this.rightLeg.xRot = lerp(swim, this.rightLeg.xRot, f(f(0.3) * cos(f(handSwing * f(0.333_333_34)))))
  }

  sneakPose() {
    if (this.sneaking) {
      this.body.xRot = 0.5
      this.rightArm.xRot = f(this.rightArm.xRot + f(0.4))
      this.leftArm.xRot = f(this.leftArm.xRot + f(0.4))
      this.rightLeg.z = 4
      this.leftLeg.z = 4
      this.rightLeg.y = 9
      this.leftLeg.y = 9
      this.head.y = 1
    } else {
      this.body.xRot = 0
      this.rightLeg.z = f(0.1)
      this.leftLeg.z = f(0.1)
      this.rightLeg.y = 12
      this.leftLeg.y = 12
      this.head.y = 0
    }
  }

  bobArms(age: number) {
    const { sin, cos } = this.c
    this.rightArm.zRot = f(this.rightArm.zRot + f(f(cos(f(age * f(0.09))) * f(0.05)) + f(0.05)))
    this.leftArm.zRot = f(this.leftArm.zRot - f(f(cos(f(age * f(0.09))) * f(0.05)) + f(0.05)))
    this.rightArm.xRot = f(this.rightArm.xRot + f(sin(f(age * f(0.067))) * f(0.05)))
    this.leftArm.xRot = f(this.leftArm.xRot - f(sin(f(age * f(0.067))) * f(0.05)))
  }

  /** method_12222: the arm that swings (the main arm; 1.11+ the other one unless the entity's last swing was its main hand) */
  swingingArm(state: AnimState): 'LEFT' | 'RIGHT' {
    const arm = mainArm(this, state)
    if (!this.c.atLeast('1.11')) return arm
    // LivingEntity.mainHand: the hand of the entity's last swing, null until it swings (then the other arm)
    return (state['entity.mainHand'] ?? null) === 'MAIN_HAND' ? arm : arm === 'LEFT' ? 'RIGHT' : 'LEFT'
  }

  /** method_12223 */
  armPart(arm: 'LEFT' | 'RIGHT') {
    return arm === 'LEFT' ? this.leftArm : this.rightArm
  }

  /** 1.8.9 BiPedModel.setAngles */
  setAngles1_8(state: AnimState) {
    const { sin, cos } = this.c
    const handSwing = num(state, 'walkAnimationPos')
    const handSwingAmount = num(state, 'walkAnimationSpeed')
    const age = num(state, 'ageInTicks')
    this.head.yRot = f(num(state, 'yRot') / DEG_DIVISOR)
    this.head.xRot = f(num(state, 'xRot') / DEG_DIVISOR)
    this.rightArm.xRot = f(f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * 2) * handSwingAmount) * 0.5)
    this.leftArm.xRot = f(f(f(cos(f(handSwing * f(0.6662))) * 2) * handSwingAmount) * 0.5)
    this.rightArm.zRot = 0
    this.leftArm.zRot = 0
    this.rightLeg.xRot = f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount)
    this.leftLeg.xRot = f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount)
    this.rightLeg.yRot = 0
    this.leftLeg.yRot = 0
    if (this.riding) {
      this.rightArm.xRot = f(this.rightArm.xRot + f(-Math.PI / 5))
      this.leftArm.xRot = f(this.leftArm.xRot + f(-Math.PI / 5))
      this.rightLeg.xRot = f((-Math.PI * 2) / 5)
      this.leftLeg.xRot = f((-Math.PI * 2) / 5)
      this.rightLeg.yRot = f(Math.PI / 10)
      this.leftLeg.yRot = f(-Math.PI / 10)
    }

    const leftArmPose = this.leftArmPose as number
    const rightArmPose = this.rightArmPose as number
    if (leftArmPose !== 0) this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - f(f(Math.PI / 10) * leftArmPose))
    this.rightArm.yRot = 0
    this.rightArm.zRot = 0
    switch (rightArmPose) {
      case 1:
        this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - f(f(Math.PI / 10) * rightArmPose))
        break
      case 3:
        this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - f(f(Math.PI / 10) * rightArmPose))
        this.rightArm.yRot = f(-Math.PI / 6)
        break
    }
    this.leftArm.yRot = 0
    if (this.handSwingProgress > -9990) {
      let l = this.handSwingProgress
      this.body.yRot = f(sin(f(f(sqrt(l) * PI) * 2)) * f(0.2))
      this.rightArm.z = f(sin(this.body.yRot) * 5)
      this.rightArm.x = f(-cos(this.body.yRot) * 5)
      this.leftArm.z = f(-sin(this.body.yRot) * 5)
      this.leftArm.x = f(cos(this.body.yRot) * 5)
      this.rightArm.yRot = f(this.rightArm.yRot + this.body.yRot)
      this.leftArm.yRot = f(this.leftArm.yRot + this.body.yRot)
      this.leftArm.xRot = f(this.leftArm.xRot + this.body.yRot)
      l = f(1 - this.handSwingProgress)
      l = f(l * l)
      l = f(l * l)
      l = f(1 - l)
      const m = sin(f(l * PI))
      const n = f(f(sin(f(this.handSwingProgress * PI)) * -f(this.head.xRot - f(0.7))) * 0.75)
      this.rightArm.xRot = f(this.rightArm.xRot - (m * 1.2 + n))
      this.rightArm.yRot = f(this.rightArm.yRot + f(this.body.yRot * 2))
      this.rightArm.zRot = f(this.rightArm.zRot + f(sin(f(this.handSwingProgress * PI)) * f(-0.4)))
    }

    this.sneakPose()
    this.bobArms(age)
    if (this.aiming) {
      const l = 0
      const m = 0
      this.rightArm.zRot = 0
      this.leftArm.zRot = 0
      this.rightArm.yRot = f(-f(f(0.1) - f(l * f(0.6))) + this.head.yRot)
      this.leftArm.yRot = f(f(f(f(0.1) - f(l * f(0.6))) + this.head.yRot) + f(0.4))
      this.rightArm.xRot = f(-HALF_PI + this.head.xRot)
      this.leftArm.xRot = f(-HALF_PI + this.head.xRot)
      this.rightArm.xRot = f(this.rightArm.xRot - f(f(l * f(1.2)) - f(m * f(0.4))))
      this.leftArm.xRot = f(this.leftArm.xRot - f(f(l * f(1.2)) - f(m * f(0.4))))
      this.bobArms(age)
    }

    this.hat.copyFrom(this.head)
  }
}

/** The zombie arms of AbstractZombieModel, ZombieVillagerEntityModel and the 1.9+ swinging skeleton. */
function zombieArms(m: BiPedModel, age: number, raise: number | null) {
  const { sin } = m.c
  const p = m.handSwingProgress
  const l = sin(f(p * PI))
  const n = sin(f(f(1 - f(f(1 - p) * f(1 - p))) * PI))
  m.rightArm.zRot = 0
  m.leftArm.zRot = 0
  m.rightArm.yRot = -f(f(0.1) - f(l * f(0.6)))
  m.leftArm.yRot = f(f(0.1) - f(l * f(0.6)))
  if (raise === null) {
    // 1.8.9, and the 1.9+ skeleton: down at -PI/2, the swing subtracted
    m.rightArm.xRot = -HALF_PI
    m.leftArm.xRot = -HALF_PI
    m.rightArm.xRot = f(m.rightArm.xRot - f(f(l * f(1.2)) - f(n * f(0.4))))
    m.leftArm.xRot = f(m.leftArm.xRot - f(f(l * f(1.2)) - f(n * f(0.4))))
  } else {
    m.rightArm.xRot = raise
    m.leftArm.xRot = raise
    m.rightArm.xRot = f(m.rightArm.xRot + f(f(l * f(1.2)) - f(n * f(0.4))))
    m.leftArm.xRot = f(m.leftArm.xRot + f(f(l * f(1.2)) - f(n * f(0.4))))
  }
  m.bobArms(age)
}

/** (float) -Math.PI / (armsRaised ? 1.5F : 2.25F) */
const zombieArmRaise = (armsRaised: boolean) => f(-PI / (armsRaised ? 1.5 : 2.25))

/** AbstractZombieModel (zombie, husk, zombie pigman, giant) */
export class AbstractZombieModel extends BiPedModel {
  override setAngles(state: AnimState) {
    this.bipedSetAngles(state)
    this.zombieSetAngles(state)
  }

  zombieSetAngles(state: AnimState) {
    const age = num(state, 'ageInTicks')
    if (!this.c.atLeast('1.9')) {
      zombieArms(this, age, null)
      return
    }
    // entity instanceof ZombieEntity && method_13247 (armsRaised); a giant has no such data
    const armsRaised = legacyData(state, DATA.zombieArmsRaised(this.c), false)
    zombieArms(this, age, zombieArmRaise(armsRaised))
  }
}

/** ZombieVillagerEntityModel (also the zombie villager head of 1.8.9 - 1.10.2's head feature layer: only its head) */
export class ZombieVillagerEntityModel extends BiPedModel {
  override setAngles(state: AnimState) {
    this.bipedSetAngles(state)
    const age = num(state, 'ageInTicks')
    if (!this.c.atLeast('1.9')) {
      zombieArms(this, age, null)
      return
    }
    zombieArms(this, age, zombieArmRaise(legacyData(state, DATA.zombieArmsRaised(this.c), false)))
  }
}

/** SkeletonEntityModel: 1.8.9 an AbstractZombieModel, 1.9+ a BiPedModel drawing its bow or swinging its arms. */
export class SkeletonEntityModel extends AbstractZombieModel {
  override animateModel(state: AnimState) {
    if (!this.c.atLeast('1.9')) {
      this.aiming = legacyData<number>(state, DATA.skeletonType(this.c), 0) === 1
      super.animateModel(state)
      return
    }
    this.rightArmPose = 'EMPTY'
    this.leftArmPose = 'EMPTY'
    const swingingArms = legacyData(state, DATA.skeletonSwingingArms(this.c), false)
    if (state['item.mainhand'] === 'bow' && swingingArms) {
      if (mainArm(this, state) === 'RIGHT') this.rightArmPose = 'BOW_AND_ARROW'
      else this.leftArmPose = 'BOW_AND_ARROW'
    }
    super.animateModel(state)
  }

  override setAngles(state: AnimState) {
    if (!this.c.atLeast('1.9')) {
      super.setAngles(state)
      return
    }
    this.bipedSetAngles(state)
    const swingingArms = legacyData(state, DATA.skeletonSwingingArms(this.c), false)
    if (swingingArms && state['item.mainhand'] !== 'bow') zombieArms(this, num(state, 'ageInTicks'), null)
  }
}

/** EndermanEntityModel */
export class EndermanEntityModel extends BiPedModel {
  carryingBlock = false
  angry = false

  override readModelFields(state: AnimState) {
    super.readModelFields(state)
    this.carryingBlock = state['model.carryingBlock'] ?? false
    this.angry = state['model.angry'] ?? false
  }

  override setAngles(state: AnimState) {
    super.setAngles(state)
    this.head.visible = true
    this.body.xRot = 0
    this.body.y = -14
    this.body.z = -0
    this.rightLeg.xRot = f(this.rightLeg.xRot - 0)
    this.leftLeg.xRot = f(this.leftLeg.xRot - 0)
    this.rightArm.xRot = f(this.rightArm.xRot * 0.5)
    this.leftArm.xRot = f(this.leftArm.xRot * 0.5)
    this.rightLeg.xRot = f(this.rightLeg.xRot * 0.5)
    this.leftLeg.xRot = f(this.leftLeg.xRot * 0.5)
    const m = f(0.4)
    if (this.rightArm.xRot > m) this.rightArm.xRot = m
    if (this.leftArm.xRot > m) this.leftArm.xRot = m
    if (this.rightArm.xRot < -m) this.rightArm.xRot = -m
    if (this.leftArm.xRot < -m) this.leftArm.xRot = -m
    if (this.rightLeg.xRot > m) this.rightLeg.xRot = m
    if (this.leftLeg.xRot > m) this.leftLeg.xRot = m
    if (this.rightLeg.xRot < -m) this.rightLeg.xRot = -m
    if (this.leftLeg.xRot < -m) this.leftLeg.xRot = -m
    if (this.carryingBlock) {
      this.rightArm.xRot = -0.5
      this.leftArm.xRot = -0.5
      this.rightArm.zRot = f(0.05)
      this.leftArm.zRot = f(-0.05)
    }
    this.rightArm.z = 0
    this.leftArm.z = 0
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
    if (this.angry) this.head.y = f(this.head.y - 5)
  }
}

/** ArmorStandEntity's rotations (EulerAngle, degrees) by synched data, after its flags: head, body, arms, legs. */
const ARMOR_STAND_ROTATIONS = {
  head: [0, [0, 0, 0]],
  body: [1, [0, 0, 0]],
  leftArm: [2, [-10, 0, -10]],
  rightArm: [3, [-15, 0, 10]],
  leftLeg: [4, [-1, 0, -1]],
  rightLeg: [5, [1, 0, 1]]
} as const

/** ArmorStandArmorEntityModel (an armor stand's armor layers, and the base of its own model) */
export class ArmorStandArmorEntityModel extends BiPedModel {
  /** ArmorStandEntity.getHeadAngle etc.: [pitch, yaw, roll] degrees */
  angle(state: AnimState, which: keyof typeof ARMOR_STAND_ROTATIONS): readonly number[] {
    const [offset, defaultValue] = ARMOR_STAND_ROTATIONS[which]
    const value = legacyData<number[] | null>(state, DATA.armorStandFlags(this.c) + 1 + offset, null)
    return value ?? defaultValue
  }

  /** sets a part's rotations from an angle: (float) (PI / 180) * pitch... */
  rotate(part: PartPose, angle: readonly number[]) {
    part.xRot = f(DEG_TO_RAD * angle[0]!)
    part.yRot = f(DEG_TO_RAD * angle[1]!)
    part.zRot = f(DEG_TO_RAD * angle[2]!)
  }

  override setAngles(state: AnimState) {
    // entity instanceof ArmorStandEntity
    this.rotate(this.head, this.angle(state, 'head'))
    this.head.setPos(0, 1, 0)
    this.rotate(this.body, this.angle(state, 'body'))
    this.rotate(this.leftArm, this.angle(state, 'leftArm'))
    this.rotate(this.rightArm, this.angle(state, 'rightArm'))
    this.rotate(this.leftLeg, this.angle(state, 'leftLeg'))
    this.leftLeg.setPos(f(1.9), 11, 0)
    this.rotate(this.rightLeg, this.angle(state, 'rightLeg'))
    this.rightLeg.setPos(f(-1.9), 11, 0)
    this.hat.copyFrom(this.head)
  }
}

/** ArmorStandEntityModel */
export class ArmorStandEntityModel extends ArmorStandArmorEntityModel {
  rightTorso = this.opt('right_torso')
  leftTorso = this.opt('left_torso')
  hip = this.opt('hip')
  plate = this.opt('plate')

  override setAngles(state: AnimState) {
    super.setAngles(state)
    const flags = legacyData(state, DATA.armorStandFlags(this.c), 0)
    const showArms = (flags & 4) !== 0
    this.leftArm.visible = showArms
    this.rightArm.visible = showArms
    this.plate.visible = (flags & 8) === 0
    this.leftLeg.setPos(f(1.9), 12, 0)
    this.rightLeg.setPos(f(-1.9), 12, 0)
    const body = this.angle(state, 'body')
    this.rotate(this.rightTorso, body)
    this.rotate(this.leftTorso, body)
    this.rotate(this.hip, body)
    this.plate.xRot = 0
    this.plate.yRot = f(DEG_TO_RAD * -num(state, 'entity.yaw', 180))
    this.plate.zRot = 0
  }
}

/** VexEntityModel (1.11+) */
export class VexEntityModel extends BiPedModel {
  leftWing = this.opt('field_15270')
  rightWing = this.opt('field_15271')

  override setAngles(state: AnimState) {
    super.setAngles(state)
    const { cos } = this.c
    // VexEntity.isCharging
    if ((legacyData(state, DATA.vexFlags(this.c), 0) & 1) !== 0) {
      if (mainArm(this, state) === 'RIGHT') this.rightArm.xRot = f(3.769_911_5)
      else this.leftArm.xRot = f(3.769_911_5)
    }
    this.rightLeg.xRot = f(this.rightLeg.xRot + f(Math.PI / 5))
    this.rightWing.z = 2
    this.leftWing.z = 2
    this.rightWing.y = 1
    this.leftWing.y = 1
    this.rightWing.yRot = f(f(0.471_238_94) + f(f(cos(f(num(state, 'ageInTicks') * f(0.8))) * PI) * f(0.05)))
    this.leftWing.yRot = -this.rightWing.yRot
    this.leftWing.zRot = f(-0.471_238_94)
    this.leftWing.xRot = f(0.471_238_94)
    this.rightWing.xRot = f(0.471_238_94)
    this.rightWing.zRot = f(0.471_238_94)
  }
}

/** VillagerEntityModel */
export class VillagerEntityModel extends LegacyEntityModel {
  head = this.opt('field_1557')
  arms = this.opt('field_1559')
  rightLeg = this.opt('field_1560')
  leftLeg = this.opt('field_1561')
  nose = this.opt('field_5132')

  override setAngles(state: AnimState) {
    const { cos } = this.c
    const handSwing = num(state, 'walkAnimationPos')
    const handSwingAmount = num(state, 'walkAnimationSpeed')
    this.head.yRot = toRad(this.c, num(state, 'yRot'))
    this.head.xRot = toRad(this.c, num(state, 'xRot'))
    this.arms.y = 3
    this.arms.z = -1
    this.arms.xRot = -0.75
    this.rightLeg.xRot = f(f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount) * 0.5)
    this.leftLeg.xRot = f(f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount) * 0.5)
    this.rightLeg.yRot = 0
    this.leftLeg.yRot = 0
  }
}

/** The witch's nose (WitchEntityModel 1.8.9 - 1.12.2, class_4201 1.13.2): it wobbles, or tips while drinking. */
function witchNose(m: VillagerEntityModel, state: AnimState, drinking: boolean) {
  const { sin, cos } = m.c
  const nose = m.nose
  // offsets back to 0: the pivot alone (the initial pose)
  const [pivotX = 0, pivotY = 0, pivotZ = 0] = nose.initial
  nose.setPos(pivotX, pivotY, pivotZ)
  const id = num(state, 'entity.id')
  const ticksAlive = num(state, 'entity.ticksAlive')
  const l = f(f(0.01) * (id % 10))
  if (m.c.atLeast('1.9')) {
    nose.xRot = f(f(sin(f(ticksAlive * l)) * f(4.5)) * DEG_TO_RAD)
    nose.yRot = 0
    nose.zRot = f(f(cos(f(ticksAlive * l)) * f(2.5)) * DEG_TO_RAD)
  } else {
    nose.xRot = f(f(f(sin(f(ticksAlive * l)) * f(4.5)) * PI) / 180)
    nose.yRot = 0
    nose.zRot = f(f(f(cos(f(ticksAlive * l)) * f(2.5)) * PI) / 180)
  }
  if (drinking) {
    nose.xRot = f(-0.9)
    // offsetZ = -0.09375F, offsetY = 0.1875F: block units on the pivot
    nose.z = f(pivotZ + f(-0.093_75 * 16))
    nose.y = f(pivotY + f(0.1875 * 16))
  }
}

/** WitchEntityModel (1.8.9 - 1.12.2) */
export class WitchEntityModel extends VillagerEntityModel {
  override setAngles(state: AnimState) {
    super.setAngles(state)
    witchNose(this, state, state['model.field_5133'] ?? false)
  }
}

/** class_4201: the 1.13.2 witch */
export class class_4201 extends VillagerEntityModel {
  override setAngles(state: AnimState) {
    super.setAngles(state)
    witchNose(this, state, state['model.field_20606'] ?? false)
  }
}

type IllagerState = 'CROSSED' | 'ATTACKING' | 'SPELLCASTING' | 'BOW_AND_ARROW'

/** class_3087: the illager model (1.11.2: the base of class_3086 / class_3091; 1.12+: every illager, by its state) */
export class class_3087 extends LegacyEntityModel {
  head = this.opt('field_15259')
  arms = this.opt('field_15261')
  rightLeg = this.opt('field_15262')
  leftLeg = this.opt('field_15263')
  rightArm = this.opt('field_15265')
  leftArm = this.opt('field_15266')

  /** class_3162.method_14123, per illager (entityType) */
  illagerState(state: AnimState): IllagerState {
    const type = (state.entityType as string | undefined) ?? 'evoker'
    const flags = legacyData(state, DATA.illagerFlags(this.c), 0)
    const spellcasting = legacyData(state, DATA.illagerSpell(this.c), 0) > 0
    switch (type) {
      case 'vindicator':
      case 'vindication_illager':
        return (flags & 1) !== 0 ? 'ATTACKING' : 'CROSSED'
      case 'illusioner':
      case 'illusion_illager':
        if (spellcasting) return 'SPELLCASTING'
        return (flags & 1) !== 0 ? 'BOW_AND_ARROW' : 'CROSSED'
      default:
        return spellcasting ? 'SPELLCASTING' : 'CROSSED'
    }
  }

  override setAngles(state: AnimState) {
    const { cos } = this.c
    const handSwing = num(state, 'walkAnimationPos')
    const handSwingAmount = num(state, 'walkAnimationSpeed')
    this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
    this.arms.y = 3
    this.arms.z = -1
    this.arms.xRot = -0.75
    this.rightLeg.xRot = f(f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount) * 0.5)
    this.leftLeg.xRot = f(f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount) * 0.5)
    this.rightLeg.yRot = 0
    this.leftLeg.yRot = 0
    if (!this.c.atLeast('1.12')) return
    const illagerState = this.illagerState(state)
    if (illagerState === 'ATTACKING') {
      this.attackingArms(state)
    } else if (illagerState === 'SPELLCASTING') {
      this.spellcastingArms(state)
    } else if (illagerState === 'BOW_AND_ARROW') {
      this.rightArm.yRot = f(f(-0.1) + this.head.yRot)
      this.rightArm.xRot = f(-HALF_PI + this.head.xRot)
      this.leftArm.xRot = f(f(-0.942_477_9) + this.head.xRot)
      this.leftArm.yRot = f(this.head.yRot - f(0.4))
      this.leftArm.zRot = HALF_PI
    }
  }

  attackingArms(state: AnimState) {
    const { sin, cos } = this.c
    const age = num(state, 'ageInTicks')
    const p = this.handSwingProgress
    const l = sin(f(p * PI))
    const m = sin(f(f(1 - f(f(1 - p) * f(1 - p))) * PI))
    this.rightArm.zRot = 0
    this.leftArm.zRot = 0
    this.rightArm.yRot = f(Math.PI / 20)
    this.leftArm.yRot = f(-Math.PI / 20)
    if (mainArm(this, state) === 'RIGHT') {
      this.rightArm.xRot = f(f(-1.884_955_8) + f(cos(f(age * f(0.09))) * f(0.15)))
      this.leftArm.xRot = f(-0 + f(cos(f(age * f(0.19))) * 0.5))
      this.rightArm.xRot = f(this.rightArm.xRot + f(f(l * f(2.2)) - f(m * f(0.4))))
      this.leftArm.xRot = f(this.leftArm.xRot + f(f(l * f(1.2)) - f(m * f(0.4))))
    } else {
      this.rightArm.xRot = f(-0 + f(cos(f(age * f(0.19))) * 0.5))
      this.leftArm.xRot = f(f(-1.884_955_8) + f(cos(f(age * f(0.09))) * f(0.15)))
      this.rightArm.xRot = f(this.rightArm.xRot + f(f(l * f(1.2)) - f(m * f(0.4))))
      this.leftArm.xRot = f(this.leftArm.xRot + f(f(l * f(2.2)) - f(m * f(0.4))))
    }
    this.rightArm.zRot = f(this.rightArm.zRot + f(f(cos(f(age * f(0.09))) * f(0.05)) + f(0.05)))
    this.leftArm.zRot = f(this.leftArm.zRot - f(f(cos(f(age * f(0.09))) * f(0.05)) + f(0.05)))
    this.rightArm.xRot = f(this.rightArm.xRot + f(sin(f(age * f(0.067))) * f(0.05)))
    this.leftArm.xRot = f(this.leftArm.xRot - f(sin(f(age * f(0.067))) * f(0.05)))
  }

  spellcastingArms(state: AnimState) {
    const { cos } = this.c
    const age = num(state, 'ageInTicks')
    this.rightArm.z = 0
    this.rightArm.x = -5
    this.leftArm.z = 0
    this.leftArm.x = 5
    this.rightArm.xRot = f(cos(f(age * f(0.6662))) * f(0.25))
    this.leftArm.xRot = f(cos(f(age * f(0.6662))) * f(0.25))
    this.rightArm.zRot = f((Math.PI * 3) / 4)
    this.leftArm.zRot = f((-Math.PI * 3) / 4)
    this.rightArm.yRot = 0
    this.leftArm.yRot = 0
  }
}

/** class_3086: the 1.11.2 evoker (arms always posed as casting; the renderer draws them while casting) */
export class class_3086 extends class_3087 {
  override setAngles(state: AnimState) {
    super.setAngles(state)
    this.spellcastingArms(state)
  }
}

/** class_3091: the 1.11.2 vindicator (arms always posed as attacking; the renderer draws them while attacking) */
export class class_3091 extends class_3087 {
  override setAngles(state: AnimState) {
    super.setAngles(state)
    this.attackingArms(state)
  }
}

/** CreeperEntityModel */
export class CreeperEntityModel extends LegacyEntityModel {
  head = this.part('head')
  rightBackLeg = this.part('right_back_leg')
  leftBackLeg = this.part('left_back_leg')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')

  override setAngles(state: AnimState) {
    const { cos } = this.c
    const handSwing = num(state, 'walkAnimationPos')
    const handSwingAmount = num(state, 'walkAnimationSpeed')
    this.head.yRot = toRad(this.c, num(state, 'yRot'))
    this.head.xRot = toRad(this.c, num(state, 'xRot'))
    this.rightBackLeg.xRot = f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount)
    this.leftBackLeg.xRot = f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount)
    this.rightFrontLeg.xRot = f(f(cos(f(f(handSwing * f(0.6662)) + PI)) * f(1.4)) * handSwingAmount)
    this.leftFrontLeg.xRot = f(f(cos(f(handSwing * f(0.6662))) * f(1.4)) * handSwingAmount)
  }
}

/** SpiderEntityModel (spider, cave spider) */
export class SpiderEntityModel extends LegacyEntityModel {
  head = this.part('field_1535')
  legs = ['field_1538', 'field_1539', 'field_1540', 'field_1541', 'field_1542', 'field_1543', 'field_1544', 'field_1545'].map(name => this.part(name))

  override setAngles(state: AnimState) {
    const { sin, cos } = this.c
    const handSwing = num(state, 'walkAnimationPos')
    const handSwingAmount = num(state, 'walkAnimationSpeed')
    const [leg1, leg2, leg3, leg4, leg5, leg6, leg7, leg8] = this.legs as [PartPose, PartPose, PartPose, PartPose, PartPose, PartPose, PartPose, PartPose]
    this.head.yRot = toRad(this.c, num(state, 'yRot'))
    this.head.xRot = toRad(this.c, num(state, 'xRot'))
    const l = f(Math.PI / 4)
    leg1.zRot = -l
    leg2.zRot = l
    leg3.zRot = f(-l * f(0.74))
    leg4.zRot = f(l * f(0.74))
    leg5.zRot = f(-l * f(0.74))
    leg6.zRot = f(l * f(0.74))
    leg7.zRot = -l
    leg8.zRot = l
    const m = -0
    const n = f(Math.PI / 8)
    leg1.yRot = f(f(n * 2) + m)
    leg2.yRot = f(f(-n * 2) - m)
    leg3.yRot = f(f(n * 1) + m)
    leg4.yRot = f(f(-n * 1) - m)
    leg5.yRot = f(f(-n * 1) + m)
    leg6.yRot = f(f(n * 1) - m)
    leg7.yRot = f(f(-n * 2) + m)
    leg8.yRot = f(f(n * 2) - m)
    const walk = f(f(handSwing * f(0.6662)) * 2)
    const o = f(-f(cos(f(walk + 0)) * f(0.4)) * handSwingAmount)
    const p = f(-f(cos(f(walk + PI)) * f(0.4)) * handSwingAmount)
    const q = f(-f(cos(f(walk + HALF_PI)) * f(0.4)) * handSwingAmount)
    const r = f(-f(cos(f(walk + f((Math.PI * 3) / 2))) * f(0.4)) * handSwingAmount)
    const step = f(handSwing * f(0.6662))
    const s = f(Math.abs(f(sin(f(step + 0)) * f(0.4))) * handSwingAmount)
    const t = f(Math.abs(f(sin(f(step + PI)) * f(0.4))) * handSwingAmount)
    const u = f(Math.abs(f(sin(f(step + HALF_PI)) * f(0.4))) * handSwingAmount)
    const v = f(Math.abs(f(sin(f(step + f((Math.PI * 3) / 2))) * f(0.4))) * handSwingAmount)
    leg1.yRot = f(leg1.yRot + o)
    leg2.yRot = f(leg2.yRot + -o)
    leg3.yRot = f(leg3.yRot + p)
    leg4.yRot = f(leg4.yRot + -p)
    leg5.yRot = f(leg5.yRot + q)
    leg6.yRot = f(leg6.yRot + -q)
    leg7.yRot = f(leg7.yRot + r)
    leg8.yRot = f(leg8.yRot + -r)
    leg1.zRot = f(leg1.zRot + s)
    leg2.zRot = f(leg2.zRot + -s)
    leg3.zRot = f(leg3.zRot + t)
    leg4.zRot = f(leg4.zRot + -t)
    leg5.zRot = f(leg5.zRot + u)
    leg6.zRot = f(leg6.zRot + -u)
    leg7.zRot = f(leg7.zRot + v)
    leg8.zRot = f(leg8.zRot + -v)
  }
}

/** MagmaCubeEntityModel: the slices spread as the cube stretches. */
export class MagmaCubeEntityModel extends LegacyEntityModel {
  slices = Array.from({ length: 8 }, (_, j) => this.opt(`field_1486_${j}`))

  override animateModel(state: AnimState) {
    // MagmaCubeEntity: lastStretch + (stretch - lastStretch) * tickDelta
    const lastStretch = num(state, 'entity.lastStretch')
    let i = f(lastStretch + f(f(num(state, 'entity.stretch') - lastStretch) * num(state, 'partialTick')))
    if (i < 0) i = 0
    for (let j = 0; j < this.slices.length; j++) this.slices[j]!.y = f(f(-(4 - j) * i) * f(1.7))
  }
}

/** BlazeEntityModel: three rings of rods turning around the head. */
export class BlazeEntityModel extends LegacyEntityModel {
  rods = Array.from({ length: 12 }, (_, i) => this.part(`rods_${i}`))
  head = this.part('head')

  override setAngles(state: AnimState) {
    const { sin, cos } = this.c
    const age = num(state, 'ageInTicks')
    let l = f(f(age * PI) * f(-0.1))
    for (let m = 0; m < 4; m++) {
      this.rods[m]!.y = f(-2 + cos(f(f(m * 2 + age) * 0.25)))
      this.rods[m]!.x = f(cos(l) * 9)
      this.rods[m]!.z = f(sin(l) * 9)
      l = f(l + HALF_PI) // the decompiler prints l++: the bytecode adds 1.5707964F
    }
    l = f(f(Math.PI / 4) + f(f(age * PI) * f(0.03)))
    for (let m = 4; m < 8; m++) {
      this.rods[m]!.y = f(2 + cos(f(f(m * 2 + age) * 0.25)))
      this.rods[m]!.x = f(cos(l) * 7)
      this.rods[m]!.z = f(sin(l) * 7)
      l = f(l + HALF_PI) // the decompiler prints l++: the bytecode adds 1.5707964F
    }
    l = f(f(0.471_238_94) + f(f(age * PI) * f(-0.05)))
    for (let m = 8; m < 12; m++) {
      this.rods[m]!.y = f(11 + cos(f(f(f(m * 1.5) + age) * 0.5)))
      this.rods[m]!.x = f(cos(l) * 5)
      this.rods[m]!.z = f(sin(l) * 5)
      l = f(l + HALF_PI) // the decompiler prints l++: the bytecode adds 1.5707964F
    }
    this.head.yRot = toRad(this.c, num(state, 'yRot'))
    this.head.xRot = toRad(this.c, num(state, 'xRot'))
  }
}

/** GhastEntityModel */
export class GhastEntityModel extends LegacyEntityModel {
  tentacles = Array.from({ length: 9 }, (_, i) => this.part(`tentacles_${i}`))

  override setAngles(state: AnimState) {
    const age = num(state, 'ageInTicks')
    for (let l = 0; l < this.tentacles.length; l++) this.tentacles[l]!.xRot = f(f(f(0.2) * this.c.sin(f(f(age * f(0.3)) + l))) + f(0.4))
  }
}

/** SilverfishEntityModel / EndermiteEntityModel: the segments wiggle. */
function wiggle(m: LegacyEntityModel, segments: PartPose[], age: number, turn: number, sway: number) {
  const { sin, cos } = m.c
  for (let l = 0; l < segments.length; l++) {
    const angle = f(f(age * f(0.9)) + f(f(l * f(0.15)) * PI))
    segments[l]!.yRot = f(f(f(cos(angle) * PI) * turn) * (1 + Math.abs(l - 2)))
    segments[l]!.x = f(f(f(sin(angle) * PI) * sway) * Math.abs(l - 2))
  }
}

/** SilverfishEntityModel */
export class SilverfishEntityModel extends LegacyEntityModel {
  segments = Array.from({ length: 7 }, (_, i) => this.part(`field_1521_${i}`))
  layers = Array.from({ length: 3 }, (_, i) => this.part(`field_1522_${i}`))

  override setAngles(state: AnimState) {
    wiggle(this, this.segments, num(state, 'ageInTicks'), f(0.05), f(0.2))
    const [layer0, layer1, layer2] = this.layers as [PartPose, PartPose, PartPose]
    layer0.yRot = this.segments[2]!.yRot
    layer1.yRot = this.segments[4]!.yRot
    layer1.x = this.segments[4]!.x
    layer2.yRot = this.segments[1]!.yRot
    layer2.x = this.segments[1]!.x
  }
}

/** EndermiteEntityModel */
export class EndermiteEntityModel extends LegacyEntityModel {
  segments = Array.from({ length: 4 }, (_, i) => this.part(`field_10550_${i}`))

  override setAngles(state: AnimState) {
    wiggle(this, this.segments, num(state, 'ageInTicks'), f(0.01), f(0.1))
  }
}

/** A model whose one part turns with the head: ShulkerBulletEntityModel (field_13394), SkullEntityModel (field_5131). */
function headTurn(m: LegacyEntityModel, part: PartPose, state: AnimState) {
  part.yRot = toRad(m.c, num(state, 'yRot'))
  part.xRot = toRad(m.c, num(state, 'xRot'))
}

/** ShulkerBulletEntityModel (1.9+) */
export class ShulkerBulletEntityModel extends LegacyEntityModel {
  main = this.part('field_13394')

  override setAngles(state: AnimState) {
    headTurn(this, this.main, state)
  }
}

/** SkullEntityModel (the wither skull projectile) */
export class SkullEntityModel extends LegacyEntityModel {
  skull = this.part('field_5131')

  override setAngles(state: AnimState) {
    headTurn(this, this.skull, state)
  }
}

/** WitherEntityModel: the spine breathes, the side heads look where the wither's side heads look. */
export class WitherEntityModel extends LegacyEntityModel {
  bodies = Array.from({ length: 3 }, (_, i) => this.part(`field_5136_${i}`))
  heads = Array.from({ length: 3 }, (_, i) => this.part(`field_5137_${i}`))

  override animateModel(state: AnimState) {
    const yaws = (state['entity.sideHeadYaws'] as number[] | undefined) ?? [0, 0]
    const pitches = (state['entity.sideHeadPitches'] as number[] | undefined) ?? [0, 0]
    const bodyYaw = num(state, 'entity.bodyYaw')
    for (let i = 1; i < 3; i++) {
      this.heads[i]!.yRot = toRad(this.c, f((yaws[i - 1] ?? 0) - bodyYaw))
      this.heads[i]!.xRot = toRad(this.c, pitches[i - 1] ?? 0)
    }
  }

  override setAngles(state: AnimState) {
    const { sin, cos } = this.c
    const l = cos(f(num(state, 'ageInTicks') * f(0.1)))
    const [, body1, body2] = this.bodies as [PartPose, PartPose, PartPose]
    body1.xRot = f(f(f(0.065) + f(f(0.05) * l)) * PI)
    body2.setPos(-2, f(f(6.9) + f(cos(body1.xRot) * 10)), f(-0.5 + f(sin(body1.xRot) * 10)))
    body2.xRot = f(f(f(0.265) + f(f(0.1) * l)) * PI)
    this.heads[0]!.yRot = toRad(this.c, num(state, 'yRot'))
    this.heads[0]!.xRot = toRad(this.c, num(state, 'xRot'))
  }
}

const SPIKE_X_ROT = [1.75, 0.25, 0, 0, 0.5, 0.5, 0.5, 0.5, 1.25, 0.75, 0, 0]
const SPIKE_Y_ROT = [0, 0, 0, 0, 0.25, 1.75, 1.25, 0.75, 0, 0, 0, 0]
const SPIKE_Z_ROT = [0, 0, 0.25, 1.75, 0, 0, 0, 0, 0, 0, 0.75, 1.25]
const SPIKE_X = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8]
const SPIKE_Y = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8]
const SPIKE_Z = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0]

/** GuardianEntityModel (guardian, elder guardian) */
export class GuardianEntityModel extends LegacyEntityModel {
  body = this.part('body')
  eye = this.part('eye')
  spikes = Array.from({ length: 12 }, (_, i) => this.part(`spikes_${i}`))
  tail = Array.from({ length: 3 }, (_, i) => this.part(`tail_${i}`))

  override setAngles(state: AnimState) {
    const { sin, cos } = this.c
    const age = num(state, 'ageInTicks')
    const l = f(age - num(state, 'entity.ticksAlive'))
    this.body.yRot = toRad(this.c, num(state, 'yRot'))
    this.body.xRot = toRad(this.c, num(state, 'xRot'))
    // GuardianEntity.getTailAngle(l)
    const prevTailAngle = num(state, 'entity.prevTailAngle')
    const tailAngle = f(prevTailAngle + f(f(num(state, 'entity.tailAngle') - prevTailAngle) * l))
    const m = f(f(1 - tailAngle) * f(0.55))
    for (let n = 0; n < 12; n++) {
      const spike = this.spikes[n]!
      spike.xRot = f(PI * SPIKE_X_ROT[n]!)
      spike.yRot = f(PI * SPIKE_Y_ROT[n]!)
      spike.zRot = f(PI * SPIKE_Z_ROT[n]!)
      const spread = () => f(f(1 + f(cos(f(f(age * 1.5) + n)) * f(0.01))) - m)
      spike.x = f(SPIKE_X[n]! * spread())
      spike.y = f(16 + f(SPIKE_Y[n]! * spread()))
      spike.z = f(SPIKE_Z[n]! * spread())
    }

    this.eye.z = f(-8.25)
    // the camera entity, or the beam target (its world entity: absent unless given)
    let target = (state.cameraOffset as number[] | undefined) ?? [0, 1, -1]
    if (legacyData(state, DATA.guardianTarget(this.c), 0) !== 0) target = state.beamTargetOffset as number[]
    if (target) this.lookAt(state, target)
    this.eye.visible = true
    // GuardianEntity.getSpikesExtension(l)
    const prevSpikesExtension = num(state, 'entity.prevSpikesExtension')
    const o = f(prevSpikesExtension + f(f(num(state, 'entity.spikesExtension') - prevSpikesExtension) * l))
    const [tail0, tail1, tail2] = this.tail as [PartPose, PartPose, PartPose]
    tail0.yRot = f(f(sin(o) * PI) * f(0.05))
    tail1.yRot = f(f(sin(o) * PI) * f(0.1))
    tail1.setPos(-1.5, 0.5, 14)
    tail2.yRot = f(f(sin(o) * PI) * f(0.15))
    tail2.setPos(0.5, 0.5, 6)
  }

  /** The eye looks toward a target: offset = the target's eye position minus the guardian's (getCameraPosVec(0)). */
  lookAt(state: AnimState, offset: number[]) {
    const { sin, cos } = this.c
    const [dx = 0, dy = 0, dz = 0] = offset
    this.eye.y = dy > 0 ? 0 : 1
    // entity.getRotationVector(0): the previous pitch and head yaw
    const pitch = num(state, 'entity.prevPitch')
    const yaw = num(state, 'entity.prevHeadYaw')
    let x: number
    let z: number
    if (this.c.atLeast('1.13')) {
      const h = f(pitch * DEG_TO_RAD)
      const i = f(-yaw * DEG_TO_RAD)
      x = f(sin(i) * cos(h))
      z = f(cos(i) * cos(h))
    } else {
      const angle = f(f(-yaw * DEG_TO_RAD) - PI)
      const j = -cos(f(-pitch * DEG_TO_RAD))
      x = f(sin(angle) * j)
      z = f(cos(angle) * j)
    }
    // new Vec3d(entity.x - target.x, 0, entity.z - target.z).normalize().rotateY(PI / 2)
    let ax = -dx
    let az = -dz
    const length = f(Math.sqrt(ax * ax + 0 * 0 + az * az))
    if (length < 1e-4) {
      ax = 0
      az = 0
    } else {
      ax /= length
      az /= length
    }
    const rc = cos(HALF_PI)
    const rs = sin(HALF_PI)
    const rx = ax * rc + az * rs
    const rz = az * rc - ax * rs
    const e = x * rx + 0 * 0 + z * rz
    this.eye.x = f(f(sqrt(f(Math.abs(e))) * 2) * Math.sign(e))
  }
}

export const LEGACY_HUMANOID_MODELS: Record<string, AnimModelClass> = {
  BiPedModel,
  AbstractZombieModel,
  ZombieVillagerEntityModel,
  SkeletonEntityModel,
  EndermanEntityModel,
  ArmorStandArmorEntityModel,
  ArmorStandEntityModel,
  VexEntityModel,
  VillagerEntityModel,
  WitchEntityModel,
  class_4201,
  class_3087,
  class_3086,
  class_3091,
  CreeperEntityModel,
  SpiderEntityModel,
  // SlimeEntityModel, EnderCrystalEntityModel, EnderDragonModel: no setAngles (the dragon and the crystal pose in render)
  SlimeEntityModel: LegacyEntityModel,
  MagmaCubeEntityModel,
  BlazeEntityModel,
  GhastEntityModel,
  SilverfishEntityModel,
  EndermiteEntityModel,
  ShulkerBulletEntityModel,
  WitherEntityModel,
  EnderDragonModel: LegacyEntityModel,
  GuardianEntityModel,
  EnderCrystalEntityModel: LegacyEntityModel,
  SkullEntityModel
}
