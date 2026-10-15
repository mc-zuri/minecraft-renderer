import { AnimModel, type AnimModelClass, type AnimState, type PartPose } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, f, lerp, rotLerpRad, triangleWave } from '../mth'

/**
 * QuadrupedModel and the animals built on it (cows, pigs, sheep, polar bears, pandas, goats, turtles), plus the
 * quadrupeds with their own leg code (hoglins, llamas, ravagers), 1.14.4 - 1.21.1: posed from the entity
 * (prepareMobModel then setupAnim). Before 1.17 the models are legacy layers: part names are the fields' (leg0 - leg3,
 * chest1, egg_belly...) and QuadrupedModel / LlamaModel / RavagerModel set the body's xRot in setupAnim.
 */

/** A synched data value by its name (state.dataNames: index -> name), or the data's default when the sample has none. */
const data = (state: AnimState, name: string, fallback: unknown): any => {
  const names = (state.dataNames ?? {}) as Record<string, string>
  for (const [index, dataName] of Object.entries(names)) {
    if (dataName === name) return state[`data.${index}`] ?? fallback
  }
  return fallback
}

const isBaby = (state: AnimState): boolean => data(state, 'baby', false)

/** The first of these names the version's layer has (legacy field names vs 1.17+ part names). */
const pick = (model: AnimModel, ...names: string[]): PartPose => {
  for (const name of names) {
    const part = model.model.maybe(name)
    if (part) return part
  }
  throw new Error(`no part ${names.join(' / ')}`)
}

/**
 * EntityModel: setupAnim = resetPose (every sample starts from the initial pose), prepareMobModel(entity, pos, speed,
 * partialTick), then the model's setupAnim(entity, pos, speed, ageInTicks, netHeadYaw, headPitch) (entitySetupAnim).
 */
class EntityModel extends AnimModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.prepareMobModel(state)
    this.entitySetupAnim(state)
  }

  prepareMobModel(_state: AnimState) {}

  entitySetupAnim(_state: AnimState) {}

  /** the model's young field: the renderer sets it from the entity (isBaby), the game's default is true */
  young(state: AnimState): boolean {
    return state['model.young'] ?? true
  }
}

export class QuadrupedModel extends EntityModel {
  head = this.part('head')
  body = this.part('body')
  rightHindLeg = pick(this, 'right_hind_leg', 'leg0')
  leftHindLeg = pick(this, 'left_hind_leg', 'leg1')
  rightFrontLeg = pick(this, 'right_front_leg', 'leg2')
  leftFrontLeg = pick(this, 'left_front_leg', 'leg3')

  override entitySetupAnim(state: AnimState) {
    const { cos } = this.c
    const pos = state.walkAnimationPos as number
    const speed = state.walkAnimationSpeed as number
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    // before 1.17 setupAnim also stood the body up
    if (!this.c.atLeast('1.17')) this.body.xRot = HALF_PI
    this.rightHindLeg.xRot = f(f(cos(f(pos * f(0.6662))) * f(1.4)) * speed)
    this.leftHindLeg.xRot = f(f(cos(f(f(pos * f(0.6662)) + PI)) * f(1.4)) * speed)
    this.rightFrontLeg.xRot = f(f(cos(f(f(pos * f(0.6662)) + PI)) * f(1.4)) * speed)
    this.leftFrontLeg.xRot = f(f(cos(f(pos * f(0.6662))) * f(1.4)) * speed)
  }
}

export class CowModel extends QuadrupedModel {}

export class PigModel extends QuadrupedModel {}

/** Sheep.getHeadEatPositionScale(partialTick) */
const headEatPositionScale = (state: AnimState) => {
  const tick = (state['entity.eatAnimationTick'] ?? 0) as number
  const partialTick = state.partialTick as number
  if (tick <= 0) return 0
  if (tick >= 4 && tick <= 36) return 1
  return tick < 4 ? f(f(tick - partialTick) / 4) : f(-f(f(tick - 40) - partialTick) / 4)
}

/** Sheep.getHeadEatAngleScale(partialTick) */
const headEatAngleScale = (state: AnimState, sin: (x: number) => number) => {
  const tick = (state['entity.eatAnimationTick'] ?? 0) as number
  if (tick > 4 && tick <= 36) {
    const progress = f(f(f(tick - 4) - state.partialTick) / 32)
    return f(f(0.628_318_55) + f(f(0.219_911_49) * sin(f(progress * f(28.7)))))
  }
  // the entity's own xRot (getXRot), not the head pitch passed to setupAnim
  return tick > 0 ? f(0.628_318_55) : f((state['entity.xRot'] ?? 0) * DEG_TO_RAD)
}

export class SheepModel extends QuadrupedModel {
  headXRot = 0

  override prepareMobModel(state: AnimState) {
    super.prepareMobModel(state)
    this.head.y = f(6 + f(headEatPositionScale(state) * 9))
    this.headXRot = headEatAngleScale(state, this.c.sin)
  }

  override entitySetupAnim(state: AnimState) {
    super.entitySetupAnim(state)
    this.head.xRot = this.headXRot
  }
}

/** SheepFurModel: the same code as SheepModel's (a separate class in the game). */
export class SheepFurModel extends SheepModel {}

export class PolarBearModel extends QuadrupedModel {
  override entitySetupAnim(state: AnimState) {
    super.entitySetupAnim(state)
    // ageInTicks - tickCount: the partial tick
    const partial = f(state.ageInTicks - (state['entity.tickCount'] ?? 0))
    const standO = (state['entity.clientSideStandAnimationO'] ?? 0) as number
    const stand = (state['entity.clientSideStandAnimation'] ?? 0) as number
    let standScale = f(lerp(partial, standO, stand) / 6)
    standScale = f(standScale * standScale)
    const rest = f(1 - standScale)
    this.body.xRot = f(HALF_PI - f(f(standScale * PI) * f(0.35)))
    this.body.y = f(f(9 * rest) + f(11 * standScale))
    this.rightFrontLeg.y = f(f(14 * rest) - f(6 * standScale))
    this.rightFrontLeg.z = f(f(-8 * rest) - f(4 * standScale))
    this.rightFrontLeg.xRot = f(this.rightFrontLeg.xRot - f(f(standScale * PI) * f(0.45)))
    this.leftFrontLeg.y = this.rightFrontLeg.y
    this.leftFrontLeg.z = this.rightFrontLeg.z
    this.leftFrontLeg.xRot = f(this.leftFrontLeg.xRot - f(f(standScale * PI) * f(0.45)))
    if (this.young(state)) {
      this.head.y = f(f(10 * rest) - f(9 * standScale))
      this.head.z = f(f(-16 * rest) - f(7 * standScale))
    } else {
      this.head.y = f(f(10 * rest) - f(14 * standScale))
      this.head.z = f(f(-16 * rest) - f(3 * standScale))
    }
    this.head.xRot = f(this.head.xRot + f(f(standScale * PI) * f(0.15)))
  }
}

export class PandaModel extends QuadrupedModel {
  sitAmount = 0
  lieOnBackAmount = 0
  rollAmount = 0

  override prepareMobModel(state: AnimState) {
    super.prepareMobModel(state)
    const partialTick = state.partialTick as number
    this.sitAmount = lerp(partialTick, state['entity.sitAmountO'] ?? 0, state['entity.sitAmount'] ?? 0)
    this.lieOnBackAmount = lerp(partialTick, state['entity.onBackAmountO'] ?? 0, state['entity.onBackAmount'] ?? 0)
    this.rollAmount = isBaby(state) ? 0 : lerp(partialTick, state['entity.rollAmountO'] ?? 0, state['entity.rollAmount'] ?? 0)
  }

  override entitySetupAnim(state: AnimState) {
    super.entitySetupAnim(state)
    const { sin } = this.c
    const age = state.ageInTicks as number
    const flags = data(state, 'id_flags', 0) as number
    const unhappy = (data(state, 'unhappy_counter', 0) as number) > 0
    const sneezing = (flags & 2) !== 0
    const sneezeCounter = data(state, 'sneeze_counter', 0) as number
    const eating = (data(state, 'eat_counter', 0) as number) > 0
    // Panda.isScared: worried and the level thundering (no level here)
    const scared = (state['entity.isScared'] ?? false) as boolean
    if (unhappy) {
      this.head.yRot = f(f(0.35) * sin(f(f(0.6) * age)))
      this.head.zRot = f(f(0.35) * sin(f(f(0.6) * age)))
      this.rightFrontLeg.xRot = f(f(-0.75) * sin(f(f(0.3) * age)))
      this.leftFrontLeg.xRot = f(f(0.75) * sin(f(f(0.3) * age)))
    } else {
      this.head.zRot = 0
    }
    if (sneezing) {
      if (sneezeCounter < 15) {
        this.head.xRot = f(f(f(-0.785_398_2) * sneezeCounter) / 14)
      } else if (sneezeCounter < 20) {
        // int division
        const internal = Math.trunc((sneezeCounter - 15) / 5)
        this.head.xRot = f(f(-0.785_398_2) + f(f(0.785_398_2) * internal))
      }
    }
    if (this.sitAmount > 0) {
      this.body.xRot = rotLerpRad(this.sitAmount, this.body.xRot, f(1.740_796_3))
      this.head.xRot = rotLerpRad(this.sitAmount, this.head.xRot, HALF_PI)
      this.rightFrontLeg.zRot = f(-0.270_796_42)
      this.leftFrontLeg.zRot = f(0.270_796_42)
      this.rightHindLeg.zRot = f(0.570_796_4)
      this.leftHindLeg.zRot = f(-0.570_796_4)
      if (eating) {
        this.head.xRot = f(HALF_PI + f(f(0.2) * sin(f(age * f(0.6)))))
        this.rightFrontLeg.xRot = f(f(-0.4) - f(f(0.2) * sin(f(age * f(0.6)))))
        this.leftFrontLeg.xRot = f(f(-0.4) - f(f(0.2) * sin(f(age * f(0.6)))))
      }
      if (scared) {
        this.head.xRot = f(2.170_796_4)
        this.rightFrontLeg.xRot = f(-0.9)
        this.leftFrontLeg.xRot = f(-0.9)
      }
    } else {
      this.rightHindLeg.zRot = 0
      this.leftHindLeg.zRot = 0
      this.rightFrontLeg.zRot = 0
      this.leftFrontLeg.zRot = 0
    }
    if (this.lieOnBackAmount > 0) {
      this.rightHindLeg.xRot = f(f(-0.6) * sin(f(age * f(0.15))))
      this.leftHindLeg.xRot = f(f(0.6) * sin(f(age * f(0.15))))
      this.rightFrontLeg.xRot = f(f(0.3) * sin(f(age * 0.25)))
      this.leftFrontLeg.xRot = f(f(-0.3) * sin(f(age * 0.25)))
      this.head.xRot = rotLerpRad(this.lieOnBackAmount, this.head.xRot, HALF_PI)
    }
    if (this.rollAmount > 0) {
      this.head.xRot = rotLerpRad(this.rollAmount, this.head.xRot, f(2.056_194_5))
      this.rightHindLeg.xRot = f(-0.5 * sin(f(age * 0.5)))
      this.leftHindLeg.xRot = f(0.5 * sin(f(age * 0.5)))
      this.rightFrontLeg.xRot = f(0.5 * sin(f(age * 0.5)))
      this.leftFrontLeg.xRot = f(-0.5 * sin(f(age * 0.5)))
    }
  }
}

/** GoatModel (1.17+) */
export class GoatModel extends QuadrupedModel {
  leftHorn = this.part('head/left_horn')
  rightHorn = this.part('head/right_horn')

  override entitySetupAnim(state: AnimState) {
    if (this.c.atLeast('1.19')) {
      this.leftHorn.visible = data(state, 'has_left_horn', true)
      this.rightHorn.visible = data(state, 'has_right_horn', true)
    } else {
      // 1.17 - 1.18: horns for adults
      this.leftHorn.visible = !isBaby(state)
      this.rightHorn.visible = !isBaby(state)
    }
    super.entitySetupAnim(state)
    // Goat.getRammingXHeadRot
    const rammingXHeadRot = f(f(f((state['entity.lowerHeadTick'] ?? 0) / 20) * 30) * DEG_TO_RAD)
    if (rammingXHeadRot !== 0) this.head.xRot = rammingXHeadRot
  }
}

export class TurtleModel extends QuadrupedModel {
  eggBelly = this.part('egg_belly')

  override entitySetupAnim(state: AnimState) {
    super.entitySetupAnim(state)
    const { cos } = this.c
    const pos = state.walkAnimationPos as number
    const speed = state.walkAnimationSpeed as number
    this.rightHindLeg.xRot = f(f(cos(f(f(pos * f(0.6662)) * f(0.6))) * 0.5) * speed)
    this.leftHindLeg.xRot = f(f(cos(f(f(f(pos * f(0.6662)) * f(0.6)) + PI)) * 0.5) * speed)
    this.rightFrontLeg.zRot = f(f(cos(f(f(f(pos * f(0.6662)) * f(0.6)) + PI)) * 0.5) * speed)
    this.leftFrontLeg.zRot = f(f(cos(f(f(pos * f(0.6662)) * f(0.6))) * 0.5) * speed)
    this.rightFrontLeg.xRot = 0
    this.leftFrontLeg.xRot = 0
    this.rightFrontLeg.yRot = 0
    this.leftFrontLeg.yRot = 0
    this.rightHindLeg.yRot = 0
    this.leftHindLeg.yRot = 0
    if (!this.c.atLeast('1.17')) this.eggBelly.xRot = HALF_PI
    const inWater = (state['entity.wasTouchingWater'] ?? false) as boolean
    const onGround = (state['entity.onGround'] ?? false) as boolean
    if (!inWater && onGround) {
      const layingEgg = data(state, 'laying_egg', false) as boolean
      const layEgg = layingEgg ? 4 : 1
      const layEggAmplitude = layingEgg ? 2 : 1
      this.rightFrontLeg.yRot = f(f(f(cos(f(f(f(layEgg * pos) * 5) + PI)) * 8) * speed) * layEggAmplitude)
      this.rightFrontLeg.zRot = 0
      this.leftFrontLeg.yRot = f(f(f(cos(f(f(layEgg * pos) * 5)) * 8) * speed) * layEggAmplitude)
      this.leftFrontLeg.zRot = 0
      this.rightHindLeg.yRot = f(f(cos(f(f(pos * 5) + PI)) * 3) * speed)
      this.rightHindLeg.xRot = 0
      this.leftHindLeg.yRot = f(f(cos(f(pos * 5)) * 3) * speed)
      this.leftHindLeg.xRot = 0
    }
    // 1.14.4 drew the egg belly in render instead
    if (this.c.atLeast('1.15')) this.eggBelly.visible = !this.young(state) && (data(state, 'has_egg', false) as boolean)
  }
}

/** HoglinModel (1.16+, hoglins and zoglins) */
export class HoglinModel extends EntityModel {
  head = this.part('head')
  rightEar = this.part('right_ear')
  leftEar = this.part('left_ear')
  mane = this.part('mane')
  rightFrontLeg = pick(this, 'right_front_leg', 'front_right_leg')
  leftFrontLeg = pick(this, 'left_front_leg', 'front_left_leg')
  rightHindLeg = pick(this, 'right_hind_leg', 'back_right_leg')
  leftHindLeg = pick(this, 'left_hind_leg', 'back_left_leg')

  override entitySetupAnim(state: AnimState) {
    const { sin, cos } = this.c
    const pos = state.walkAnimationPos as number
    const speed = state.walkAnimationSpeed as number
    this.rightEar.zRot = f(f(-0.698_131_7) - f(speed * sin(pos)))
    this.leftEar.zRot = f(f(0.698_131_7) + f(speed * sin(pos)))
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    const attackTicks = (state['entity.attackAnimationRemainingTicks'] ?? 0) as number
    const headbutt = f(1 - f(Math.abs(10 - 2 * attackTicks) / 10))
    this.head.xRot = lerp(headbutt, f(0.872_664_63), f(-0.349_065_84))
    if (isBaby(state)) {
      this.head.y = lerp(headbutt, 2, 5)
      this.mane.z = -3
    } else {
      this.head.y = 2
      this.mane.z = -7
    }
    this.rightFrontLeg.xRot = f(f(cos(pos) * f(1.2)) * speed)
    this.leftFrontLeg.xRot = f(f(cos(f(pos + PI)) * f(1.2)) * speed)
    this.rightHindLeg.xRot = this.leftFrontLeg.xRot
    this.leftHindLeg.xRot = this.rightFrontLeg.xRot
  }
}

/** LlamaModel (a QuadrupedModel in 1.14.4, its own EntityModel since: the same leg code) */
export class LlamaModel extends EntityModel {
  head = this.part('head')
  body = this.part('body')
  rightChest = pick(this, 'right_chest', 'chest1')
  leftChest = pick(this, 'left_chest', 'chest2')
  rightHindLeg = pick(this, 'right_hind_leg', 'leg0')
  leftHindLeg = pick(this, 'left_hind_leg', 'leg1')
  rightFrontLeg = pick(this, 'right_front_leg', 'leg2')
  leftFrontLeg = pick(this, 'left_front_leg', 'leg3')

  override entitySetupAnim(state: AnimState) {
    const { cos } = this.c
    const pos = state.walkAnimationPos as number
    const speed = state.walkAnimationSpeed as number
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    if (!this.c.atLeast('1.17')) this.body.xRot = HALF_PI
    this.rightHindLeg.xRot = f(f(cos(f(pos * f(0.6662))) * f(1.4)) * speed)
    this.leftHindLeg.xRot = f(f(cos(f(f(pos * f(0.6662)) + PI)) * f(1.4)) * speed)
    this.rightFrontLeg.xRot = f(f(cos(f(f(pos * f(0.6662)) + PI)) * f(1.4)) * speed)
    this.leftFrontLeg.xRot = f(f(cos(f(pos * f(0.6662))) * f(1.4)) * speed)
    // 1.14.4 drew the chests in render instead
    if (this.c.atLeast('1.15')) {
      const chested = !isBaby(state) && (data(state, 'id_chest', false) as boolean)
      this.rightChest.visible = chested
      this.leftChest.visible = chested
    }
  }
}

export class RavagerModel extends EntityModel {
  neck = this.part('neck')
  head = this.part('head')
  mouth = this.part('mouth')
  body = this.part('body')
  rightHindLeg = pick(this, 'right_hind_leg', 'leg0')
  leftHindLeg = pick(this, 'left_hind_leg', 'leg1')
  rightFrontLeg = pick(this, 'right_front_leg', 'leg2')
  leftFrontLeg = pick(this, 'left_front_leg', 'leg3')

  override entitySetupAnim(state: AnimState) {
    const { cos } = this.c
    const pos = state.walkAnimationPos as number
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    if (!this.c.atLeast('1.17')) this.body.xRot = HALF_PI
    const legRot = f(f(0.4) * state.walkAnimationSpeed)
    this.rightHindLeg.xRot = f(cos(f(pos * f(0.6662))) * legRot)
    this.leftHindLeg.xRot = f(cos(f(f(pos * f(0.6662)) + PI)) * legRot)
    this.rightFrontLeg.xRot = f(cos(f(f(pos * f(0.6662)) + PI)) * legRot)
    this.leftFrontLeg.xRot = f(cos(f(pos * f(0.6662))) * legRot)
  }

  override prepareMobModel(state: AnimState) {
    super.prepareMobModel(state)
    const { sin } = this.c
    const partialTick = state.partialTick as number
    const stunnedTick = (state['entity.stunnedTick'] ?? 0) as number
    const roarTick = (state['entity.roarTick'] ?? 0) as number
    const attackTick = (state['entity.attackTick'] ?? 0) as number
    if (attackTick > 0) {
      const headAnim = triangleWave(f(attackTick - partialTick), 10)
      const scaled = f(f(1 + headAnim) * 0.5)
      const headPos = f(f(f(scaled * scaled) * scaled) * 12)
      const yOffset = f(headPos * sin(this.neck.xRot))
      this.neck.z = f(-6.5 + headPos)
      this.neck.y = f(-7 - yOffset)
      const mouthAnim = sin(f(f(f(f(attackTick - partialTick) / 10) * PI) * 0.25))
      this.mouth.xRot = f(HALF_PI * mouthAnim)
      if (attackTick > 5) {
        this.mouth.xRot = f(f(sin(f(f(f(-4 + attackTick) - partialTick) / 4)) * PI) * f(0.4))
      } else {
        this.mouth.xRot = f(f(0.157_079_64) * sin(f(f(PI * f(attackTick - partialTick)) / 10)))
      }
    } else {
      const yOffset = f(-1 * sin(this.neck.xRot))
      this.neck.x = 0
      this.neck.y = f(-7 - yOffset)
      this.neck.z = 5.5
      const stunned = stunnedTick > 0
      this.neck.xRot = stunned ? f(0.219_911_49) : 0
      this.mouth.xRot = f(PI * (stunned ? f(0.05) : f(0.01)))
      if (stunned) {
        // java.lang.Math.sin in double
        const time = stunnedTick / 40
        this.neck.x = f(f(Math.sin(time * 10)) * 3)
      } else if (roarTick > 0) {
        const mouthAnim = sin(f(f(f(f(f(20 - roarTick) - partialTick) / 20) * PI) * 0.25))
        this.mouth.xRot = f(HALF_PI * mouthAnim)
      }
    }
  }
}

export const ENTITY_ERA_QUADRUPEDS_MODELS: Record<string, AnimModelClass> = {
  QuadrupedModel,
  CowModel,
  PigModel,
  SheepModel,
  SheepFurModel,
  PolarBearModel,
  PandaModel,
  GoatModel,
  HoglinModel,
  TurtleModel,
  LlamaModel,
  LlamaSpitModel: AnimModel,
  RavagerModel
}
