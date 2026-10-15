import type { AnimModelClass } from './types'
import { HUMANOID_MODELS } from './models/humanoid'
import { QUADRUPEDS_MODELS } from './models/quadrupeds'
import { EQUINES_MODELS } from './models/equines'
import { SMALL_MODELS } from './models/small'
import { AQUATIC_MODELS } from './models/aquatic'
import { MONSTERS_MODELS } from './models/monsters'
import { MISC_MODELS } from './models/misc'
import { ENTITY_ERA_MODELS } from './entityEra'
import { LEGACY_MODELS } from './legacy'
import { versionNumber } from './types'

/**
 * The ported setupAnim of every model class, by the class name the export records for each drawn model (modelClass):
 * the game's own class names (26.3's, and those of older versions where they differ).
 */
export const ANIM_MODELS: Record<string, AnimModelClass> = {
  ...HUMANOID_MODELS,
  ...QUADRUPEDS_MODELS,
  ...EQUINES_MODELS,
  ...SMALL_MODELS,
  ...AQUATIC_MODELS,
  ...MONSTERS_MODELS,
  ...MISC_MODELS
}

/** The model classes of the export a version draws: render state models (1.21.2+), entity models, legacy Yarn models. */
export const animModelsFor = (exportVersion: string): Record<string, AnimModelClass> => {
  const number = versionNumber(exportVersion)
  if (number >= versionNumber('1.21.2')) return ANIM_MODELS
  if (number >= versionNumber('1.14.4')) return ENTITY_ERA_MODELS
  return LEGACY_MODELS
}

export { AnimModel, animContext, type AnimContext, type AnimState, type AnimModelClass } from './types'
export { ModelPose, PartPose } from './modelPose'

/** The state's numbers as the floats the game's fields hold (a state built from doubles). */
export const floatState = <T extends Record<string, unknown>>(state: T): T => {
  for (const key of Object.keys(state)) if (typeof state[key] === 'number') (state as Record<string, unknown>)[key] = Math.fround(state[key] as number)
  return state
}
