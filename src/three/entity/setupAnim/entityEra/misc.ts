import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, clamp, f, lerp, rotLerp, triangleWave } from '../mth'
import { applyKeyframes } from '../keyframes'

/**
 * Golems, villagers, illagers, witches, wardens, breezes, armor stands, minecarts, boats, leash knots, elytras and evoker
 * fangs, 1.14.4 - 1.21.1: posed from the entity (prepareMobModel then setupAnim), as the version's classes do.
 * 1.14.4 - 1.16.5 draw the legacy layers, whose parts are the classes' fields (leg0, arm1, piece1, cubes_5...); 1.17 on,
 * the layer definitions' names. Entity-era state: walkAnimationPos (limbSwing), walkAnimationSpeed (limbSwingAmount),
 * ageInTicks, yRot (netHeadYaw), xRot (headPitch), partialTick, model.<field>, data.<index> (read by name through
 * state.dataNames), entity.<field>, item.mainhand / item.offhand.
 *
 * What the renderer must provide besides (absent: the value a fresh entity has):
 * - illagers: state.entityClass ('Evoker', 'Illusioner', 'Pillager', 'Vindicator': getArmPose is the entity class's;
 *   guessed from the synched data names when absent, an illusioner then passes for an evoker),
 *   entity.ticksUsingItem (LivingEntity.getTicksUsingItem, a pillager charging its crossbow) and
 *   entity.crossbowChargeDuration (CrossbowItem.getChargeDuration, 25 without quick charge);
 * - iron golems: entity.attackAnimationTick, entity.offerFlowerTick;
 * - witches: entity.id, entity.tickCount (the nose wobble);
 * - wardens: entity.tickCount, entity.tendrilAnimation(O) and the AnimationStates ({lastTime, accumulatedTime} or null);
 * - breezes: the AnimationStates entity.shoot, entity.slide, entity.slideBack, entity.longJump;
 * - armor stands: entity.yRot / entity.yRotO (the stand's own yaw, degrees: 180 when absent, the sampled stand's);
 *   the poses are the synched data head_pose ... right_leg_pose ([x, y, z] or {x, y, z}, degrees);
 * - elytras: entity.deltaMovement ([x, y, z], while fall flying); for a player entity.elytraRotX/Y/Z (the wings' eased
 *   rotations before this frame: the model writes back the next values to entity.elytraRot* of the state);
 * - boats: entity.paddlePositions ([left, right]) with the synched data id_paddle_left / id_paddle_right.
 */

const DEG = DEG_TO_RAD

/** An input of the state; absent = 0. */
const num = (state: AnimState, name: string) => (state[name] as number | undefined) ?? 0

/** An entity field, or its default when absent. */
const entity = <T>(state: AnimState, name: string, fallback: T): T => {
  const value = state[`entity.${name}`]
  return value === undefined || value === null ? fallback : (value as T)
}

/** The entity's synched data by its name (state.dataNames: index -> name), or the define(...) default when absent. */
const data = <T>(state: AnimState, name: string, fallback: T): T => {
  const names = (state.dataNames ?? {}) as Record<string, string>
  for (const index of Object.keys(names)) {
    if (names[index] === name) {
      const value = state[`data.${index}`]
      return value === undefined || value === null ? fallback : (value as T)
    }
  }
  return fallback
}

const hasData = (state: AnimState, name: string) => Object.values((state.dataNames ?? {}) as Record<string, string>).includes(name)

/** Mob.isAggressive / Mob.getMainArm: the mob flags (bit 2 aggressive, bit 1 left handed). */
const isAggressive = (state: AnimState) => (data(state, 'mob_flags', 0) & 4) !== 0
const mainArm = (state: AnimState) => ((data(state, 'mob_flags', 0) & 2) !== 0 ? 'LEFT' : 'RIGHT')

type AnimationStateValue = { lastTime: number; accumulatedTime: number } | null | undefined

/**
 * HierarchicalModel.animate(AnimationState, definition, ageInTicks, speed) of 1.19 - 1.21.1: AnimationState.updateTime
 * (on a copy of the state's value) then the keyframes at the accumulated time.
 */
function animate(model: AnimModel, value: AnimationStateValue, name: string, ageInTicks: number, speed = 1) {
  if (value === null || value === undefined) return
  // updateTime: l = Mth.lfloor(ageInTicks * 1000 / 20), accumulatedTime += (long) ((float) (l - lastTime) * speed)
  const l = Math.floor(f(f(ageInTicks * 1000) / 20))
  const accumulatedTime = value.accumulatedTime + Math.trunc(f(f(l - value.lastTime) * speed))
  applyKeyframes(model.model, model.c, name, accumulatedTime, 1)
}

/** Mth.clampedLerp(double start, double end, double delta) (the boats' paddles before 1.17). */
const clampedLerpDouble = (start: number, end: number, delta: number) => (delta < 0 ? start : delta > 1 ? end : start + delta * (end - start))

/** Mth.clampedLerp(float start, float end, float delta) (1.17 on). */
const clampedLerpFloat = (start: number, end: number, delta: number) => (delta < 0 ? start : delta > 1 ? end : lerp(delta, start, end))

/**
 * EntityModel of the entity era: the game calls prepareMobModel then setupAnim on the model; here setupAnim resets the
 * pose (every sample starts from the initial pose), then runs both. entitySetupAnim is the Java setupAnim (overrides call
 * super.entitySetupAnim where the Java calls super.setupAnim).
 */
export class EntityEraModel extends AnimModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.prepareMobModel(state)
    this.entitySetupAnim(state)
  }

  prepareMobModel(_state: AnimState) {}

  entitySetupAnim(_state: AnimState) {}
}

/** IronGolemModel (the legacy fields: arm0 right, arm1 left, leg0 right, leg1 left) */
export class IronGolemModel extends EntityEraModel {
  legacy = !this.c.atLeast('1.17')
  head = this.part('head')
  rightArm = this.part(this.legacy ? 'arm0' : 'right_arm')
  leftArm = this.part(this.legacy ? 'arm1' : 'left_arm')
  rightLeg = this.part(this.legacy ? 'leg0' : 'right_leg')
  leftLeg = this.part(this.legacy ? 'leg1' : 'left_leg')

  override entitySetupAnim(state: AnimState) {
    const pos = num(state, 'walkAnimationPos')
    const speed = num(state, 'walkAnimationSpeed')
    this.head.yRot = f(num(state, 'yRot') * DEG)
    this.head.xRot = f(num(state, 'xRot') * DEG)
    this.rightLeg.xRot = f(f(-1.5 * triangleWave(pos, 13)) * speed)
    this.leftLeg.xRot = f(f(1.5 * triangleWave(pos, 13)) * speed)
    this.rightLeg.yRot = 0
    this.leftLeg.yRot = 0
  }

  override prepareMobModel(state: AnimState) {
    const pos = num(state, 'walkAnimationPos')
    const speed = num(state, 'walkAnimationSpeed')
    const partialTick = num(state, 'partialTick')
    const attackTick = entity(state, 'attackAnimationTick', 0)
    if (attackTick > 0) {
      this.rightArm.xRot = f(-2 + f(1.5 * triangleWave(f(attackTick - partialTick), 10)))
      this.leftArm.xRot = f(-2 + f(1.5 * triangleWave(f(attackTick - partialTick), 10)))
    } else {
      const offerFlowerTick = entity(state, 'offerFlowerTick', 0)
      if (offerFlowerTick > 0) {
        this.rightArm.xRot = f(f(-0.8) + f(f(0.025) * triangleWave(offerFlowerTick, 70)))
        this.leftArm.xRot = 0
      } else {
        this.rightArm.xRot = f(f(f(-0.2) + f(1.5 * triangleWave(pos, 13))) * speed)
        this.leftArm.xRot = f(f(f(-0.2) - f(1.5 * triangleWave(pos, 13))) * speed)
      }
    }
  }
}

/** SnowGolemModel (the legacy fields: piece1 the upper body, arm1 left, arm2 right) */
export class SnowGolemModel extends EntityEraModel {
  legacy = !this.c.atLeast('1.17')
  head = this.part('head')
  upperBody = this.part(this.legacy ? 'piece1' : 'upper_body')
  leftArm = this.part(this.legacy ? 'arm1' : 'left_arm')
  rightArm = this.part(this.legacy ? 'arm2' : 'right_arm')

  override entitySetupAnim(state: AnimState) {
    const { sin, cos } = this.c
    const yRot = num(state, 'yRot')
    this.head.yRot = f(yRot * DEG)
    this.head.xRot = f(num(state, 'xRot') * DEG)
    this.upperBody.yRot = f(f(yRot * DEG) * 0.25)
    const s = sin(this.upperBody.yRot)
    const c = cos(this.upperBody.yRot)
    if (this.legacy) {
      this.leftArm.zRot = 1
      this.rightArm.zRot = -1
      this.leftArm.yRot = f(0 + this.upperBody.yRot)
      this.rightArm.yRot = f(PI + this.upperBody.yRot)
    } else {
      this.leftArm.yRot = this.upperBody.yRot
      this.rightArm.yRot = f(this.upperBody.yRot + PI)
    }
    this.leftArm.x = f(c * 5)
    this.leftArm.z = f(-s * 5)
    this.rightArm.x = f(-c * 5)
    this.rightArm.z = f(s * 5)
  }
}

/** VillagerModel (villagers, wandering traders; the base of WitchModel). Legacy fields: leg0 right, leg1 left, arms. */
export class VillagerModel extends EntityEraModel {
  legacy = !this.c.atLeast('1.17')
  head = this.part('head')
  arms = this.legacy ? this.part('arms') : undefined
  rightLeg = this.part(this.legacy ? 'leg0' : 'right_leg')
  leftLeg = this.part(this.legacy ? 'leg1' : 'left_leg')

  override entitySetupAnim(state: AnimState) {
    const { sin, cos } = this.c
    const pos = num(state, 'walkAnimationPos')
    const speed = num(state, 'walkAnimationSpeed')
    // AbstractVillager.getUnhappyCounter (a witch has none)
    const unhappy = data(state, 'unhappy_counter', 0) > 0
    this.head.yRot = f(num(state, 'yRot') * DEG)
    this.head.xRot = f(num(state, 'xRot') * DEG)
    if (unhappy) {
      this.head.zRot = f(f(0.3) * sin(f(f(0.45) * num(state, 'ageInTicks'))))
      this.head.xRot = f(0.4)
    } else {
      this.head.zRot = 0
    }
    if (this.arms) {
      this.arms.y = 3
      this.arms.z = -1
      this.arms.xRot = f(-0.75)
    }
    this.rightLeg.xRot = f(f(f(cos(f(pos * f(0.6662))) * f(1.4)) * speed) * 0.5)
    this.leftLeg.xRot = f(f(f(cos(f(f(pos * f(0.6662)) + PI)) * f(1.4)) * speed) * 0.5)
    this.rightLeg.yRot = 0
    this.leftLeg.yRot = 0
  }
}

/** WitchModel: the nose wobbles (by the entity's id and age), turned down while drinking (model.holdingItem). */
export class WitchModel extends VillagerModel {
  nose = this.part('nose')

  override entitySetupAnim(state: AnimState) {
    super.entitySetupAnim(state)
    const { sin, cos } = this.c
    // 1.14.4 moves the nose with ModelPart.translateX/Y/Z (0 here, 0.1875 down and 0.09375 forward holding an item),
    // which the export adds to the position (x16): the same positions as setPos of 1.15 on
    this.nose.setPos(0, -2, 0)
    const id = entity(state, 'id', 0)
    const tickCount = entity(state, 'tickCount', 0)
    const k = f(f(0.01) * (id % 10))
    this.nose.xRot = f(f(sin(f(tickCount * k)) * 4.5) * DEG)
    this.nose.yRot = 0
    this.nose.zRot = f(f(cos(f(tickCount * k)) * 2.5) * DEG)
    if (state['model.holdingItem']) {
      this.nose.setPos(0, 1, -1.5)
      this.nose.xRot = f(-0.9)
    }
  }
}

/** The ModelPart pair AnimationUtils.bobArms moves: the first arm up, the second down. */
function bobArms(m: AnimModel, first: PartPose, second: PartPose, ageInTicks: number) {
  const { sin, cos } = m.c
  first.zRot = f(first.zRot + f(f(cos(f(ageInTicks * f(0.09))) * f(0.05)) + f(0.05)))
  second.zRot = f(second.zRot - f(f(cos(f(ageInTicks * f(0.09))) * f(0.05)) + f(0.05)))
  first.xRot = f(first.xRot + f(sin(f(ageInTicks * f(0.067))) * f(0.05)))
  second.xRot = f(second.xRot - f(sin(f(ageInTicks * f(0.067))) * f(0.05)))
}

/** AnimationUtils.swingWeaponDown (inline in IllagerModel before 1.16) */
function swingWeaponDown(m: AnimModel, rightArm: PartPose, leftArm: PartPose, arm: string, attackTime: number, ageInTicks: number) {
  const { sin, cos } = m.c
  const attack2 = sin(f(attackTime * PI))
  const attack = sin(f(f(1 - f(f(1 - attackTime) * f(1 - attackTime))) * PI))
  rightArm.zRot = 0
  leftArm.zRot = 0
  rightArm.yRot = f(Math.PI / 20)
  leftArm.yRot = f(-Math.PI / 20)
  if (arm === 'RIGHT') {
    rightArm.xRot = f(f(-1.884_955_8) + f(cos(f(ageInTicks * f(0.09))) * f(0.15)))
    leftArm.xRot = f(-0 + f(cos(f(ageInTicks * f(0.19))) * 0.5))
    rightArm.xRot = f(rightArm.xRot + f(f(attack2 * f(2.2)) - f(attack * f(0.4))))
    leftArm.xRot = f(leftArm.xRot + f(f(attack2 * f(1.2)) - f(attack * f(0.4))))
  } else {
    rightArm.xRot = f(-0 + f(cos(f(ageInTicks * f(0.19))) * 0.5))
    leftArm.xRot = f(f(-1.884_955_8) + f(cos(f(ageInTicks * f(0.09))) * f(0.15)))
    rightArm.xRot = f(rightArm.xRot + f(f(attack2 * f(1.2)) - f(attack * f(0.4))))
    leftArm.xRot = f(leftArm.xRot + f(f(attack2 * f(2.2)) - f(attack * f(0.4))))
  }
  bobArms(m, rightArm, leftArm, ageInTicks)
}

/** AnimationUtils.animateZombieArms(leftArm, rightArm, aggressive, attackTime, ageInTicks) */
function animateZombieArms(m: AnimModel, leftArm: PartPose, rightArm: PartPose, aggressive: boolean, attackTime: number, ageInTicks: number) {
  const { sin } = m.c
  const attack2 = sin(f(attackTime * PI))
  const attack = sin(f(f(1 - f(f(1 - attackTime) * f(1 - attackTime))) * PI))
  rightArm.zRot = 0
  leftArm.zRot = 0
  rightArm.yRot = -f(f(0.1) - f(attack2 * f(0.6)))
  leftArm.yRot = f(f(0.1) - f(attack2 * f(0.6)))
  const armDrop = f(-PI / (aggressive ? 1.5 : f(2.25)))
  rightArm.xRot = armDrop
  leftArm.xRot = armDrop
  rightArm.xRot = f(rightArm.xRot + f(f(attack2 * f(1.2)) - f(attack * f(0.4))))
  leftArm.xRot = f(leftArm.xRot + f(f(attack2 * f(1.2)) - f(attack * f(0.4))))
  bobArms(m, rightArm, leftArm, ageInTicks)
}

/** The illager entity class: the state's, or guessed from its synched data (an illusioner passes for an evoker). */
const illagerClass = (state: AnimState): string => {
  if (typeof state.entityClass === 'string') return state.entityClass
  if (hasData(state, 'is_charging_crossbow')) return 'Pillager'
  if (hasData(state, 'spell_casting')) return 'Evoker'
  return 'Vindicator'
}

/** AbstractIllager.getArmPose and its overrides (SpellcasterIllager, Illusioner, Pillager, Vindicator). */
function illagerArmPose(m: AnimModel, state: AnimState): string {
  const celebrating = !!data(state, 'is_celebrating', false)
  switch (illagerClass(state)) {
    case 'Evoker':
      if (data(state, 'spell_casting', 0) > 0) return 'SPELLCASTING'
      return celebrating ? 'CELEBRATING' : 'CROSSED'
    case 'Illusioner':
      if (data(state, 'spell_casting', 0) > 0) return 'SPELLCASTING'
      return isAggressive(state) ? 'BOW_AND_ARROW' : 'CROSSED'
    case 'Pillager':
      if (data(state, 'is_charging_crossbow', false)) return 'CROSSBOW_CHARGE'
      if (state['item.mainhand'] === 'crossbow' || state['item.offhand'] === 'crossbow') return 'CROSSBOW_HOLD'
      if (isAggressive(state)) return 'ATTACKING'
      return m.c.atLeast('1.15') ? 'NEUTRAL' : 'CROSSED'
    case 'Vindicator':
      if (isAggressive(state)) return 'ATTACKING'
      return celebrating ? 'CELEBRATING' : 'CROSSED'
    default:
      return 'CROSSED'
  }
}

/**
 * IllagerModel (evokers, illusioners, pillagers, vindicators; 1.14.4's PillagerModel only draws differently). The
 * legacy fields leftLeg / rightLeg are the right_leg / left_leg of 1.17 (leftLeg was at x -2): the code moves the same
 * legs, under the other names.
 */
export class IllagerModel extends EntityEraModel {
  legacy = !this.c.atLeast('1.17')
  head = this.part('head')
  arms = this.part('arms')
  rightLeg = this.part(this.legacy ? 'left_leg' : 'right_leg')
  leftLeg = this.part(this.legacy ? 'right_leg' : 'left_leg')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')

  override entitySetupAnim(state: AnimState) {
    const { cos } = this.c
    const pos = num(state, 'walkAnimationPos')
    const speed = num(state, 'walkAnimationSpeed')
    const ageInTicks = num(state, 'ageInTicks')
    const attackTime = num(state, 'model.attackTime')
    const { head, rightArm, leftArm, rightLeg, leftLeg } = this
    head.yRot = f(num(state, 'yRot') * DEG)
    head.xRot = f(num(state, 'xRot') * DEG)
    if (this.legacy) {
      this.arms.y = 3
      this.arms.z = -1
      this.arms.xRot = f(-0.75)
    }
    if (state['model.riding']) {
      rightArm.xRot = f(-Math.PI / 5)
      rightArm.yRot = 0
      rightArm.zRot = 0
      leftArm.xRot = f(-Math.PI / 5)
      leftArm.yRot = 0
      leftArm.zRot = 0
      rightLeg.xRot = f(-1.413_716_7)
      rightLeg.yRot = f(Math.PI / 10)
      rightLeg.zRot = f(0.078_539_82)
      leftLeg.xRot = f(-1.413_716_7)
      leftLeg.yRot = f(-Math.PI / 10)
      leftLeg.zRot = f(-0.078_539_82)
    } else {
      rightArm.xRot = f(f(f(cos(f(f(pos * f(0.6662)) + PI)) * 2) * speed) * 0.5)
      rightArm.yRot = 0
      rightArm.zRot = 0
      leftArm.xRot = f(f(f(cos(f(pos * f(0.6662))) * 2) * speed) * 0.5)
      leftArm.yRot = 0
      leftArm.zRot = 0
      rightLeg.xRot = f(f(f(cos(f(pos * f(0.6662))) * f(1.4)) * speed) * 0.5)
      rightLeg.yRot = 0
      rightLeg.zRot = 0
      leftLeg.xRot = f(f(f(cos(f(f(pos * f(0.6662)) + PI)) * f(1.4)) * speed) * 0.5)
      leftLeg.yRot = 0
      leftLeg.zRot = 0
    }

    const armPose = illagerArmPose(this, state)
    if (armPose === 'ATTACKING') {
      // before 1.16 the weapon swing whatever the hand holds
      if (this.c.atLeast('1.16') && !state['item.mainhand']) animateZombieArms(this, leftArm, rightArm, true, attackTime, ageInTicks)
      else swingWeaponDown(this, rightArm, leftArm, mainArm(state), attackTime, ageInTicks)
    } else if (armPose === 'SPELLCASTING') {
      rightArm.z = 0
      rightArm.x = -5
      leftArm.z = 0
      leftArm.x = 5
      rightArm.xRot = f(cos(f(ageInTicks * f(0.6662))) * 0.25)
      leftArm.xRot = f(cos(f(ageInTicks * f(0.6662))) * 0.25)
      rightArm.zRot = f((Math.PI * 3) / 4)
      leftArm.zRot = f((-Math.PI * 3) / 4)
      rightArm.yRot = 0
      leftArm.yRot = 0
    } else if (armPose === 'BOW_AND_ARROW') {
      rightArm.yRot = f(f(-0.1) + head.yRot)
      rightArm.xRot = f(-HALF_PI + head.xRot)
      leftArm.xRot = f(f(-0.942_477_9) + head.xRot)
      leftArm.yRot = f(head.yRot - f(0.4))
      leftArm.zRot = HALF_PI
    } else if (armPose === 'CROSSBOW_HOLD') {
      // AnimationUtils.animateCrossbowHold(rightArm, leftArm, head, true)
      rightArm.yRot = f(f(-0.3) + head.yRot)
      leftArm.yRot = f(f(0.6) + head.yRot)
      rightArm.xRot = f(f(-HALF_PI + head.xRot) + f(0.1))
      leftArm.xRot = f(-1.5 + head.xRot)
    } else if (armPose === 'CROSSBOW_CHARGE') {
      // AnimationUtils.animateCrossbowCharge(rightArm, leftArm, entity, true) (before 1.16 inline, the duration 25)
      rightArm.yRot = f(-0.8)
      rightArm.xRot = f(-0.970_796_35)
      leftArm.xRot = rightArm.xRot
      const duration = this.c.atLeast('1.16') ? entity(state, 'crossbowChargeDuration', 25) : 25
      const useTicks = clamp(entity(state, 'ticksUsingItem', 0), 0, duration)
      const delta = f(useTicks / duration)
      leftArm.yRot = lerp(delta, f(0.4), f(0.85))
      leftArm.xRot = lerp(delta, leftArm.xRot, -HALF_PI)
    } else if (armPose === 'CELEBRATING') {
      rightArm.z = 0
      rightArm.x = -5
      rightArm.xRot = f(cos(f(ageInTicks * f(0.6662))) * f(0.05))
      rightArm.zRot = f(2.670_354)
      rightArm.yRot = 0
      leftArm.z = 0
      leftArm.x = 5
      leftArm.xRot = f(cos(f(ageInTicks * f(0.6662))) * f(0.05))
      leftArm.zRot = f((-Math.PI * 3) / 4)
      leftArm.yRot = 0
    }

    // 1.14.4 chooses the arms to draw in render
    if (this.c.atLeast('1.15')) {
      const crossed = armPose === 'CROSSED'
      this.arms.visible = crossed
      leftArm.visible = !crossed
      rightArm.visible = !crossed
    }
  }
}

type Rotations = [number, number, number]

/** An armor stand's pose (a Rotations synched data, degrees), or the ArmorStand default. */
const rotations = (state: AnimState, name: string, fallback: Rotations): Rotations => {
  const value = data<unknown>(state, name, fallback)
  if (Array.isArray(value)) return value.map(Number) as Rotations
  if (value && typeof value === 'object') {
    const { x = 0, y = 0, z = 0 } = value as { x?: number; y?: number; z?: number }
    return [x, y, z]
  }
  return fallback
}

const rotate = (part: PartPose, [x, y, z]: Rotations) => {
  part.xRot = f(DEG * x)
  part.yRot = f(DEG * y)
  part.zRot = f(DEG * z)
}

/** ArmorStandArmorModel (a HumanoidModel posed by the stand's rotations; the base of ArmorStandModel) */
export class ArmorStandArmorModel extends EntityEraModel {
  legacy = !this.c.atLeast('1.17')
  head = this.part('head')
  hat = this.part('hat')
  body = this.part('body')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')

  override entitySetupAnim(state: AnimState) {
    rotate(this.head, rotations(state, 'head_pose', [0, 0, 0]))
    if (this.legacy) this.head.setPos(0, 1, 0)
    rotate(this.body, rotations(state, 'body_pose', [0, 0, 0]))
    rotate(this.leftArm, rotations(state, 'left_arm_pose', [-10, 0, -10]))
    rotate(this.rightArm, rotations(state, 'right_arm_pose', [-15, 0, 10]))
    rotate(this.leftLeg, rotations(state, 'left_leg_pose', [-1, 0, -1]))
    if (this.legacy) this.leftLeg.setPos(1.9, 11, 0)
    rotate(this.rightLeg, rotations(state, 'right_leg_pose', [1, 0, 1]))
    if (this.legacy) this.rightLeg.setPos(-1.9, 11, 0)
    this.hat.copyFrom(this.head)
  }
}

/** ArmorStandModel: the stand's sticks follow the body pose, the base plate the stand's own yaw. */
export class ArmorStandModel extends ArmorStandArmorModel {
  rightBodyStick = this.part(this.legacy ? 'body_stick1' : 'right_body_stick')
  leftBodyStick = this.part(this.legacy ? 'body_stick2' : 'left_body_stick')
  shoulderStick = this.part('shoulder_stick')
  basePlate = this.part('base_plate')

  /** the stand's yaw (Entity.yRot / yRotO, degrees) */
  private standYaw(state: AnimState) {
    const yRot = entity(state, 'yRot', 180)
    return { yRot, yRotO: entity(state, 'yRotO', yRot) }
  }

  override prepareMobModel(state: AnimState) {
    if (!this.c.atLeast('1.15')) return
    const { yRot, yRotO } = this.standYaw(state)
    this.basePlate.xRot = 0
    this.basePlate.yRot = f(DEG * -rotLerp(num(state, 'partialTick'), yRotO, yRot))
    this.basePlate.zRot = 0
  }

  override entitySetupAnim(state: AnimState) {
    super.entitySetupAnim(state)
    const flags = data(state, 'client_flags', 0)
    const showArms = (flags & 4) !== 0
    this.leftArm.visible = showArms
    this.rightArm.visible = showArms
    this.basePlate.visible = (flags & 8) === 0
    if (this.legacy) {
      this.leftLeg.setPos(1.9, 12, 0)
      this.rightLeg.setPos(-1.9, 12, 0)
    }
    const bodyPose = rotations(state, 'body_pose', [0, 0, 0])
    rotate(this.rightBodyStick, bodyPose)
    rotate(this.leftBodyStick, bodyPose)
    rotate(this.shoulderStick, bodyPose)
    if (!this.c.atLeast('1.15')) {
      this.basePlate.xRot = 0
      this.basePlate.yRot = f(DEG * -this.standYaw(state).yRot)
      this.basePlate.zRot = 0
    }
  }
}

/** MinecartModel: 1.15 - 1.17 set the contents' height from the model's ageInTicks argument (the renderer's: 0). */
export class MinecartModel extends EntityEraModel {
  contents = this.c.atLeast('1.15') && !this.c.atLeast('1.18') ? this.part(this.c.atLeast('1.17') ? 'contents' : 'cubes_5') : undefined

  override entitySetupAnim(state: AnimState) {
    if (this.contents) this.contents.y = f(4 - num(state, 'ageInTicks'))
  }
}

/**
 * BoatModel: the paddles row by Boat.getRowingTime (the renderer passes the partial tick as the model's first argument,
 * walkAnimationPos here). 1.14.4 poses them in render.
 */
export class BoatModel extends EntityEraModel {
  legacy = !this.c.atLeast('1.17')
  paddles = this.c.atLeast('1.15') ? [this.part(this.legacy ? 'paddles_0' : 'left_paddle'), this.part(this.legacy ? 'paddles_1' : 'right_paddle')] : []

  override entitySetupAnim(state: AnimState) {
    for (const [i, paddle] of this.paddles.entries()) this.animatePaddle(state, i, paddle, num(state, 'walkAnimationPos'))
    // 1.14.4 poses the paddles in render(), every frame, from Boat.getRowingTime: when the renderer gives the rowing times
    const rowing = state['entity.rowingTimes'] as number[] | undefined
    if (!this.c.atLeast('1.15') && rowing) {
      const { sin } = this.c
      for (const [i, name] of ['paddles_0', 'paddles_1'].entries()) {
        const paddle = this.model.maybe(name)
        if (!paddle) continue
        const g = rowing[i] ?? 0
        paddle.xRot = f(clampedLerpDouble(f(-Math.PI / 3), f(-Math.PI / 12), f(f(sin(-g) + 1) / 2)))
        paddle.yRot = f(clampedLerpDouble(f(-Math.PI / 4), f(Math.PI / 4), f(f(sin(f(-g + 1)) + 1) / 2)))
        if (i === 1) paddle.yRot = f(PI - paddle.yRot)
      }
    }
  }

  private rowingTime(state: AnimState, i: number, partialTick: number) {
    if (!data(state, i === 0 ? 'id_paddle_left' : 'id_paddle_right', false)) return 0
    const position = entity<number[]>(state, 'paddlePositions', [0, 0])[i] ?? 0
    const from = f(position - f(Math.PI / 8))
    return this.legacy ? f(clampedLerpDouble(from, position, partialTick)) : clampedLerpFloat(from, position, partialTick)
  }

  private animatePaddle(state: AnimState, i: number, paddle: PartPose, partialTick: number) {
    const { sin } = this.c
    const g = this.rowingTime(state, i, partialTick)
    const xDelta = f(f(sin(-g) + 1) / 2)
    const yDelta = f(f(sin(f(-g + 1)) + 1) / 2)
    if (this.legacy) {
      paddle.xRot = f(clampedLerpDouble(f(-Math.PI / 3), f(-Math.PI / 12), xDelta))
      paddle.yRot = f(clampedLerpDouble(f(-Math.PI / 4), f(Math.PI / 4), yDelta))
    } else {
      paddle.xRot = clampedLerpFloat(f(-Math.PI / 3), f(-Math.PI / 12), xDelta)
      paddle.yRot = clampedLerpFloat(f(-Math.PI / 4), f(Math.PI / 4), yDelta)
    }
    if (i === 1) paddle.yRot = f(PI - paddle.yRot)
  }
}

/** LeashKnotModel: the knot turns with the head yaw and pitch the renderer gives (0). */
export class LeashKnotModel extends EntityEraModel {
  knot = this.part('knot')

  override entitySetupAnim(state: AnimState) {
    this.knot.yRot = f(num(state, 'yRot') * DEG)
    this.knot.xRot = f(num(state, 'xRot') * DEG)
  }
}

/** ElytraModel (on any living entity; a player's wings ease toward the pose). */
export class ElytraModel extends EntityEraModel {
  legacy = !this.c.atLeast('1.17')
  leftWing = this.part('left_wing')
  rightWing = this.part('right_wing')

  override entitySetupAnim(state: AnimState) {
    let xRot = f(Math.PI / 12)
    let zRot = f(-Math.PI / 12)
    let y = 0
    let yRot = 0
    const fallFlying = (data(state, 'shared_flags', 0) & 0x80) !== 0
    const pose = data<string>(state, 'pose', 'STANDING')
    // 1.14.4: isVisuallySneaking (the SNEAKING pose)
    const crouching = this.c.atLeast('1.15') ? pose === 'CROUCHING' : pose === 'SNEAKING'
    if (fallFlying) {
      let o = 1
      const [dx = 0, dy = 0, dz = 0] = entity<number[]>(state, 'deltaMovement', [0, 0, 0])
      if (dy < 0) {
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const ny = length < 1e-4 ? 0 : dy / length
        o = f(1 - f(Math.pow(-ny, 1.5)))
      }
      xRot = f(f(o * f(Math.PI / 9)) + f(f(1 - o) * xRot))
      zRot = f(f(o * f(-Math.PI / 2)) + f(f(1 - o) * zRot))
    } else if (crouching) {
      xRot = f((Math.PI * 2) / 9)
      zRot = f(-Math.PI / 4)
      y = 3
      yRot = f(0.087_266_46)
    }
    if (this.legacy) this.leftWing.x = 5
    this.leftWing.y = y
    if (state['entity.elytraRotX'] !== undefined && state['entity.elytraRotX'] !== null) {
      // AbstractClientPlayer: before 1.18 eased in double precision
      const ease = (current: number, target: number) => (this.c.atLeast('1.18') ? f(current + f(f(target - current) * f(0.1))) : f(current + f(target - current) * 0.1))
      state['entity.elytraRotX'] = ease(num(state, 'entity.elytraRotX'), xRot)
      state['entity.elytraRotY'] = ease(num(state, 'entity.elytraRotY'), yRot)
      state['entity.elytraRotZ'] = ease(num(state, 'entity.elytraRotZ'), zRot)
      this.leftWing.xRot = state['entity.elytraRotX']
      this.leftWing.yRot = state['entity.elytraRotY']
      this.leftWing.zRot = state['entity.elytraRotZ']
    } else {
      this.leftWing.xRot = xRot
      this.leftWing.zRot = zRot
      this.leftWing.yRot = yRot
    }
    if (this.legacy) this.rightWing.x = -this.leftWing.x
    this.rightWing.yRot = -this.leftWing.yRot
    this.rightWing.y = this.leftWing.y
    this.rightWing.xRot = this.leftWing.xRot
    this.rightWing.zRot = -this.leftWing.zRot
  }
}

/** EvokerFangsModel: the jaws bite by the fangs' animation progress (walkAnimationPos). 1.14.4 poses them in render. */
export class EvokerFangsModel extends EntityEraModel {
  base = this.part('base')
  upperJaw = this.part('upper_jaw')
  lowerJaw = this.part('lower_jaw')

  override entitySetupAnim(state: AnimState) {
    if (!this.c.atLeast('1.15')) return
    const pos = num(state, 'walkAnimationPos')
    let k = f(pos * 2)
    if (k > 1) k = 1
    k = f(1 - f(f(k * k) * k))
    this.upperJaw.zRot = f(PI - f(f(k * f(0.35)) * PI))
    this.lowerJaw.zRot = f(PI + f(f(k * f(0.35)) * PI))
    if (!this.c.atLeast('1.17')) this.lowerJaw.yRot = PI
    const l = f(f(f(pos + this.c.sin(f(pos * f(2.7)))) * f(0.6)) * 12)
    this.upperJaw.y = f(24 - l)
    this.lowerJaw.y = this.upperJaw.y
    this.base.y = this.upperJaw.y
  }
}

/** WardenModel (1.19+) */
export class WardenModel extends EntityEraModel {
  body = this.part('body')
  head = this.part('head')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightTendril = this.part('right_tendril')
  leftTendril = this.part('left_tendril')

  override entitySetupAnim(state: AnimState) {
    const ageInTicks = num(state, 'ageInTicks')
    const partialTick = f(ageInTicks - entity(state, 'tickCount', 0))
    this.animateHeadLookTarget(num(state, 'yRot'), num(state, 'xRot'))
    this.animateWalk(num(state, 'walkAnimationPos'), num(state, 'walkAnimationSpeed'))
    this.animateIdlePose(ageInTicks)
    this.animateTendrils(state, ageInTicks, partialTick)
    animate(this, entity<AnimationStateValue>(state, 'attackAnimationState', null), 'WardenAnimation.WARDEN_ATTACK', ageInTicks)
    animate(this, entity<AnimationStateValue>(state, 'sonicBoomAnimationState', null), 'WardenAnimation.WARDEN_SONIC_BOOM', ageInTicks)
    animate(this, entity<AnimationStateValue>(state, 'diggingAnimationState', null), 'WardenAnimation.WARDEN_DIG', ageInTicks)
    animate(this, entity<AnimationStateValue>(state, 'emergeAnimationState', null), 'WardenAnimation.WARDEN_EMERGE', ageInTicks)
    animate(this, entity<AnimationStateValue>(state, 'roarAnimationState', null), 'WardenAnimation.WARDEN_ROAR', ageInTicks)
    animate(this, entity<AnimationStateValue>(state, 'sniffAnimationState', null), 'WardenAnimation.WARDEN_SNIFF', ageInTicks)
  }

  private animateHeadLookTarget(yRot: number, xRot: number) {
    this.head.xRot = f(xRot * DEG)
    this.head.yRot = f(yRot * DEG)
  }

  private animateIdlePose(ageInTicks: number) {
    const { sin, cos } = this.c
    const g = f(ageInTicks * f(0.1))
    const h = cos(g)
    const i = sin(g)
    this.head.zRot = f(this.head.zRot + f(f(0.06) * h))
    this.head.xRot = f(this.head.xRot + f(f(0.06) * i))
    this.body.zRot = f(this.body.zRot + f(f(0.025) * i))
    this.body.xRot = f(this.body.xRot + f(f(0.025) * h))
  }

  private animateWalk(pos: number, speed: number) {
    const { sin, cos } = this.c
    const h = Math.min(0.5, f(3 * speed))
    const i = f(pos * f(0.8662))
    const j = cos(i)
    const k = sin(i)
    const l = Math.min(f(0.35), h)
    this.head.zRot = f(this.head.zRot + f(f(f(0.3) * k) * h))
    this.head.xRot = f(this.head.xRot + f(f(f(1.2) * cos(f(i + HALF_PI))) * l))
    this.body.zRot = f(f(f(0.1) * k) * h)
    this.body.xRot = f(f(1 * j) * l)
    this.leftLeg.xRot = f(f(1 * j) * h)
    this.rightLeg.xRot = f(f(1 * cos(f(i + PI))) * h)
    this.leftArm.xRot = -f(f(f(0.8) * j) * h)
    this.leftArm.zRot = 0
    this.rightArm.xRot = -f(f(f(0.8) * k) * h)
    this.rightArm.zRot = 0
    this.resetArmPoses()
  }

  private resetArmPoses() {
    this.leftArm.yRot = 0
    this.leftArm.z = 1
    this.leftArm.x = 13
    this.leftArm.y = -13
    this.rightArm.yRot = 0
    this.rightArm.z = 1
    this.rightArm.x = -13
    this.rightArm.y = -13
  }

  private animateTendrils(state: AnimState, ageInTicks: number, partialTick: number) {
    // Warden.getTendrilAnimation(partialTick) = Mth.lerp(partialTick, tendrilAnimationO, tendrilAnimation) / 10
    const tendril = f(lerp(partialTick, entity(state, 'tendrilAnimationO', 0), entity(state, 'tendrilAnimation', 0)) / 10)
    const h = f(tendril * f(Math.cos(ageInTicks * 2.25) * Math.PI * 0.100_000_001_490_116_12))
    this.leftTendril.xRot = h
    this.rightTendril.xRot = -h
  }
}

/** BreezeModel (1.20.4 experimental, 1.20.5+; slide back from 1.20.5) */
export class BreezeModel extends EntityEraModel {
  windBottom = this.part('wind_bottom')
  windMid = this.part('wind_mid')
  windTop = this.part('wind_top')
  head = this.part('head')
  rods = this.part('rods')

  override entitySetupAnim(state: AnimState) {
    const { sin, cos } = this.c
    const ageInTicks = num(state, 'ageInTicks')
    const k = f(f(ageInTicks * PI) * f(-0.1))
    this.windTop.x = f(f(cos(k) * 1) * f(0.6))
    this.windTop.z = f(f(sin(k) * 1) * f(0.6))
    this.windMid.x = f(f(sin(k) * 0.5) * f(0.8))
    this.windMid.z = f(cos(k) * f(0.8))
    this.windBottom.x = f(f(cos(k) * -0.25) * 1)
    this.windBottom.z = f(f(sin(k) * -0.25) * 1)
    this.head.y = f(4 + f(cos(k) / 4))
    this.rods.yRot = f(f(ageInTicks * PI) * f(0.1))
    animate(this, entity<AnimationStateValue>(state, 'shoot', null), 'BreezeAnimation.SHOOT', ageInTicks)
    animate(this, entity<AnimationStateValue>(state, 'slide', null), 'BreezeAnimation.SLIDE', ageInTicks)
    if (this.c.atLeast('1.20.5')) animate(this, entity<AnimationStateValue>(state, 'slideBack', null), 'BreezeAnimation.SLIDE_BACK', ageInTicks)
    animate(this, entity<AnimationStateValue>(state, 'longJump', null), 'BreezeAnimation.JUMP', ageInTicks)
  }
}

/** WindChargeModel (1.20.5+): the charge and its wind turn by the age, 16 degrees a tick, opposite ways. */
class EntityEraWindChargeModel extends AnimModel {
  windCharge = this.model.part('wind_charge')
  wind = this.model.part('wind')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const age = (state.ageInTicks as number) ?? 0
    this.windCharge.yRot = Math.fround(Math.fround(Math.fround(-age * 16) * Math.fround(Math.PI / 180)))
    this.wind.yRot = Math.fround(Math.fround(age * 16) * Math.fround(Math.PI / 180))
  }
}

export const ENTITY_ERA_MISC_MODELS: Record<string, AnimModelClass> = {
  // the same paddles (left_paddle / right_paddle, Boat.getRowingTime)
  ChestBoatModel: BoatModel,
  RaftModel: BoatModel,
  ChestRaftModel: BoatModel,
  WindChargeModel: EntityEraWindChargeModel,
  // 1.14.4 turns the crystal's cubes in render(), not in setupAnim
  EndCrystalModel: AnimModel,
  IronGolemModel,
  SnowGolemModel,
  VillagerModel,
  WitchModel,
  IllagerModel,
  // 1.14.4: IllagerModel drawing both arms
  PillagerModel: IllagerModel,
  ArmorStandArmorModel,
  ArmorStandModel,
  MinecartModel,
  BoatModel,
  LeashKnotModel,
  ElytraModel,
  EvokerFangsModel,
  WardenModel,
  BreezeModel
}
