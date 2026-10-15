import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, TWO_PI, clamp, f, lerp, rem, sqrt } from '../mth'

/**
 * HumanoidModel and the models built on it (zombies, drowned, skeletons, piglins, players), 1.14.4 - 1.21.1: posed from
 * the entity (prepareMobModel, then setupAnim). Versions:
 * - 1.14.4 / 1.15.2: one long setupAnim (arm poses inline, crossbow poses after the bob, swimming arms without the attack
 *   arm), 1.14.4 crouches lower (legs at y 9, head at y 1, model.sneaking);
 * - 1.16: poseRightArm / poseLeftArm, setupAttackAnimation, AnimationUtils;
 * - 1.17: an item in use poses only its arm, SPYGLASS, no swimming strokes while using an item;
 * - 1.17.1 and before compute the attack arm's xRot in double (h * 1.2 + i);
 * - 1.19.3: duck walk (legs yRot / zRot +-0.005, standing legs at z 0 instead of 0.1);
 * - 1.20.2: a blocking arm follows the head.
 *
 * The state: walkAnimationPos, walkAnimationSpeed, ageInTicks, yRot, xRot, partialTick; model.<field> (attackTime, riding,
 * young, crouching / sneaking, leftArmPose, rightArmPose); data.<index> read by name through state.dataNames (mob_flags,
 * living_entity_flags, shared_flags, pose...); entity.<field> (swimAmount, swimAmountO, fallFlyTicks, swingingArm...);
 * item.mainhand / item.offhand / item.chest (item paths). Optional inputs this file reads beyond the fixture's (absent:
 * their defaults): `entity.deltaMovement` ([x, y, z], the fall flying arm damping), `entity.ticksUsingItem` (while an
 * item is in use), `item.crossbowChargeDuration` (default 25), `entity.mainArm` (a player's, mobs use mob_flags),
 * `entityType` (piglin / piglin_brute / zombified_piglin, else told apart by their synched data).
 */

/** A number input of the state (walkAnimationPos, ageInTicks, yRot...), 0 when the sample leaves it at its default. */
export const num = (state: AnimState, key: string): number => state[key] ?? 0

const dataIndexCache = new WeakMap<object, Map<string, string>>()

/** A synched data value by its name (state.dataNames maps index -> name), or its default when the state lacks it. */
export function entityData<T = any>(state: AnimState, name: string, defaultValue: T): T {
  const names = state.dataNames as Record<string, string> | undefined
  if (!names) return defaultValue
  let byName = dataIndexCache.get(names)
  if (!byName) {
    byName = new Map(Object.entries(names).map(([index, n]) => [n, index]))
    dataIndexCache.set(names, byName)
  }
  const index = byName.get(name)
  if (index === undefined) return defaultValue
  const value = state[`data.${index}`]
  return value === undefined || value === null ? defaultValue : (value as T)
}

/** Does the entity have this synched data at all (tells entity classes apart). */
export const hasEntityData = (state: AnimState, name: string) => Object.values((state.dataNames ?? {}) as Record<string, string>).includes(name)

/** Entity getters the models call, from the synched data and client fields. */
export const EntityState = {
  pose: (state: AnimState): string => entityData(state, 'pose', 'STANDING'),
  /** Mob.isLeftHanded */
  isLeftHanded: (state: AnimState) => (entityData(state, 'mob_flags', 0) & 2) !== 0,
  /** Mob.isAggressive */
  isAggressive: (state: AnimState) => (entityData(state, 'mob_flags', 0) & 4) !== 0,
  /** LivingEntity.getMainArm (a mob's from mob_flags; a player's given as entity.mainArm) */
  mainArm: (state: AnimState): string => state['entity.mainArm'] ?? (EntityState.isLeftHanded(state) ? 'LEFT' : 'RIGHT'),
  isUsingItem: (state: AnimState) => (entityData(state, 'living_entity_flags', 0) & 1) > 0,
  usedItemHand: (state: AnimState) => ((entityData(state, 'living_entity_flags', 0) & 2) > 0 ? 'OFF_HAND' : 'MAIN_HAND'),
  /** LivingEntity.getTicksUsingItem: entity.ticksUsingItem while an item is in use */
  ticksUsingItem: (state: AnimState): number => (EntityState.isUsingItem(state) ? (state['entity.ticksUsingItem'] ?? 0) : 0),
  isFallFlying: (state: AnimState) => (entityData(state, 'shared_flags', 0) & (1 << 7)) !== 0,
  fallFlyingTicks: (state: AnimState): number => state['entity.fallFlyTicks'] ?? 0,
  isCrouching: (state: AnimState) => EntityState.pose(state) === 'CROUCHING',
  /** 1.14.4 Entity.isVisuallySneaking (Pose.SNEAKING, CROUCHING from 1.15) */
  isVisuallySneaking: (state: AnimState) => EntityState.pose(state) === 'SNEAKING' || EntityState.pose(state) === 'CROUCHING',
  /** LivingEntity.isVisuallySwimming */
  isVisuallySwimming: (state: AnimState) => {
    const pose = EntityState.pose(state)
    return pose === 'SWIMMING' || (!EntityState.isFallFlying(state) && pose === 'FALL_FLYING')
  },
  /** LivingEntity.getSwimAmount(partialTick) */
  swimAmount: (state: AnimState) => lerp(num(state, 'partialTick'), state['entity.swimAmountO'] ?? 0, state['entity.swimAmount'] ?? 0),
  item: (state: AnimState, slot: 'mainhand' | 'offhand' | 'chest'): string | null => state[`item.${slot}`] ?? null,
  /** LivingEntity.isHolding(item): either hand */
  isHolding: (state: AnimState, item: string) => EntityState.item(state, 'mainhand') === item || EntityState.item(state, 'offhand') === item
}

/** CrossbowItem.getChargeDuration of the item in use (25 ticks without quick charge) */
const crossbowChargeDuration = (state: AnimState): number => f(state['item.crossbowChargeDuration'] ?? 25)

/** AnimationUtils (1.16+; the older models inline the same math) */
export class EntityEraAnimationUtils {
  static animateCrossbowHold(rightArm: PartPose, leftArm: PartPose, head: PartPose, holdingInRightArm: boolean) {
    const holdingArm = holdingInRightArm ? rightArm : leftArm
    const shootingArm = holdingInRightArm ? leftArm : rightArm
    holdingArm.yRot = f((holdingInRightArm ? f(-0.3) : f(0.3)) + head.yRot)
    shootingArm.yRot = f((holdingInRightArm ? f(0.6) : f(-0.6)) + head.yRot)
    holdingArm.xRot = f(f(-HALF_PI + head.xRot) + f(0.1))
    shootingArm.xRot = f(-1.5 + head.xRot)
  }

  static animateCrossbowCharge(rightArm: PartPose, leftArm: PartPose, state: AnimState, holdingInRightArm: boolean) {
    const holdingArm = holdingInRightArm ? rightArm : leftArm
    const pullingArm = holdingInRightArm ? leftArm : rightArm
    holdingArm.yRot = holdingInRightArm ? f(-0.8) : f(0.8)
    holdingArm.xRot = f(-0.970_796_35)
    pullingArm.xRot = holdingArm.xRot
    const duration = crossbowChargeDuration(state)
    const useTicks = clamp(EntityState.ticksUsingItem(state), 0, duration)
    const alpha = f(useTicks / duration)
    pullingArm.yRot = f(lerp(alpha, f(0.4), f(0.85)) * (holdingInRightArm ? 1 : -1))
    pullingArm.xRot = lerp(alpha, pullingArm.xRot, -HALF_PI)
  }

  static swingWeaponDown(m: AnimModel, rightArm: PartPose, leftArm: PartPose, mainArm: string, attackTime: number, ageInTicks: number) {
    const { sin, cos } = m.c
    const h = sin(f(attackTime * PI))
    const i = sin(f(f(1 - f(f(1 - attackTime) * f(1 - attackTime))) * PI))
    rightArm.zRot = 0
    leftArm.zRot = 0
    rightArm.yRot = f(0.157_079_64)
    leftArm.yRot = f(-0.157_079_64)
    if (mainArm === 'RIGHT') {
      rightArm.xRot = f(f(-1.884_955_8) + f(cos(f(ageInTicks * f(0.09))) * f(0.15)))
      leftArm.xRot = f(-0 + f(cos(f(ageInTicks * f(0.19))) * 0.5))
      rightArm.xRot = f(rightArm.xRot + f(f(h * f(2.2)) - f(i * f(0.4))))
      leftArm.xRot = f(leftArm.xRot + f(f(h * f(1.2)) - f(i * f(0.4))))
    } else {
      rightArm.xRot = f(-0 + f(cos(f(ageInTicks * f(0.19))) * 0.5))
      leftArm.xRot = f(f(-1.884_955_8) + f(cos(f(ageInTicks * f(0.09))) * f(0.15)))
      rightArm.xRot = f(rightArm.xRot + f(f(h * f(1.2)) - f(i * f(0.4))))
      leftArm.xRot = f(leftArm.xRot + f(f(h * f(2.2)) - f(i * f(0.4))))
    }
    EntityEraAnimationUtils.bobArms(m, rightArm, leftArm, ageInTicks)
  }

  static bobModelPart(m: AnimModel, part: PartPose, ageInTicks: number, scale: number) {
    const { sin, cos } = m.c
    part.zRot = f(part.zRot + f(scale * f(f(cos(f(ageInTicks * f(0.09))) * f(0.05)) + f(0.05))))
    part.xRot = f(part.xRot + f(scale * f(sin(f(ageInTicks * f(0.067))) * f(0.05))))
  }

  static bobArms(m: AnimModel, rightArm: PartPose, leftArm: PartPose, ageInTicks: number) {
    EntityEraAnimationUtils.bobModelPart(m, rightArm, ageInTicks, 1)
    EntityEraAnimationUtils.bobModelPart(m, leftArm, ageInTicks, -1)
  }

  /** animateZombieArms (inlined in AbstractZombieModel / ZombieVillagerModel before 1.16: the same math) */
  static animateZombieArms(m: AnimModel, leftArm: PartPose, rightArm: PartPose, aggressive: boolean, attackTime: number, ageInTicks: number) {
    const { sin } = m.c
    const h = sin(f(attackTime * PI))
    const i = sin(f(f(1 - f(f(1 - attackTime) * f(1 - attackTime))) * PI))
    rightArm.zRot = 0
    leftArm.zRot = 0
    rightArm.yRot = -f(f(0.1) - f(h * f(0.6)))
    leftArm.yRot = f(f(0.1) - f(h * f(0.6)))
    const j = f(-PI / (aggressive ? 1.5 : f(2.25)))
    rightArm.xRot = j
    leftArm.xRot = j
    rightArm.xRot = f(rightArm.xRot + f(f(h * f(1.2)) - f(i * f(0.4))))
    leftArm.xRot = f(leftArm.xRot + f(f(h * f(1.2)) - f(i * f(0.4))))
    EntityEraAnimationUtils.bobArms(m, rightArm, leftArm, ageInTicks)
  }
}

/** ArmPose.isTwoHanded */
const TWO_HANDED = new Set(['BOW_AND_ARROW', 'CROSSBOW_CHARGE', 'CROSSBOW_HOLD'])

/**
 * HumanoidModel (1.14.4 - 1.21.1). The model's own fields (attackTime, riding, young, crouching, arm poses, swimAmount)
 * are read from the state at the start of setupAnim, then prepareMobModel (subclasses set arm poses there), then the Java
 * setupAnim body. Subclasses override setupAnim (calling super first), prepareMobModel and setupAttackAnimation like Java.
 */
export class HumanoidModel extends AnimModel {
  head = this.part('head')
  hat = this.part('hat')
  body = this.part('body')
  rightArm = this.part('right_arm')
  leftArm = this.part('left_arm')
  rightLeg = this.part('right_leg')
  leftLeg = this.part('left_leg')

  // EntityModel / AgeableListModel / HumanoidModel fields, set from the state each setupAnim
  attackTime = 0
  riding = false
  young = false
  crouching = false
  leftArmPose = 'EMPTY'
  rightArmPose = 'EMPTY'
  swimAmount = 0
  /** 1.14.4 / 1.15.2: getTicksUsingItem, taken in prepareMobModel */
  itemUseTicks = 0

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.readModelFields(state)
    this.prepareMobModel(state)
    this.humanoidSetupAnim(state)
  }

  /** The model fields the renderer sets before posing (model.<field> in the state). */
  readModelFields(state: AnimState) {
    this.attackTime = state['model.attackTime'] ?? 0
    this.riding = state['model.riding'] ?? false
    this.young = state['model.young'] ?? false
    this.crouching = state['model.crouching'] ?? state['model.sneaking'] ?? false
    this.leftArmPose = state['model.leftArmPose'] ?? 'EMPTY'
    this.rightArmPose = state['model.rightArmPose'] ?? 'EMPTY'
    this.swimAmount = state['model.swimAmount'] ?? 0
  }

  data<T = any>(state: AnimState, name: string, defaultValue: T): T {
    return entityData(state, name, defaultValue)
  }

  prepareMobModel(state: AnimState) {
    this.swimAmount = EntityState.swimAmount(state)
    if (!this.c.atLeast('1.16')) this.itemUseTicks = EntityState.ticksUsingItem(state)
  }

  /** HumanoidModel.setupAnim's body */
  humanoidSetupAnim(state: AnimState) {
    if (!this.c.atLeast('1.16')) {
      this.setupAnim1_15(state)
      return
    }
    const { cos } = this.c
    const limbSwing = num(state, 'walkAnimationPos')
    const limbSwingAmount = num(state, 'walkAnimationSpeed')
    const ageInTicks = num(state, 'ageInTicks')
    const fallFlying = EntityState.fallFlyingTicks(state) > 4
    const visuallySwimming = EntityState.isVisuallySwimming(state)
    this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    if (fallFlying) {
      this.head.xRot = f(-0.785_398_2)
    } else if (this.swimAmount > 0) {
      if (visuallySwimming) this.head.xRot = this.rotlerpRad(this.swimAmount, this.head.xRot, f(-0.785_398_2))
      else this.head.xRot = this.rotlerpRad(this.swimAmount, this.head.xRot, f(num(state, 'xRot') * DEG_TO_RAD))
    } else {
      this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
    }
    this.body.yRot = 0
    this.rightArm.z = 0
    this.rightArm.x = -5
    this.leftArm.z = 0
    this.leftArm.x = 5
    const k = this.fallFlyingDamping(state, fallFlying)
    this.walkArmsAndLegs(limbSwing, limbSwingAmount, k)
    const duckWalk = this.c.atLeast('1.19.3')
    this.rightLeg.yRot = duckWalk ? f(0.005) : 0
    this.leftLeg.yRot = duckWalk ? f(-0.005) : 0
    this.rightLeg.zRot = duckWalk ? f(0.005) : 0
    this.leftLeg.zRot = duckWalk ? f(-0.005) : 0
    this.ridingPose()
    this.rightArm.yRot = 0
    this.leftArm.yRot = 0
    const rightHanded = EntityState.mainArm(state) === 'RIGHT'
    if (this.c.atLeast('1.17') && EntityState.isUsingItem(state)) {
      const mainHandUsed = EntityState.usedItemHand(state) === 'MAIN_HAND'
      if (mainHandUsed === rightHanded) this.poseRightArm(state)
      else this.poseLeftArm(state)
    } else {
      const twoHanded = rightHanded ? TWO_HANDED.has(this.leftArmPose) : TWO_HANDED.has(this.rightArmPose)
      if (rightHanded !== twoHanded) {
        this.poseLeftArm(state)
        this.poseRightArm(state)
      } else {
        this.poseRightArm(state)
        this.poseLeftArm(state)
      }
    }
    this.setupAttackAnimation(state, ageInTicks)
    if (this.crouching) {
      this.body.xRot = 0.5
      this.rightArm.xRot = f(this.rightArm.xRot + f(0.4))
      this.leftArm.xRot = f(this.leftArm.xRot + f(0.4))
      this.rightLeg.z = 4
      this.leftLeg.z = 4
      this.rightLeg.y = f(12.2)
      this.leftLeg.y = f(12.2)
      this.head.y = f(4.2)
      this.body.y = f(3.2)
      this.leftArm.y = f(5.2)
      this.rightArm.y = f(5.2)
    } else {
      this.body.xRot = 0
      this.rightLeg.z = duckWalk ? 0 : f(0.1)
      this.leftLeg.z = duckWalk ? 0 : f(0.1)
      this.rightLeg.y = 12
      this.leftLeg.y = 12
      this.head.y = 0
      this.body.y = 0
      this.leftArm.y = 2
      this.rightArm.y = 2
    }
    if (this.rightArmPose !== 'SPYGLASS') EntityEraAnimationUtils.bobModelPart(this, this.rightArm, ageInTicks, 1)
    if (this.leftArmPose !== 'SPYGLASS') EntityEraAnimationUtils.bobModelPart(this, this.leftArm, ageInTicks, -1)
    if (this.swimAmount > 0) {
      const l = rem(limbSwing, 26)
      const attackArm = this.getAttackArm(state)
      const m = attackArm === 'RIGHT' && this.attackTime > 0 ? 0 : this.swimAmount
      const n = attackArm === 'LEFT' && this.attackTime > 0 ? 0 : this.swimAmount
      if (!this.c.atLeast('1.17') || !EntityState.isUsingItem(state)) this.swimArms(l, n, m)
      this.leftLeg.xRot = lerp(this.swimAmount, this.leftLeg.xRot, f(f(0.3) * cos(f(f(limbSwing * f(0.333_333_34)) + PI))))
      this.rightLeg.xRot = lerp(this.swimAmount, this.rightLeg.xRot, f(f(0.3) * cos(f(limbSwing * f(0.333_333_34)))))
    }
    this.hat.copyFrom(this.head)
  }

  /** The arm and leg swing divider while fall flying (the squared speed / 0.2, cubed, at least 1). */
  fallFlyingDamping(state: AnimState, fallFlying: boolean) {
    let k = 1
    if (fallFlying) {
      const [x = 0, y = 0, z = 0] = (state['entity.deltaMovement'] as number[] | undefined) ?? []
      k = f(x * x + y * y + z * z)
      k = f(k / f(0.2))
      k = f(k * f(k * k))
    }
    if (k < 1) k = 1
    return k
  }

  walkArmsAndLegs(limbSwing: number, limbSwingAmount: number, k: number) {
    const { cos } = this.c
    this.rightArm.xRot = f(f(f(f(cos(f(f(limbSwing * f(0.6662)) + PI)) * 2) * limbSwingAmount) * 0.5) / k)
    this.leftArm.xRot = f(f(f(f(cos(f(limbSwing * f(0.6662))) * 2) * limbSwingAmount) * 0.5) / k)
    this.rightArm.zRot = 0
    this.leftArm.zRot = 0
    this.rightLeg.xRot = f(f(f(cos(f(limbSwing * f(0.6662))) * f(1.4)) * limbSwingAmount) / k)
    this.leftLeg.xRot = f(f(f(cos(f(f(limbSwing * f(0.6662)) + PI)) * f(1.4)) * limbSwingAmount) / k)
  }

  ridingPose() {
    if (this.riding) {
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

  /** The swimming strokes (l = limbSwing % 26, n the left arm's amount, m the right arm's). */
  swimArms(l: number, n: number, m: number) {
    if (l < 14) {
      this.leftArm.xRot = this.rotlerpRad(n, this.leftArm.xRot, 0)
      this.rightArm.xRot = lerp(m, this.rightArm.xRot, 0)
      this.leftArm.yRot = this.rotlerpRad(n, this.leftArm.yRot, PI)
      this.rightArm.yRot = lerp(m, this.rightArm.yRot, PI)
      this.leftArm.zRot = this.rotlerpRad(n, this.leftArm.zRot, f(PI + f(f(f(1.870_796_4) * this.quadraticArmUpdate(l)) / this.quadraticArmUpdate(14))))
      this.rightArm.zRot = lerp(m, this.rightArm.zRot, f(PI - f(f(f(1.870_796_4) * this.quadraticArmUpdate(l)) / this.quadraticArmUpdate(14))))
    } else if (l >= 14 && l < 22) {
      const o = f(f(l - 14) / 8)
      this.leftArm.xRot = this.rotlerpRad(n, this.leftArm.xRot, f(HALF_PI * o))
      this.rightArm.xRot = lerp(m, this.rightArm.xRot, f(HALF_PI * o))
      this.leftArm.yRot = this.rotlerpRad(n, this.leftArm.yRot, PI)
      this.rightArm.yRot = lerp(m, this.rightArm.yRot, PI)
      this.leftArm.zRot = this.rotlerpRad(n, this.leftArm.zRot, f(f(5.012_389) - f(f(1.870_796_4) * o)))
      this.rightArm.zRot = lerp(m, this.rightArm.zRot, f(f(1.270_796_3) + f(f(1.870_796_4) * o)))
    } else if (l >= 22 && l < 26) {
      const o = f(f(l - 22) / 4)
      this.leftArm.xRot = this.rotlerpRad(n, this.leftArm.xRot, f(HALF_PI - f(HALF_PI * o)))
      this.rightArm.xRot = lerp(m, this.rightArm.xRot, f(HALF_PI - f(HALF_PI * o)))
      this.leftArm.yRot = this.rotlerpRad(n, this.leftArm.yRot, PI)
      this.rightArm.yRot = lerp(m, this.rightArm.yRot, PI)
      this.leftArm.zRot = this.rotlerpRad(n, this.leftArm.zRot, PI)
      this.rightArm.zRot = lerp(m, this.rightArm.zRot, PI)
    }
  }

  poseRightArm(state: AnimState) {
    this.poseArm(state, true, this.rightArmPose)
  }

  poseLeftArm(state: AnimState) {
    this.poseArm(state, false, this.leftArmPose)
  }

  poseArm(state: AnimState, right: boolean, pose: string) {
    const arm = right ? this.rightArm : this.leftArm
    switch (pose) {
      case 'EMPTY':
        arm.yRot = 0
        break
      case 'BLOCK':
        if (this.c.atLeast('1.20.2')) {
          this.poseBlockingArm(arm, right)
        } else {
          arm.xRot = f(f(arm.xRot * 0.5) - f(0.942_477_9))
          arm.yRot = right ? f(-0.523_598_8) : f(0.523_598_8)
        }
        break
      case 'ITEM':
        arm.xRot = f(f(arm.xRot * 0.5) - f(0.314_159_27))
        arm.yRot = 0
        break
      case 'THROW_SPEAR':
        arm.xRot = f(f(arm.xRot * 0.5) - PI)
        arm.yRot = 0
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
      case 'CROSSBOW_CHARGE':
        EntityEraAnimationUtils.animateCrossbowCharge(this.rightArm, this.leftArm, state, right)
        break
      case 'CROSSBOW_HOLD':
        EntityEraAnimationUtils.animateCrossbowHold(this.rightArm, this.leftArm, this.head, right)
        break
      case 'BRUSH':
        arm.xRot = f(f(arm.xRot * 0.5) - f(0.628_318_55))
        arm.yRot = 0
        break
      case 'SPYGLASS':
        arm.xRot = clamp(f(f(this.head.xRot - f(1.919_862_2)) - (EntityState.isCrouching(state) ? f(0.261_799_4) : 0)), f(-2.4), f(3.3))
        arm.yRot = right ? f(this.head.yRot - f(0.261_799_4)) : f(this.head.yRot + f(0.261_799_4))
        break
      case 'TOOT_HORN':
        arm.xRot = f(clamp(this.head.xRot, f(-1.2), f(1.2)) - f(1.483_529_8))
        arm.yRot = right ? f(this.head.yRot - f(0.523_598_8)) : f(this.head.yRot + f(0.523_598_8))
        break
    }
  }

  poseBlockingArm(arm: PartPose, right: boolean) {
    arm.xRot = f(f(f(arm.xRot * 0.5) - f(0.942_477_9)) + clamp(this.head.xRot, f(-1.396_263_4), f(0.436_332_32)))
    arm.yRot = f(f((right ? -30 : 30) * DEG_TO_RAD) + clamp(this.head.yRot, f(-0.523_598_8), f(0.523_598_8)))
  }

  setupAttackAnimation(state: AnimState, _ageInTicks: number) {
    if (!(this.attackTime <= 0)) this.attackSwing(state)
  }

  /** The attack swing (setupAttackAnimation's body; inline before 1.16). */
  attackSwing(state: AnimState) {
    const { sin, cos } = this.c
    const attackArm = this.getAttackArm(state)
    const arm = this.getArm(attackArm)
    let g = this.attackTime
    this.body.yRot = f(sin(f(sqrt(g) * TWO_PI)) * f(0.2))
    if (attackArm === 'LEFT') this.body.yRot = f(this.body.yRot * -1)
    this.rightArm.z = f(sin(this.body.yRot) * 5)
    this.rightArm.x = f(-cos(this.body.yRot) * 5)
    this.leftArm.z = f(-sin(this.body.yRot) * 5)
    this.leftArm.x = f(cos(this.body.yRot) * 5)
    this.rightArm.yRot = f(this.rightArm.yRot + this.body.yRot)
    this.leftArm.yRot = f(this.leftArm.yRot + this.body.yRot)
    this.leftArm.xRot = f(this.leftArm.xRot + this.body.yRot)
    g = f(1 - this.attackTime)
    g = f(g * g)
    g = f(g * g)
    g = f(1 - g)
    const h = sin(f(g * PI))
    const i = f(f(sin(f(this.attackTime * PI)) * -f(this.head.xRot - f(0.7))) * f(0.75))
    // 1.17.1 and before: (float) (xRot - (h * 1.2 + i)) in double
    if (this.c.atLeast('1.18')) arm.xRot = f(arm.xRot - f(f(h * f(1.2)) + i))
    else arm.xRot = f(arm.xRot - (h * 1.2 + i))
    arm.yRot = f(arm.yRot + f(this.body.yRot * 2))
    arm.zRot = f(arm.zRot + f(sin(f(this.attackTime * PI)) * f(-0.4)))
  }

  /** rotlerpRad(delta, from, to) (1.14 / 1.15 order their parameters from, to, delta: the same math) */
  rotlerpRad(delta: number, from: number, to: number) {
    let i = rem(f(to - from), TWO_PI)
    if (i < -PI) i = f(i + TWO_PI)
    if (i >= PI) i = f(i - TWO_PI)
    return f(from + f(delta * i))
  }

  quadraticArmUpdate(x: number) {
    return f(f(-65 * x) + f(x * x))
  }

  getArm(arm: string) {
    return arm === 'LEFT' ? this.leftArm : this.rightArm
  }

  /** getAttackArm: the main arm when the swinging hand is the main hand, else the other (swingingArm starts null). */
  getAttackArm(state: AnimState): string {
    const mainArm = EntityState.mainArm(state)
    return state['entity.swingingArm'] === 'MAIN_HAND' ? mainArm : mainArm === 'RIGHT' ? 'LEFT' : 'RIGHT'
  }

  /** HumanoidModel.setupAnim of 1.14.4 and 1.15.2 */
  setupAnim1_15(state: AnimState) {
    const { sin, cos } = this.c
    const limbSwing = num(state, 'walkAnimationPos')
    const limbSwingAmount = num(state, 'walkAnimationSpeed')
    const ageInTicks = num(state, 'ageInTicks')
    const fallFlying = EntityState.fallFlyingTicks(state) > 4
    const visuallySwimming = EntityState.isVisuallySwimming(state)
    this.head.yRot = f(num(state, 'yRot') * DEG_TO_RAD)
    if (fallFlying) {
      this.head.xRot = f(-0.785_398_2)
    } else if (this.swimAmount > 0) {
      if (visuallySwimming) this.head.xRot = this.rotlerpRad(this.swimAmount, this.head.xRot, f(-0.785_398_2))
      else this.head.xRot = this.rotlerpRad(this.swimAmount, this.head.xRot, f(num(state, 'xRot') * DEG_TO_RAD))
    } else {
      this.head.xRot = f(num(state, 'xRot') * DEG_TO_RAD)
    }
    this.body.yRot = 0
    this.rightArm.z = 0
    this.rightArm.x = -5
    this.leftArm.z = 0
    this.leftArm.x = 5
    const k = this.fallFlyingDamping(state, fallFlying)
    this.walkArmsAndLegs(limbSwing, limbSwingAmount, k)
    this.rightLeg.yRot = 0
    this.leftLeg.yRot = 0
    this.rightLeg.zRot = 0
    this.leftLeg.zRot = 0
    this.ridingPose()
    this.rightArm.yRot = 0
    this.rightArm.zRot = 0
    switch (this.leftArmPose) {
      case 'EMPTY':
        this.leftArm.yRot = 0
        break
      case 'BLOCK':
        this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - f(0.942_477_9))
        this.leftArm.yRot = f(0.523_598_8)
        break
      case 'ITEM':
        this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - f(0.314_159_27))
        this.leftArm.yRot = 0
        break
    }
    switch (this.rightArmPose) {
      case 'EMPTY':
        this.rightArm.yRot = 0
        break
      case 'BLOCK':
        this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - f(0.942_477_9))
        this.rightArm.yRot = f(-0.523_598_8)
        break
      case 'ITEM':
        this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - f(0.314_159_27))
        this.rightArm.yRot = 0
        break
      case 'THROW_SPEAR':
        this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - PI)
        this.rightArm.yRot = 0
        break
    }
    if (this.leftArmPose === 'THROW_SPEAR' && this.rightArmPose !== 'BLOCK' && this.rightArmPose !== 'THROW_SPEAR' && this.rightArmPose !== 'BOW_AND_ARROW') {
      this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - PI)
      this.leftArm.yRot = 0
    }
    if (this.attackTime > 0) this.attackSwing(state)
    if (this.crouching) {
      this.body.xRot = 0.5
      this.rightArm.xRot = f(this.rightArm.xRot + f(0.4))
      this.leftArm.xRot = f(this.leftArm.xRot + f(0.4))
      this.rightLeg.z = 4
      this.leftLeg.z = 4
      if (this.c.atLeast('1.15')) {
        this.rightLeg.y = f(12.2)
        this.leftLeg.y = f(12.2)
        this.head.y = f(4.2)
        this.body.y = f(3.2)
        this.leftArm.y = f(5.2)
        this.rightArm.y = f(5.2)
      } else {
        this.rightLeg.y = 9
        this.leftLeg.y = 9
        this.head.y = 1
      }
    } else {
      this.body.xRot = 0
      this.rightLeg.z = f(0.1)
      this.leftLeg.z = f(0.1)
      this.rightLeg.y = 12
      this.leftLeg.y = 12
      this.head.y = 0
      if (this.c.atLeast('1.15')) {
        this.body.y = 0
        this.leftArm.y = 2
        this.rightArm.y = 2
      }
    }
    const bobZ = f(f(cos(f(ageInTicks * f(0.09))) * f(0.05)) + f(0.05))
    const bobX = f(sin(f(ageInTicks * f(0.067))) * f(0.05))
    this.rightArm.zRot = f(this.rightArm.zRot + bobZ)
    this.leftArm.zRot = f(this.leftArm.zRot - bobZ)
    this.rightArm.xRot = f(this.rightArm.xRot + bobX)
    this.leftArm.xRot = f(this.leftArm.xRot - bobX)
    if (this.rightArmPose === 'BOW_AND_ARROW') {
      this.rightArm.yRot = f(f(-0.1) + this.head.yRot)
      this.leftArm.yRot = f(f(f(0.1) + this.head.yRot) + f(0.4))
      this.rightArm.xRot = f(-HALF_PI + this.head.xRot)
      this.leftArm.xRot = f(-HALF_PI + this.head.xRot)
    } else if (this.leftArmPose === 'BOW_AND_ARROW' && this.rightArmPose !== 'THROW_SPEAR' && this.rightArmPose !== 'BLOCK') {
      this.rightArm.yRot = f(f(f(-0.1) + this.head.yRot) - f(0.4))
      this.leftArm.yRot = f(f(0.1) + this.head.yRot)
      this.rightArm.xRot = f(-HALF_PI + this.head.xRot)
      this.leftArm.xRot = f(-HALF_PI + this.head.xRot)
    }
    const o = crossbowChargeDuration(state)
    if (this.rightArmPose === 'CROSSBOW_CHARGE') {
      this.rightArm.yRot = f(-0.8)
      this.rightArm.xRot = f(-0.970_796_35)
      this.leftArm.xRot = f(-0.970_796_35)
      const p = clamp(this.itemUseTicks, 0, o)
      this.leftArm.yRot = lerp(f(p / o), f(0.4), f(0.85))
      this.leftArm.xRot = lerp(f(p / o), this.leftArm.xRot, -HALF_PI)
    } else if (this.leftArmPose === 'CROSSBOW_CHARGE') {
      this.leftArm.yRot = f(0.8)
      this.rightArm.xRot = f(-0.970_796_35)
      this.leftArm.xRot = f(-0.970_796_35)
      const p = clamp(this.itemUseTicks, 0, o)
      this.rightArm.yRot = lerp(f(p / o), f(-0.4), f(-0.85))
      this.rightArm.xRot = lerp(f(p / o), this.rightArm.xRot, -HALF_PI)
    }
    if (this.rightArmPose === 'CROSSBOW_HOLD' && this.attackTime <= 0) {
      this.rightArm.yRot = f(f(-0.3) + this.head.yRot)
      this.leftArm.yRot = f(f(0.6) + this.head.yRot)
      this.rightArm.xRot = f(f(-HALF_PI + this.head.xRot) + f(0.1))
      this.leftArm.xRot = f(-1.5 + this.head.xRot)
    } else if (this.leftArmPose === 'CROSSBOW_HOLD') {
      this.rightArm.yRot = f(f(-0.6) + this.head.yRot)
      this.leftArm.yRot = f(f(0.3) + this.head.yRot)
      this.rightArm.xRot = f(-1.5 + this.head.xRot)
      this.leftArm.xRot = f(f(-HALF_PI + this.head.xRot) + f(0.1))
    }
    if (this.swimAmount > 0) {
      const p = rem(limbSwing, 26)
      const l = this.attackTime > 0 ? 0 : this.swimAmount
      this.swimArms(p, this.swimAmount, l)
      this.leftLeg.xRot = lerp(this.swimAmount, this.leftLeg.xRot, f(f(0.3) * cos(f(f(limbSwing * f(0.333_333_34)) + PI))))
      this.rightLeg.xRot = lerp(this.swimAmount, this.rightLeg.xRot, f(f(0.3) * cos(f(limbSwing * f(0.333_333_34)))))
    }
    this.hat.copyFrom(this.head)
  }
}

/** HumanoidArmorModel (1.19.4+): HumanoidModel's code. */
export class HumanoidArmorModel extends HumanoidModel {}

/** AbstractZombieModel: the zombie arms after the humanoid pose. */
export class AbstractZombieModel extends HumanoidModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    EntityEraAnimationUtils.animateZombieArms(this, this.leftArm, this.rightArm, this.isAggressive(state), this.attackTime, num(state, 'ageInTicks'))
  }

  isAggressive(state: AnimState) {
    return EntityState.isAggressive(state)
  }
}

export class ZombieModel extends AbstractZombieModel {}

export class GiantZombieModel extends AbstractZombieModel {
  override isAggressive(_state: AnimState) {
    return false
  }
}

/** ZombieVillagerModel: a HumanoidModel with the zombie arms. */
export class ZombieVillagerModel extends HumanoidModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    EntityEraAnimationUtils.animateZombieArms(this, this.leftArm, this.rightArm, EntityState.isAggressive(state), this.attackTime, num(state, 'ageInTicks'))
  }
}

/** DrownedModel: an aggressive drowned throws the trident in its main hand; its own swimming. */
export class DrownedModel extends ZombieModel {
  override prepareMobModel(state: AnimState) {
    this.rightArmPose = 'EMPTY'
    this.leftArmPose = 'EMPTY'
    if (EntityState.item(state, 'mainhand') === 'trident' && EntityState.isAggressive(state)) {
      if (EntityState.mainArm(state) === 'RIGHT') this.rightArmPose = 'THROW_SPEAR'
      else this.leftArmPose = 'THROW_SPEAR'
    }
    super.prepareMobModel(state)
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin } = this.c
    if (this.leftArmPose === 'THROW_SPEAR') {
      this.leftArm.xRot = f(f(this.leftArm.xRot * 0.5) - PI)
      this.leftArm.yRot = 0
    }
    if (this.rightArmPose === 'THROW_SPEAR') {
      this.rightArm.xRot = f(f(this.rightArm.xRot * 0.5) - PI)
      this.rightArm.yRot = 0
    }
    if (this.swimAmount > 0) {
      const h = num(state, 'ageInTicks')
      const wave = sin(f(f(0.1) * h))
      this.rightArm.xRot = f(this.rotlerpRad(this.swimAmount, this.rightArm.xRot, f(-2.513_274_2)) + f(f(this.swimAmount * f(0.35)) * wave))
      this.leftArm.xRot = f(this.rotlerpRad(this.swimAmount, this.leftArm.xRot, f(-2.513_274_2)) - f(f(this.swimAmount * f(0.35)) * wave))
      this.rightArm.zRot = this.rotlerpRad(this.swimAmount, this.rightArm.zRot, f(-0.15))
      this.leftArm.zRot = this.rotlerpRad(this.swimAmount, this.leftArm.zRot, f(0.15))
      this.leftLeg.xRot = f(this.leftLeg.xRot - f(f(this.swimAmount * f(0.55)) * wave))
      this.rightLeg.xRot = f(this.rightLeg.xRot + f(f(this.swimAmount * f(0.55)) * wave))
      this.head.xRot = 0
    }
  }
}

/** SkeletonModel: an aggressive skeleton draws the bow in its main hand, or raises both arms without one. */
export class SkeletonModel extends HumanoidModel {
  override prepareMobModel(state: AnimState) {
    this.rightArmPose = 'EMPTY'
    this.leftArmPose = 'EMPTY'
    if (EntityState.item(state, 'mainhand') === 'bow' && EntityState.isAggressive(state)) {
      if (EntityState.mainArm(state) === 'RIGHT') this.rightArmPose = 'BOW_AND_ARROW'
      else this.leftArmPose = 'BOW_AND_ARROW'
    }
    super.prepareMobModel(state)
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const mainHand = EntityState.item(state, 'mainhand')
    if (EntityState.isAggressive(state) && (!mainHand || mainHand !== 'bow')) {
      const { sin } = this.c
      const k = sin(f(this.attackTime * PI))
      const l = sin(f(f(1 - f(f(1 - this.attackTime) * f(1 - this.attackTime))) * PI))
      this.rightArm.zRot = 0
      this.leftArm.zRot = 0
      this.rightArm.yRot = -f(f(0.1) - f(k * f(0.6)))
      this.leftArm.yRot = f(f(0.1) - f(k * f(0.6)))
      this.rightArm.xRot = -HALF_PI
      this.leftArm.xRot = -HALF_PI
      this.rightArm.xRot = f(this.rightArm.xRot - f(f(k * f(1.2)) - f(l * f(0.4))))
      this.leftArm.xRot = f(this.leftArm.xRot - f(f(k * f(1.2)) - f(l * f(0.4))))
      EntityEraAnimationUtils.bobArms(this, this.rightArm, this.leftArm, num(state, 'ageInTicks'))
    }
  }
}

/** PlayerModel: the outer layer parts follow their parts; the cloak moves with a chest item and crouching. */
export class PlayerModel extends HumanoidModel {
  // 1.16.5's export names PlayerModel's unnamed parts by their creation order: ear cubes_0, cloak cubes_1, left sleeve
  // cubes_3, right sleeve cubes_4, left pants cubes_6, right pants cubes_7, jacket cubes_8
  leftSleeve = this.legacyPart('left_sleeve', 'cubes_3')
  rightSleeve = this.legacyPart('right_sleeve', 'cubes_4')
  leftPants = this.legacyPart('left_pants', 'cubes_6')
  rightPants = this.legacyPart('right_pants', 'cubes_7')
  jacket = this.legacyPart('jacket', 'cubes_8')
  cloak = this.legacyPart('cloak', 'cubes_1')

  /** A part by its name, or (1.16.5) by the name the legacy export gives it. */
  legacyPart(name: string, legacyName: string) {
    return this.model.maybe(name) ?? (this.c.atLeast('1.17') ? undefined : this.model.maybe(legacyName))
  }

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.copyOuterLayer()
    const cloak = this.cloak
    if (!cloak) return
    if (!this.c.atLeast('1.16')) {
      const crouching = this.c.atLeast('1.15') ? EntityState.isCrouching(state) : EntityState.isVisuallySneaking(state)
      cloak.y = crouching ? 2 : 0
    } else if (!EntityState.item(state, 'chest')) {
      if (EntityState.isCrouching(state)) {
        cloak.z = f(1.4)
        cloak.y = f(1.85)
      } else {
        cloak.z = 0
        cloak.y = 0
      }
    } else if (EntityState.isCrouching(state)) {
      cloak.z = f(0.3)
      cloak.y = f(0.8)
    } else {
      cloak.z = f(-1.1)
      cloak.y = f(-0.85)
    }
  }

  copyOuterLayer() {
    this.leftPants?.copyFrom(this.leftLeg)
    this.rightPants?.copyFrom(this.rightLeg)
    this.leftSleeve?.copyFrom(this.leftArm)
    this.rightSleeve?.copyFrom(this.rightArm)
    this.jacket?.copyFrom(this.body)
  }
}

/** Items in the piglin_loved tag (PiglinAi.isLovedItem), as item paths. */
const isPiglinLoved = (item: string | null) =>
  !!item && (/gold/.test(item) || ['bell', 'clock', 'gilded_blackstone', 'light_weighted_pressure_plate', 'glistering_melon_slice'].includes(item))

/** AbstractPiglin.isHoldingMeleeWeapon: a tiered item (sword, axe, pickaxe, shovel, hoe) in the main hand. */
const isTieredItem = (item: string | null) => !!item && /_(sword|axe|pickaxe|shovel|hoe)$/.test(item)

/** The piglin kind PiglinModel poses: the state's entityType, else told apart by the entity's synched data. */
const piglinKind = (state: AnimState): 'piglin' | 'piglin_brute' | 'zombified_piglin' | 'other' => {
  const type = state.entityType as string | undefined
  if (type) return type.replace('minecraft:', '') as any
  if (hasEntityData(state, 'is_dancing')) return 'piglin'
  if (hasEntityData(state, 'immune_to_zombification')) return 'piglin_brute'
  if (hasEntityData(state, 'drowned_conversion') || hasEntityData(state, 'special_type')) return 'zombified_piglin'
  return 'other'
}

/** AbstractPiglin.getArmPose (Piglin's or PiglinBrute's), null for other entities. */
const piglinArmPose = (state: AnimState): string | null => {
  const kind = piglinKind(state)
  const aggressive = EntityState.isAggressive(state)
  const melee = aggressive && isTieredItem(EntityState.item(state, 'mainhand'))
  if (kind === 'piglin_brute') return melee ? 'ATTACKING_WITH_MELEE_WEAPON' : 'DEFAULT'
  if (kind !== 'piglin') return null
  if (entityData(state, 'is_dancing', false)) return 'DANCING'
  if (isPiglinLoved(EntityState.item(state, 'offhand'))) return 'ADMIRING_ITEM'
  if (melee) return 'ATTACKING_WITH_MELEE_WEAPON'
  if (entityData(state, 'is_charging_crossbow', false)) return 'CROSSBOW_CHARGE'
  return aggressive && EntityState.isHolding(state, 'crossbow') ? 'CROSSBOW_HOLD' : 'DEFAULT'
}

/**
 * PiglinModel (1.16+, piglins, piglin brutes and zombified piglins). The ear at +4.5 is left_ear (1.16.5: earRight, head/cubes_11
 * in the export, with the same pose code), the one at -4.5 right_ear (earLeft, head/cubes_12).
 */
export class PiglinModel extends PlayerModel {
  leftEar = this.legacyPart('left_ear', 'head/cubes_11')!
  rightEar = this.legacyPart('right_ear', 'head/cubes_12')!

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const h = num(state, 'ageInTicks')
    const l = f(f(h * f(0.1)) + f(num(state, 'walkAnimationPos') * 0.5))
    const m = f(f(0.08) + f(num(state, 'walkAnimationSpeed') * f(0.4)))
    this.leftEar.zRot = f(f(-0.523_598_8) - f(cos(f(l * f(1.2))) * m))
    this.rightEar.zRot = f(f(0.523_598_8) + f(cos(l) * m))
    const armPose = piglinArmPose(state)
    const leftHanded = EntityState.isLeftHanded(state)
    if (armPose !== null) {
      if (armPose === 'DANCING') {
        const n = f(h / 60)
        this.rightEar.zRot = f(f(0.523_598_8) + f(f(DEG_TO_RAD * sin(f(n * 30))) * 10))
        this.leftEar.zRot = f(f(-0.523_598_8) - f(f(DEG_TO_RAD * cos(f(n * 30))) * 10))
        this.head.x = sin(f(n * 10))
        this.head.y = f(sin(f(n * 40)) + f(0.4))
        this.rightArm.zRot = f(DEG_TO_RAD * f(70 + f(cos(f(n * 40)) * 10)))
        this.leftArm.zRot = f(this.rightArm.zRot * -1)
        this.rightArm.y = f(f(sin(f(n * 40)) * 0.5) + 1.5)
        this.leftArm.y = f(f(sin(f(n * 40)) * 0.5) + 1.5)
        this.body.y = f(sin(f(n * 40)) * f(0.35))
      } else if (armPose === 'ATTACKING_WITH_MELEE_WEAPON' && this.attackTime === 0) {
        if (leftHanded) this.leftArm.xRot = f(-1.8)
        else this.rightArm.xRot = f(-1.8)
      } else if (armPose === 'CROSSBOW_HOLD') {
        EntityEraAnimationUtils.animateCrossbowHold(this.rightArm, this.leftArm, this.head, !leftHanded)
      } else if (armPose === 'CROSSBOW_CHARGE') {
        EntityEraAnimationUtils.animateCrossbowCharge(this.rightArm, this.leftArm, state, !leftHanded)
      } else if (armPose === 'ADMIRING_ITEM') {
        this.head.xRot = 0.5
        this.head.yRot = 0
        if (leftHanded) {
          this.rightArm.yRot = -0.5
          this.rightArm.xRot = f(-0.9)
        } else {
          this.leftArm.yRot = 0.5
          this.leftArm.xRot = f(-0.9)
        }
      }
    } else if (piglinKind(state) === 'zombified_piglin') {
      EntityEraAnimationUtils.animateZombieArms(this, this.leftArm, this.rightArm, EntityState.isAggressive(state), this.attackTime, h)
    }
    this.copyOuterLayer()
    this.hat.copyFrom(this.head)
  }

  override setupAttackAnimation(state: AnimState, ageInTicks: number) {
    if (this.attackTime > 0 && piglinKind(state) === 'piglin' && piglinArmPose(state) === 'ATTACKING_WITH_MELEE_WEAPON') {
      EntityEraAnimationUtils.swingWeaponDown(this, this.rightArm, this.leftArm, EntityState.mainArm(state), this.attackTime, ageInTicks)
    } else {
      super.setupAttackAnimation(state, ageInTicks)
    }
  }
}

/** BoggedModel (1.20.5+): the mushrooms show unless it is sheared, then the skeleton's code. */
export class BoggedModel extends SkeletonModel {
  mushrooms = this.model.maybe('mushrooms')

  override prepareMobModel(state: AnimState) {
    if (this.mushrooms) this.mushrooms.visible = !entityData(state, 'sheared', false)
    super.prepareMobModel(state)
  }
}

export const ENTITY_ERA_HUMANOID_MODELS: Record<string, AnimModelClass> = {
  BoggedModel,
  HumanoidModel,
  HumanoidArmorModel,
  AbstractZombieModel,
  ZombieModel,
  GiantZombieModel,
  ZombieVillagerModel,
  DrownedModel,
  SkeletonModel,
  PlayerModel,
  PiglinModel
}
