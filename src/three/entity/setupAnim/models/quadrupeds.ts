import { AnimModel, type AnimModelClass, type AnimState } from '../types'
import { DEG_TO_RAD, HALF_PI, PI, f, lerp, rotLerpRad, triangleWave } from '../mth'

/**
 * QuadrupedModel and the four-legged animals built on it (cows, pigs, sheep, polar bears, pandas, goats, turtles), plus
 * the other quadrupeds with their own leg code (hoglins, llamas, ravagers), 26.3, with the 1.21.2 - 1.21.11 differences
 * branched on the version (before 26.1 babies were the adult class with a baby flag / baby mesh transformer).
 */

export class QuadrupedModel extends AnimModel {
  head = this.part('head')
  body = this.part('body')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    const animationPos = state.walkAnimationPos as number
    const animationSpeed = state.walkAnimationSpeed as number
    this.rightHindLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
    this.leftHindLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
    this.rightFrontLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
    this.leftFrontLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
  }
}

export class CowModel extends QuadrupedModel {}

export class PigModel extends QuadrupedModel {}

export class SheepModel extends QuadrupedModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.head.y = f(this.head.y + f(f(state.headEatPositionScale * 9) * state.ageScale))
    this.head.xRot = state.headEatAngleScale
  }
}

/** SheepFurModel: the same code as SheepModel's (a separate class in the game). */
export class SheepFurModel extends QuadrupedModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.head.y = f(this.head.y + f(f(state.headEatPositionScale * 9) * state.ageScale))
    this.head.xRot = state.headEatAngleScale
  }
}

export class PolarBearModel extends QuadrupedModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const standScale = f(state.standScale * state.standScale)
    const bodyAgeScale = state.ageScale as number
    this.body.xRot = f(this.body.xRot - f(f(standScale * PI) * f(0.35)))
    this.body.y = f(this.body.y + f(f(standScale * bodyAgeScale) * 2))
    this.rightFrontLeg.y = f(this.rightFrontLeg.y - f(f(standScale * bodyAgeScale) * 20))
    this.rightFrontLeg.z = f(this.rightFrontLeg.z + f(f(standScale * bodyAgeScale) * 4))
    this.rightFrontLeg.xRot = f(this.rightFrontLeg.xRot - f(f(standScale * PI) * f(0.45)))
    this.leftFrontLeg.y = this.rightFrontLeg.y
    this.leftFrontLeg.z = this.rightFrontLeg.z
    this.leftFrontLeg.xRot = f(this.leftFrontLeg.xRot - f(f(standScale * PI) * f(0.45)))
    if (this.c.atLeast('26.1')) {
      this.head.y = f(this.head.y - f(standScale * 24))
      this.head.z = f(this.head.z + f(standScale * 13))
    } else {
      // before 26.1 (one class for adults and babies): the head's stand offsets shrink for babies
      const headAgeScale = state.isBaby ? f(0.444_444_45) : 1
      this.head.y = f(this.head.y - f(f(standScale * headAgeScale) * 24))
      this.head.z = f(this.head.z + f(f(standScale * headAgeScale) * 13))
    }
    this.head.xRot = f(this.head.xRot + f(f(standScale * PI) * f(0.15)))
  }
}

export class PandaModel extends QuadrupedModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin } = this.c
    const ageInTicks = state.ageInTicks as number
    if (state.isUnhappy) {
      this.head.yRot = f(f(0.35) * sin(f(f(0.6) * ageInTicks)))
      this.head.zRot = f(f(0.35) * sin(f(f(0.6) * ageInTicks)))
      this.rightFrontLeg.xRot = f(f(-0.75) * sin(f(f(0.3) * ageInTicks)))
      this.leftFrontLeg.xRot = f(f(0.75) * sin(f(f(0.3) * ageInTicks)))
    } else {
      this.head.zRot = 0
    }
    if (state.isSneezing) {
      const sneezeTime = state.sneezeTime as number
      if (sneezeTime < 15) {
        this.head.xRot = f(f(f(-0.785_398_2) * sneezeTime) / 14)
      } else if (sneezeTime < 20) {
        // int division
        const internalSneezePos = Math.trunc((sneezeTime - 15) / 5)
        this.head.xRot = f(f(-0.785_398_2) + f(f(0.785_398_2) * internalSneezePos))
      }
    }
    if (state.sitAmount > 0) {
      this.animateSitting(state)
      if (state.isEating) {
        this.head.xRot = f(HALF_PI + f(f(0.2) * sin(f(ageInTicks * f(0.6)))))
        this.rightFrontLeg.xRot = f(f(-0.4) - f(f(0.2) * sin(f(ageInTicks * f(0.6)))))
        this.leftFrontLeg.xRot = f(f(-0.4) - f(f(0.2) * sin(f(ageInTicks * f(0.6)))))
      }
      if (state.isScared) {
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
    if (state.lieOnBackAmount > 0) {
      this.rightHindLeg.xRot = f(f(-0.6) * sin(f(ageInTicks * f(0.15))))
      this.leftHindLeg.xRot = f(f(0.6) * sin(f(ageInTicks * f(0.15))))
      this.rightFrontLeg.xRot = f(f(0.3) * sin(f(ageInTicks * 0.25)))
      this.leftFrontLeg.xRot = f(f(-0.3) * sin(f(ageInTicks * 0.25)))
      this.head.xRot = rotLerpRad(state.lieOnBackAmount, this.head.xRot, HALF_PI)
    }
    if (state.rollAmount > 0) {
      this.head.xRot = rotLerpRad(state.rollAmount, this.head.xRot, f(2.056_194_5))
      this.rightHindLeg.xRot = f(-0.5 * sin(f(ageInTicks * 0.5)))
      this.leftHindLeg.xRot = f(0.5 * sin(f(ageInTicks * 0.5)))
      this.rightFrontLeg.xRot = f(0.5 * sin(f(ageInTicks * 0.5)))
      this.leftFrontLeg.xRot = f(-0.5 * sin(f(ageInTicks * 0.5)))
    }
  }

  animateSitting(state: AnimState) {
    this.body.xRot = rotLerpRad(state.sitAmount, this.body.xRot, f(1.740_796_3))
    this.head.xRot = rotLerpRad(state.sitAmount, this.head.xRot, HALF_PI)
    this.rightFrontLeg.zRot = f(-0.270_796_42)
    this.leftFrontLeg.zRot = f(0.270_796_42)
    this.rightHindLeg.zRot = f(0.570_796_4)
    this.leftHindLeg.zRot = f(-0.570_796_4)
  }
}

export class BabyPandaModel extends PandaModel {
  override animateSitting(state: AnimState) {
    const sitAmount = state.sitAmount as number
    this.body.xRot = rotLerpRad(sitAmount, this.body.xRot, f(0.174_532_92))
    this.body.z = lerp(sitAmount, this.body.z, -1.5)
    this.head.z = lerp(sitAmount, this.head.z, -11.5)
    this.head.y = lerp(sitAmount, this.head.y, 17.5)
    this.rightFrontLeg.z = lerp(sitAmount, this.rightFrontLeg.z, -5)
    this.leftFrontLeg.z = lerp(sitAmount, this.leftFrontLeg.z, -5)
    this.rightHindLeg.z = lerp(sitAmount, this.rightHindLeg.z, 3)
    this.leftHindLeg.z = lerp(sitAmount, this.leftHindLeg.z, 3)
    this.rightFrontLeg.zRot = f(-0.270_796_42)
    this.leftFrontLeg.zRot = f(0.270_796_42)
    this.rightHindLeg.zRot = f(0.570_796_4)
    this.leftHindLeg.zRot = f(-0.570_796_4)
  }
}

export class GoatModel extends QuadrupedModel {
  leftHorn = this.part('head/left_horn')
  rightHorn = this.part('head/right_horn')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.leftHorn.visible = state.hasLeftHorn
    this.rightHorn.visible = state.hasRightHorn
    if (state.rammingXHeadRot !== 0) this.head.xRot = state.rammingXHeadRot
  }
}

export class BabyGoatModel extends GoatModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    if (state.rammingXHeadRot === 0) this.head.xRot = f(0.392_699_1)
  }
}

/** TurtleModel (abstract in the game) */
export class TurtleModel extends QuadrupedModel {
  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    const animationPos = state.walkAnimationPos as number
    const animationSpeed = state.walkAnimationSpeed as number
    if (state.isOnLand) {
      const layEgg = state.isLayingEgg ? 4 : 1
      const layEggAmplitude = state.isLayingEgg ? 2 : 1
      const swingPos = f(animationPos * 5)
      const frontSwing = cos(f(layEgg * swingPos))
      const hindSwing = cos(swingPos)
      this.rightFrontLeg.yRot = f(f(f(-frontSwing * 8) * animationSpeed) * layEggAmplitude)
      this.leftFrontLeg.yRot = f(f(f(frontSwing * 8) * animationSpeed) * layEggAmplitude)
      this.rightHindLeg.yRot = f(f(-hindSwing * 3) * animationSpeed)
      this.leftHindLeg.yRot = f(f(hindSwing * 3) * animationSpeed)
    } else {
      const swingScale = f(0.5 * animationSpeed)
      const swing = f(cos(f(f(animationPos * f(0.6662)) * f(0.6))) * swingScale)
      this.rightHindLeg.xRot = swing
      this.leftHindLeg.xRot = -swing
      this.rightFrontLeg.zRot = -swing
      this.leftFrontLeg.zRot = swing
    }
  }
}

export class AdultTurtleModel extends TurtleModel {
  eggBelly = this.part('egg_belly')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    this.eggBelly.visible = state.hasEgg
    if (this.eggBelly.visible) this.model.root.y = f(this.model.root.y - 1)
  }
}

export class BabyTurtleModel extends TurtleModel {}

/**
 * TurtleModel before 26.1 (a concrete class for adults and babies, the baby layer is the adult mesh scaled): the
 * egg belly code that 26.1 moved to AdultTurtleModel, so the same code.
 */
export class LegacyTurtleModel extends AdultTurtleModel {}

export class HoglinModel extends AnimModel {
  head = this.part('head')
  rightEar = this.part('head/right_ear')
  leftEar = this.part('head/left_ear')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    this.rightEar.zRot = f(f(-0.698_131_7) - f(animationSpeed * sin(animationPos)))
    this.leftEar.zRot = f(f(0.698_131_7) + f(animationSpeed * sin(animationPos)))
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    const headbuttLerpFactor = f(1 - f(Math.abs(10 - 2 * state.attackAnimationRemainingTicks) / 10))
    this.animateHeadbutt(headbuttLerpFactor)
    // before 26.1 (one class for adults and babies): the baby's headbutt raise, BabyHoglinModel's since
    if (!this.c.atLeast('26.1') && state.isBaby) this.head.y = f(this.head.y + f(headbuttLerpFactor * 2.5))
    this.rightFrontLeg.xRot = f(f(cos(animationPos) * f(1.2)) * animationSpeed)
    this.leftFrontLeg.xRot = f(f(cos(f(animationPos + PI)) * f(1.2)) * animationSpeed)
    this.rightHindLeg.xRot = this.leftFrontLeg.xRot
    this.leftHindLeg.xRot = this.rightFrontLeg.xRot
  }

  animateHeadbutt(headbuttLerpFactor: number) {
    this.head.xRot = lerp(headbuttLerpFactor, f(0.872_664_63), f(-0.349_065_84))
  }
}

export class BabyHoglinModel extends HoglinModel {
  override animateHeadbutt(headbuttLerpFactor: number) {
    super.animateHeadbutt(headbuttLerpFactor)
    this.head.y = f(this.head.y + f(headbuttLerpFactor * 2.5))
  }
}

export class LlamaModel extends AnimModel {
  head = this.part('head')
  rightChest = this.part('right_chest')
  leftChest = this.part('left_chest')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { cos } = this.c
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    const animationSpeed = state.walkAnimationSpeed as number
    const animationPos = state.walkAnimationPos as number
    this.rightHindLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
    this.leftHindLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
    this.rightFrontLeg.xRot = f(f(cos(f(f(animationPos * f(0.6662)) + PI)) * f(1.4)) * animationSpeed)
    this.leftFrontLeg.xRot = f(f(cos(f(animationPos * f(0.6662))) * f(1.4)) * animationSpeed)
    this.rightChest.visible = state.hasChest
    this.leftChest.visible = state.hasChest
  }
}

export class RavagerModel extends AnimModel {
  neck = this.part('neck')
  head = this.part('neck/head')
  mouth = this.part('neck/head/mouth')
  rightHindLeg = this.part('right_hind_leg')
  leftHindLeg = this.part('left_hind_leg')
  rightFrontLeg = this.part('right_front_leg')
  leftFrontLeg = this.part('left_front_leg')

  override setupAnim(state: AnimState) {
    super.setupAnim(state)
    const { sin, cos } = this.c
    const stunnedTick = state.stunnedTicksRemaining as number
    const attackTick = state.attackTicksRemaining as number
    if (attackTick > 0) {
      const headAnim = triangleWave(attackTick, 10)
      const scaled = f(f(1 + headAnim) * 0.5)
      const headPos = f(f(f(scaled * scaled) * scaled) * 12)
      const yOffset = f(headPos * sin(this.neck.xRot))
      this.neck.z = f(f(-6.5) + headPos)
      this.neck.y = f(-7 - yOffset)
      if (attackTick > 5) {
        this.mouth.xRot = f(f(sin(f(f(-4 + attackTick) / 4)) * PI) * f(0.4))
      } else {
        this.mouth.xRot = f(f(0.157_079_64) * sin(f(f(PI * attackTick) / 10)))
      }
    } else {
      const yOffset = f(-1 * sin(this.neck.xRot))
      this.neck.x = 0
      this.neck.y = f(-7 - yOffset)
      this.neck.z = 5.5
      const isStunned = stunnedTick > 0
      this.neck.xRot = isStunned ? f(0.219_911_49) : 0
      this.mouth.xRot = f(PI * (isStunned ? f(0.05) : f(0.01)))
      if (isStunned) {
        // java.lang.Math.sin in double
        const speed = stunnedTick / 40
        this.neck.x = f(f(Math.sin(speed * 10)) * 3)
      } else if (state.roarAnimation > 0) {
        const mouthAnim = sin(f(f(state.roarAnimation * PI) * 0.25))
        this.mouth.xRot = f(HALF_PI * mouthAnim)
      }
    }
    this.head.xRot = f(state.xRot * DEG_TO_RAD)
    this.head.yRot = f(state.yRot * DEG_TO_RAD)
    const animationPos = state.walkAnimationPos as number
    const legRot = f(f(0.4) * state.walkAnimationSpeed)
    this.rightHindLeg.xRot = f(cos(f(animationPos * f(0.6662))) * legRot)
    this.leftHindLeg.xRot = f(cos(f(f(animationPos * f(0.6662)) + PI)) * legRot)
    this.rightFrontLeg.xRot = f(cos(f(f(animationPos * f(0.6662)) + PI)) * legRot)
    this.leftFrontLeg.xRot = f(cos(f(animationPos * f(0.6662))) * legRot)
  }
}

export const QUADRUPEDS_MODELS: Record<string, AnimModelClass> = {
  CowModel,
  BabyCowModel: CowModel,
  ColdCowModel: CowModel,
  WarmCowModel: CowModel,
  PigModel,
  BabyPigModel: PigModel,
  ColdPigModel: PigModel,
  SheepModel,
  SheepFurModel,
  BabySheepModel: SheepModel,
  PolarBearModel,
  BabyPolarBearModel: PolarBearModel,
  PandaModel,
  BabyPandaModel,
  GoatModel,
  BabyGoatModel,
  HoglinModel,
  BabyHoglinModel,
  AdultTurtleModel,
  BabyTurtleModel,
  // 1.21.x name (abstract in 26.1+, never sampled there)
  TurtleModel: LegacyTurtleModel,
  LlamaModel,
  BabyLlamaModel: LlamaModel,
  LlamaSpitModel: AnimModel,
  RavagerModel
}
