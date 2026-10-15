import type { EntityAnimation } from 'mc-assets/dist/entityModels'
import type { ModelPose, PartPose } from './modelPose'
import { doubleSinCos, floatSinCos, makeEase, type SinCos } from './mth'

/**
 * What a model's setupAnim reads: the game's render state, by its field names (26.3's EntityRenderState and subclasses:
 * walkAnimationPos, walkAnimationSpeed, ageInTicks, yRot and xRot in degrees, isBaby, swingAnimation, isAggressive...).
 * Enums are their constant names, animation states the tick they started at (null when stopped), records objects.
 * Older versions' inputs are given the same names.
 */
export type AnimState = Record<string, any>

export type AnimContext = SinCos & {
  version: string
  ease: ReturnType<typeof makeEase>
  /** is the version at least this one (1.21.11, 26.3...) */
  atLeast: (version: string) => boolean
  /** a keyframe animation of the version's export, by its definition name (WardenAnimation.WARDEN_ATTACK) */
  animation: (name: string) => EntityAnimation | undefined
}

/**
 * A model class's animation code, ported class by class like the game's (overrides and all): made once per model drawn,
 * then setupAnim poses its parts from a state, from their initial pose.
 */
export class AnimModel {
  constructor(
    readonly model: ModelPose,
    readonly c: AnimContext
  ) {}

  /** Model.setupAnim: back to the initial pose (26.3 resets in Model.setupAnim; older versions set every part they move). */
  setupAnim(_state: AnimState) {
    this.model.resetPose()
  }

  part(name: string) {
    return this.model.part(name)
  }
}

export type AnimModelClass = new (model: ModelPose, context: AnimContext) => AnimModel

export type { ModelPose, PartPose }

export const versionNumber = (version: string) => {
  const [x = '0', y = '0', z = '0'] = version.split('.')
  return Number(x) * 1_000_000 + Number(y) * 1000 + Number(z)
}

/** The context models of a version run in: its sin table, its ease functions, its keyframe animations. */
export function animContext(version: string, animation: AnimContext['animation'] = () => undefined): AnimContext {
  const number = versionNumber(version)
  const sinCos = number >= versionNumber('1.21.11') ? doubleSinCos : floatSinCos
  return { ...sinCos, version, ease: makeEase(sinCos), atLeast: other => number >= versionNumber(other), animation }
}
