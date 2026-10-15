import { AnimModel, type AnimModelClass, type AnimState } from '../types'
import { DEG_TO_RAD, PI, f, rotLerpRad } from '../mth'
import type { PartPose } from '../modelPose'
import { AbstractZombieModel, LegacyEntityModel } from './humanoid'

/**
 * The 1.13 models legacy Yarn (1.13.2+build.541) left unnamed (root-package `net.minecraft.class_NNNN`): the aquatic
 * mobs, the phantom, the drowned and the trident. Each: animateModel(entity, limbAngle, limbDistance, tickDelta) then
 * setAngles(limbAngle, limbDistance, age, headYaw, headPitch, scale, entity), from the initial pose (rotations are
 * ModelPart.posX/Y/Z, positions pivotX/Y/Z; parts are the legacy layer's, named by their field_NNNNN).
 *
 * Inputs beyond the fixture's (absent: their defaults):
 * - `entity.touchingWater` (Entity.isTouchingWater; false: the fixtures' fish were sampled out of water): the cod,
 *   salmon and tropical fish tails beat faster and wider on land;
 * - `entity.id` (Entity.getEntityId; default 1_000_000, see DEFAULT_ENTITY_ID): the phantom's flap offset;
 * - `entity.velocityX` / `entity.velocityZ` (0): a moving dolphin swims (body, tail and fin beat);
 * - `item.mainhand` ('trident'): a drowned holding a trident with its arms raised (data 14) aims it (THROW_SPEAR).
 */

const num = (state: AnimState, key: string, defaultValue = 0): number => (state[key] as number | undefined) ?? defaultValue

/** Entity.isTouchingWater (the touchingWater field) */
const isTouchingWater = (state: AnimState) => !!state['entity.touchingWater']

/**
 * The fixtures' entities have ids around a million (the sample generator's world), which makes the phantom's flap angle
 * overflow the sin table's int index the same way at any age: this default reproduces it (as entityEra PhantomModel).
 */
const DEFAULT_ENTITY_ID = 1_000_000

/** 1.13.2 ZombieEntity armsRaised (field_14788, method_13247) */
const ZOMBIE_ARMS_RAISED = 14
/** 1.13.2 MobEntity flags (field_6193; bit 2: left handed) */
const MOB_FLAGS = 11

/** class_4183: CodEntity's model. The tail fin (field_20532) beats. */
export class class_4183 extends LegacyEntityModel {
  tailFin = this.part('field_20532')

  override setAngles(state: AnimState) {
    const { sin } = this.c
    const age = num(state, 'ageInTicks')
    let l = 1
    if (!isTouchingWater(state)) l = 1.5
    this.tailFin.yRot = f(f(-l * f(0.45)) * sin(f(f(0.6) * age)))
  }
}

/** class_4194: SalmonEntity's model. The back half (field_20580, with its fins) beats. */
export class class_4194 extends LegacyEntityModel {
  tail = this.part('field_20580')

  override setAngles(state: AnimState) {
    const { sin } = this.c
    const age = num(state, 'ageInTicks')
    let l = 1
    let m = 1
    if (!isTouchingWater(state)) {
      l = f(1.3)
      m = f(1.7)
    }
    this.tail.yRot = f(f(-l * 0.25) * sin(f(f(m * f(0.6)) * age)))
  }
}

/** class_4198: TropicalFishEntity's small (shape A) model. The tail (field_20595) beats. */
export class class_4198 extends LegacyEntityModel {
  tail = this.part('field_20595')

  override setAngles(state: AnimState) {
    const { sin } = this.c
    const age = num(state, 'ageInTicks')
    let l = 1
    if (!isTouchingWater(state)) l = 1.5
    this.tail.yRot = f(f(-l * f(0.45)) * sin(f(f(0.6) * age)))
  }
}

/** class_4199: TropicalFishEntity's large (shape B) model. The tail (field_20600) beats. */
export class class_4199 extends LegacyEntityModel {
  tail = this.part('field_20600')

  override setAngles(state: AnimState) {
    const { sin } = this.c
    const age = num(state, 'ageInTicks')
    let l = 1
    if (!isTouchingWater(state)) l = 1.5
    this.tail.yRot = f(f(-l * f(0.45)) * sin(f(f(0.6) * age)))
  }
}

/** The pufferfish models: the two side fins flap (`-0.2F + 0.4F * sin(age * 0.2F)`, mirrored). */
function pufferfishFins(m: LegacyEntityModel, rightFin: PartPose, leftFin: PartPose, state: AnimState) {
  const { sin } = m.c
  const age = num(state, 'ageInTicks')
  rightFin.zRot = f(f(-0.2) + f(f(0.4) * sin(f(age * f(0.2)))))
  leftFin.zRot = f(f(0.2) - f(f(0.4) * sin(f(age * f(0.2)))))
}

/** class_4191: PufferfishEntity's fully puffed (big, 8x8x8) model. */
export class class_4191 extends LegacyEntityModel {
  rightFin = this.part('field_20550')
  leftFin = this.part('field_20551')

  override setAngles(state: AnimState) {
    pufferfishFins(this, this.rightFin, this.leftFin, state)
  }
}

/** class_4192: PufferfishEntity's half puffed (medium, 5x5x5) model. */
export class class_4192 extends LegacyEntityModel {
  rightFin = this.part('field_20563')
  leftFin = this.part('field_20564')

  override setAngles(state: AnimState) {
    pufferfishFins(this, this.rightFin, this.leftFin, state)
  }
}

/** class_4193: PufferfishEntity's deflated (small, 3x2x3) model. */
export class class_4193 extends LegacyEntityModel {
  rightFin = this.part('field_20576')
  leftFin = this.part('field_20577')

  override setAngles(state: AnimState) {
    pufferfishFins(this, this.rightFin, this.leftFin, state)
  }
}

/**
 * class_4190: PhantomEntity's model. The wings (field_20542 / field_20544, tips field_20543 / field_20545) flap and the
 * tail (field_20547, tip field_20548) sways from `(getEntityId() * 3 + age) * 0.13F`.
 */
export class class_4190 extends LegacyEntityModel {
  leftWingBase = this.part('field_20542')
  leftWingTip = this.part('field_20543')
  rightWingBase = this.part('field_20544')
  rightWingTip = this.part('field_20545')
  tailBase = this.part('field_20547')
  tailTip = this.part('field_20548')

  override setAngles(state: AnimState) {
    const { cos } = this.c
    // getEntityId() * 3, an int, plus age in float
    const offset = Math.imul(num(state, 'entity.id', DEFAULT_ENTITY_ID), 3)
    const l = f(f(offset + num(state, 'ageInTicks')) * f(0.13))
    this.leftWingBase.zRot = f(f(0 + f(cos(l) * 16)) * DEG_TO_RAD)
    this.leftWingTip.zRot = f(f(0 + f(cos(l) * 16)) * DEG_TO_RAD)
    this.rightWingBase.zRot = -this.leftWingBase.zRot
    this.rightWingTip.zRot = -this.leftWingTip.zRot
    this.tailBase.xRot = f(-f(5 + f(cos(f(l * 2)) * 5)) * DEG_TO_RAD)
    this.tailTip.xRot = f(-f(5 + f(cos(f(l * 2)) * 5)) * DEG_TO_RAD)
  }
}

/**
 * class_4254: DolphinEntity's model. The body (field_20916) turns with the head angles; a moving dolphin (velocityX or
 * velocityZ not 0) beats its body, tail (field_20917) and tail fin (field_20918).
 */
export class class_4254 extends LegacyEntityModel {
  body = this.part('field_20916')
  tail = this.part('field_20917')
  tailFin = this.part('field_20918')

  override setAngles(state: AnimState) {
    const { cos } = this.c
    const age = num(state, 'ageInTicks')
    this.body.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
    this.body.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    // entity instanceof DolphinEntity: always, for this model
    if (num(state, 'entity.velocityX') !== 0 || num(state, 'entity.velocityZ') !== 0) {
      this.body.xRot = f(this.body.xRot + f(f(-0.05) + f(f(-0.05) * cos(f(age * f(0.3))))))
      this.tail.xRot = f(f(-0.1) * cos(f(age * f(0.3))))
      this.tailFin.xRot = f(f(-0.2) * cos(f(age * f(0.3))))
    }
  }
}

/** (float) (-Math.PI * 4.0 / 5.0) */
const DROWNED_SWIM_ARM = f((-Math.PI * 4) / 5)

/**
 * class_4185: DrownedEntity's model (and its outer layer / armor), an AbstractZombieModel: a drowned holding a trident
 * with its arms raised aims it with its main arm (THROW_SPEAR), and swims with its arms forward.
 */
export class class_4185 extends AbstractZombieModel {
  override animateModel(state: AnimState) {
    this.rightArmPose = 'EMPTY'
    this.leftArmPose = 'EMPTY'
    // getStackInHand(MAIN_HAND) is a trident && method_13247 (armsRaised)
    if (state['item.mainhand'] === 'trident' && !!(state[`data.${ZOMBIE_ARMS_RAISED}`] ?? false)) {
      // getDurability (the main arm): left handed when the mob flags' bit 2 is set
      if ((num(state, `data.${MOB_FLAGS}`) & 2) === 0) {
        this.rightArmPose = 'THROW_SPEAR'
      } else {
        this.leftArmPose = 'THROW_SPEAR'
      }
    }
    super.animateModel(state)
  }

  override setAngles(state: AnimState) {
    super.setAngles(state)
    const { sin } = this.c
    const age = num(state, 'ageInTicks')
    if (this.leftArmPose === 'THROW_SPEAR') {
      this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - PI)
      this.leftArm.yRot = 0
    }
    if (this.rightArmPose === 'THROW_SPEAR') {
      this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - PI)
      this.rightArm.yRot = 0
    }
    const swim = this.swimAmount
    if (swim > 0) {
      const stroke = sin(f(f(0.1) * age))
      this.rightArm.xRot = f(rotLerpRad(swim, this.rightArm.xRot, DROWNED_SWIM_ARM) + f(f(swim * f(0.35)) * stroke))
      this.leftArm.xRot = f(rotLerpRad(swim, this.leftArm.xRot, DROWNED_SWIM_ARM) - f(f(swim * f(0.35)) * stroke))
      this.rightArm.zRot = rotLerpRad(swim, this.rightArm.zRot, f(-0.15))
      this.leftArm.zRot = rotLerpRad(swim, this.leftArm.zRot, f(0.15))
      this.leftLeg.xRot = f(this.leftLeg.xRot - f(f(swim * f(0.55)) * stroke))
      this.rightLeg.xRot = f(this.rightLeg.xRot + f(f(swim * f(0.55)) * stroke))
      this.head.xRot = 0
    }
  }
}

export const LEGACY_UNNAMED_MODELS: Record<string, AnimModelClass> = {
  class_4183,
  class_4185,
  class_4190,
  class_4191,
  class_4192,
  class_4193,
  class_4194,
  // the trident (TridentEntity): no animation
  class_4197: AnimModel,
  class_4198,
  class_4199,
  class_4254
}
