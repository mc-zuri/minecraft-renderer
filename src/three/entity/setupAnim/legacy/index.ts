import type { AnimModelClass } from '../types'
import { LEGACY_SMALL_MODELS } from './small'
import { LEGACY_MISC_MODELS } from './misc'
import { LEGACY_QUADRUPEDS_MODELS } from './quadrupeds'
import { LEGACY_HUMANOID_MODELS } from './humanoid'

/**
 * Models of 1.8.9 to 1.13.2 (legacy Yarn names): animateModel and setAngles of the model classes, posed from the entity
 * like the entity era's models (state names: see ../entityEra).
 */
export const LEGACY_MODELS: Record<string, AnimModelClass> = {
  ...LEGACY_SMALL_MODELS,
  ...LEGACY_MISC_MODELS,
  ...LEGACY_QUADRUPEDS_MODELS,
  ...LEGACY_HUMANOID_MODELS
}
