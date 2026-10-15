import { AnimModel, type AnimModelClass, type AnimState } from '../types'
import { DEG_TO_RAD, PI, f, triangleWave } from '../mth'

/**
 * The other models of 1.8.9 - 1.13.2 (legacy Yarn names): iron golem, snow golem, shulker (1.9+; class_4195 in 1.13.2)
 * and its bullet, boat, minecart, leash knot, wither skull, end crystal, llama spit (1.11+), elytra (1.11+), evoker
 * fangs (1.11+), posed from the entity: animateModel(entity, limbAngle, limbDistance, tickDelta) then setAngles(limbAngle,
 * limbDistance, age, headYaw, headPitch, scale, entity) (the decompiled parameter names are off by one: `age` is the head
 * yaw, `tickDelta` the age in ticks). Parts are the legacy layer's (field names: field_1551 ..., arrays as
 * boat_parts_<n> / field_13379_<n>); rotations are ModelPart.posX/Y/Z, positions pivotX/Y/Z.
 *
 * Several of these models move parts only in their render(), which the samples (setAngles) don't cover and the ports
 * here don't do either: the boat's paddles (see BoatEntityModel), the minecart's inner floor (field_1488[5].pivotY =
 * 4.0F - tickDelta, the renderer passes -0.1F: y 4.1), the evoker fangs' jaws (from the animation progress passed as
 * limbAngle) and the end crystal's frames and core (GL rotations by the age).
 */

/** A synched data value by its index, or the data's default when the sample has none (no data names before 1.14). */
const data = (state: AnimState, index: number, fallback: unknown): any => state[`data.${index}`] ?? fallback

/** an entity field (legacy Yarn name), or its default */
const entity = (state: AnimState, name: string, fallback: unknown): any => state[`entity.${name}`] ?? fallback

/** An input of the state; absent = 0 (the base inputs too: a sample may leave them out). */
const num = (state: AnimState, name: string) => (state[name] as number | undefined) ?? 0

/** Entity flags, synched data index 0 in every legacy version. */
const FLAGS = 0
/** Entity.getFlag(index): 1 sneaking, 7 fall flying (LivingEntity.method_13055, 1.9+) */
const entityFlag = (state: AnimState, index: number) => ((data(state, FLAGS, 0) as number) & (1 << index)) !== 0

/** 1.8.9 divides by the folded constant 180.0F / (float) Math.PI; 1.9 on, multiplies by (float) (Math.PI / 180.0) */
const DEGREES_PER_RADIAN_1_8 = f(180 / PI)

/** MathHelper.clampedLerp(double start, double end, double delta) */
const clampedLerpDouble = (start: number, end: number, delta: number) => (delta < 0 ? start : delta > 1 ? end : start + (end - start) * delta)

/** EntityModel: animateModel then setAngles, from the initial pose (both empty in EntityModel). */
class LegacyEntityModel extends AnimModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.animateModel(state)
    this.setAngles(state)
  }

  animateModel(_state: AnimState) {}

  setAngles(_state: AnimState) {}

  /** headYaw / headPitch (degrees) in radians, as the version writes it */
  protected radians(degrees: number) {
    return this.c.atLeast('1.9') ? f(degrees * DEG_TO_RAD) : f(degrees / DEGREES_PER_RADIAN_1_8)
  }
}

/** IronGolemEntityModel: head, swinging legs; the arms from the attack / flower-offering ticks or the walk. */
export class IronGolemEntityModel extends LegacyEntityModel {
  field_1551 = this.part('field_1551') // head
  field_1553 = this.part('field_1553') // right arm
  field_1554 = this.part('field_1554') // left arm
  field_1555 = this.part('field_1555') // right leg
  field_1556 = this.part('field_1556') // left leg

  override setAngles(state: AnimState) {
    const handSwing = num(state, 'walkAnimationPos')
    const handSwingAmount = num(state, 'walkAnimationSpeed')
    this.field_1551.yRot = this.radians(num(state, 'yRot'))
    this.field_1551.xRot = this.radians(num(state, 'xRot'))
    this.field_1555.xRot = f(f(-1.5 * this.method_1182(handSwing, 13)) * handSwingAmount)
    this.field_1556.xRot = f(f(1.5 * this.method_1182(handSwing, 13)) * handSwingAmount)
    this.field_1555.yRot = 0
    this.field_1556.yRot = 0
  }

  override animateModel(state: AnimState) {
    const limbAngle = num(state, 'walkAnimationPos')
    const limbDistance = num(state, 'walkAnimationSpeed')
    const tickDelta = num(state, 'partialTick')
    // getAttackTicksLeft(), getLookingAtVillagerTicks(): the entity's int fields
    const i = entity(state, 'attackTicksLeft', 0) as number
    if (i > 0) {
      this.field_1553.xRot = f(-2 + f(1.5 * this.method_1182(f(i - tickDelta), 10)))
      this.field_1554.xRot = f(-2 + f(1.5 * this.method_1182(f(i - tickDelta), 10)))
    } else {
      const j = entity(state, 'lookingAtVillagerTicksLeft', 0) as number
      if (j > 0) {
        this.field_1553.xRot = f(f(-0.8) + f(f(0.025) * this.method_1182(j, 70)))
        this.field_1554.xRot = 0
      } else {
        this.field_1553.xRot = f(f(f(-0.2) + f(1.5 * this.method_1182(limbAngle, 13))) * limbDistance)
        this.field_1554.xRot = f(f(f(-0.2) - f(1.5 * this.method_1182(limbAngle, 13))) * limbDistance)
      }
    }
  }

  /** (Math.abs(f % g - g * 0.5F) - g * 0.25F) / (g * 0.25F) */
  private method_1182(value: number, period: number) {
    return triangleWave(value, period)
  }
}

/** SnowmanEntityModel: head, the middle snowball turning with a quarter of the head yaw, the arms around it. */
export class SnowmanEntityModel extends LegacyEntityModel {
  field_1530 = this.part('field_1530') // middle
  field_1532 = this.part('field_1532') // head
  field_1533 = this.part('field_1533') // right arm
  field_1534 = this.part('field_1534') // left arm

  override setAngles(state: AnimState) {
    const { sin, cos } = this.c
    this.field_1532.yRot = this.radians(num(state, 'yRot'))
    this.field_1532.xRot = this.radians(num(state, 'xRot'))
    this.field_1530.yRot = f(this.radians(num(state, 'yRot')) * 0.25)
    const l = sin(this.field_1530.yRot)
    const m = cos(this.field_1530.yRot)
    this.field_1533.zRot = 1
    this.field_1534.zRot = -1
    this.field_1533.yRot = f(0 + this.field_1530.yRot)
    this.field_1534.yRot = f(PI + this.field_1530.yRot)
    this.field_1533.x = f(m * 5)
    this.field_1533.z = f(-l * 5)
    this.field_1534.x = f(-m * 5)
    this.field_1534.z = f(l * 5)
  }
}

/**
 * ShulkerEntityModel (1.9 - 1.12.2) / class_4195 (1.13.2, the same code with other field names): the lid rises and
 * twists with the peek amount, the head looks. The entity's peek amounts are `entity.field_14767` (previous) and
 * `entity.field_14768` (current), lerped by ageInTicks - ticksAlive (`entity.ticksAlive`, the entity's age in whole
 * ticks; the samples leave it at 0, so the lerp factor is the whole ageInTicks).
 */
export class ShulkerEntityModel extends LegacyEntityModel {
  lid = this.part(this.c.atLeast('1.13') ? 'field_20588' : 'field_13397')
  head = this.part(this.c.atLeast('1.13') ? 'field_20589' : 'field_13395')

  override setAngles(state: AnimState) {
    const { sin } = this.c
    const age = num(state, 'ageInTicks')
    const l = f(age - (entity(state, 'ticksAlive', 0) as number))
    const m = f(f(0.5 + this.method_13220(state, l)) * PI)
    const n = f(-1 + sin(m))
    let o = 0
    if (m > PI) o = f(sin(f(age * f(0.1))) * f(0.7))
    // setPivot(0.0F, 16.0F + MathHelper.sin(m) * 8.0F + o, 0.0F)
    this.lid.x = 0
    this.lid.y = f(f(16 + f(sin(m) * 8)) + o)
    this.lid.z = 0
    if (this.method_13220(state, l) > f(0.3)) {
      this.lid.yRot = f(f(f(f(f(f(n * n) * n) * n) * PI) * f(0.125)))
    } else {
      this.lid.yRot = 0
    }
    this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
    this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
  }

  /** ShulkerEntity.method_13220(f): field_14767 + (field_14768 - field_14767) * f */
  private method_13220(state: AnimState, delta: number) {
    const from = entity(state, 'field_14767', 0) as number
    const to = entity(state, 'field_14768', 0) as number
    return f(from + f(f(to - from) * delta))
  }
}

/** A model whose only part looks where the entity looks: setAngles sets its yaw and pitch. */
abstract class LookingModel extends LegacyEntityModel {
  abstract readonly looking: ReturnType<AnimModel['part']>

  override setAngles(state: AnimState) {
    this.looking.yRot = this.radians(num(state, 'yRot'))
    this.looking.xRot = this.radians(num(state, 'xRot'))
  }
}

/** ShulkerBulletEntityModel (1.9+) */
export class ShulkerBulletEntityModel extends LookingModel {
  looking = this.part('field_13394')
}

/** LeashEntityModel: the knot */
export class LeashEntityModel extends LookingModel {
  looking = this.part('field_6395')
}

/** SkullEntityModel: the wither skull projectile's model (the sampled layer) */
export class SkullEntityModel extends LookingModel {
  looking = this.part('field_5131')
}

/**
 * ElytraModel (1.11+): the wings spread when fall flying (entity flag 7; damped by the downward velocity:
 * `entity.velocityX/Y/Z`, 0 when absent), fold when sneaking (flag 1), else rest. A player smooths the angles over
 * frames in its own fields (AbstractClientPlayerEntity field_13449 / field_13450 / field_13451, the x, y and z
 * rotations): given as `entity.field_13449`... (the state is a player then), the pose is one smoothing step from them.
 */
export class ElytraModel extends LegacyEntityModel {
  field_13382 = this.part('field_13382') // right wing
  field_13383 = this.part('field_13383') // left wing

  override setAngles(state: AnimState) {
    let l = f(Math.PI / 12)
    let m = f(-Math.PI / 12)
    let n = 0
    let o = 0
    // LivingEntity.method_13055 (fall flying): getFlag(7)
    if (entityFlag(state, 7)) {
      let p = 1
      const velocityX = entity(state, 'velocityX', 0) as number
      const velocityY = entity(state, 'velocityY', 0) as number
      const velocityZ = entity(state, 'velocityZ', 0) as number
      if (velocityY < 0) {
        // Vec3d.normalize: length = MathHelper.sqrt (a float), a zero vector stays zero (length < 1.0E-4)
        const length = f(Math.sqrt(velocityX * velocityX + velocityY * velocityY + velocityZ * velocityZ))
        const y = length < 1.0e-4 ? 0 : velocityY / length
        p = f(1 - f(Math.pow(-y, 1.5)))
      }
      l = f(f(p * f(Math.PI / 9)) + f(f(1 - p) * l))
      m = f(f(p * f(-Math.PI / 2)) + f(f(1 - p) * m))
    } else if (entityFlag(state, 1)) {
      l = f((Math.PI * 2) / 9)
      m = f(-Math.PI / 4)
      n = 3
      o = f(0.087_266_46)
    }

    this.field_13383.x = 5
    this.field_13383.y = n
    const rotX = state['entity.field_13449'] as number | undefined
    if (rotX !== undefined) {
      // (float) (field + (target - field) * 0.1): the player's smoothed angles
      const rotY = entity(state, 'field_13450', 0) as number
      const rotZ = entity(state, 'field_13451', 0) as number
      this.field_13383.xRot = f(rotX + f(l - rotX) * 0.1)
      this.field_13383.yRot = f(rotY + f(o - rotY) * 0.1)
      this.field_13383.zRot = f(rotZ + f(m - rotZ) * 0.1)
    } else {
      this.field_13383.xRot = l
      this.field_13383.zRot = m
      this.field_13383.yRot = o
    }

    this.field_13382.x = -this.field_13383.x
    this.field_13382.yRot = -this.field_13383.yRot
    this.field_13382.y = this.field_13383.y
    this.field_13382.xRot = this.field_13383.xRot
    this.field_13382.zRot = -this.field_13383.zRot
  }
}

/**
 * BoatEntityModel: setAngles is empty (the samples: nothing moves). The paddles (1.9+, field_13379_0 / field_13379_1) are
 * posed in render() (method_12219), from the entity, not by setAngles; `posePaddle` below is that code, for a renderer
 * that rows. Rowing needs, per paddle i (0 left, 1 right): BoatEntity.interpolatePaddlePhase(i, partialTick) =
 * isPaddleMoving(i) ? (float) clampedLerp(paddlePhases[i] - step, paddlePhases[i], partialTick) : 0, where
 * isPaddleMoving(i) is the synched boolean PADDLES_MOVING[i] (data 9 / 10 in 1.9.4, 10 / 11 in 1.10 - 1.13.2) and a
 * controlling passenger, paddlePhases[i] the client-side phase (+ step each tick while moving, else 0), step 0.01 before
 * 1.12 (the model multiplies the phase by 40) and (float) (PI / 8) from 1.12 on. 1.8.9's boat has no paddles.
 */
export class BoatEntityModel extends LegacyEntityModel {
  /**
   * The paddles as render() poses them every frame, when the renderer gives the rowing times (entity.rowingTimes: the
   * interpolated paddle phases, 0 while a paddle is still: the paddle's resting angle); the samples (setAngles alone)
   * give none.
   */
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const rowing = state['entity.rowingTimes'] as number[] | undefined
    if (rowing && this.c.atLeast('1.9')) {
      this.posePaddle(0, rowing[0] ?? 0)
      this.posePaddle(1, rowing[1] ?? 0)
    }
  }

  /** method_12219(boat, i, scale, tickDelta) without the render: paddle i at phase interpolatePaddlePhase(i, tickDelta) */
  posePaddle(i: 0 | 1, interpolatedPhase: number) {
    const { sin } = this.c
    const paddle = this.part(`field_13379_${i}`)
    const j = this.c.atLeast('1.12') ? interpolatedPhase : f(interpolatedPhase * 40)
    paddle.xRot = f(clampedLerpDouble(f(-Math.PI / 3), f(-Math.PI / 12), f(f(sin(-j) + 1) / 2)))
    paddle.yRot = f(clampedLerpDouble(f(-Math.PI / 4), f(Math.PI / 4), f(f(sin(f(-j + 1)) + 1) / 2)))
    if (i === 1) paddle.yRot = f(PI - paddle.yRot)
  }
}

export const LEGACY_MISC_MODELS: Record<string, AnimModelClass> = {
  IronGolemEntityModel,
  SnowmanEntityModel,
  ShulkerEntityModel,
  // 1.13.2's shulker model, unnamed in its Yarn
  class_4195: ShulkerEntityModel,
  ShulkerBulletEntityModel,
  LeashEntityModel,
  SkullEntityModel,
  ElytraModel,
  BoatEntityModel,
  // render() only (see the file's comment): nothing to pose in setAngles
  MinecartEntityModel: AnimModel,
  EvokerFangsEntityModel: AnimModel,
  EnderCrystalEntityModel: AnimModel,
  LlamaSpitModel: AnimModel
}
