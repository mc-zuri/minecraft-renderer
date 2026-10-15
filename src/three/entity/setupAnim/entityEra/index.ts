import type { AnimModelClass } from '../types'
import { ENTITY_ERA_QUADRUPEDS_MODELS } from './quadrupeds'
import { ENTITY_ERA_EQUINES_MODELS } from './equines'
import { ENTITY_ERA_MONSTERS_MODELS } from './monsters'
import { ENTITY_ERA_HUMANOID_MODELS } from './humanoid'
import { ENTITY_ERA_AQUATIC_MODELS } from './aquatic'
import { ENTITY_ERA_SMALL_MODELS } from './small'
import { ENTITY_ERA_MISC_MODELS } from './misc'

/**
 * Models of 1.14.4 to 1.21.1 (before render states): prepareMobModel and setupAnim of the model classes (Mojang names),
 * posed from the entity: their state is named walkAnimationPos, walkAnimationSpeed, ageInTicks, yRot, xRot, partialTick,
 * model.<field> (attackTime, riding, young, crouching, arm poses...), data.<index> (synched data), entity.<field> (what
 * the entity's client ticking keeps) and item.mainhand / item.offhand.
 */
export const ENTITY_ERA_MODELS: Record<string, AnimModelClass> = {
  ...ENTITY_ERA_QUADRUPEDS_MODELS,
  ...ENTITY_ERA_EQUINES_MODELS,
  ...ENTITY_ERA_MONSTERS_MODELS,
  ...ENTITY_ERA_HUMANOID_MODELS,
  ...ENTITY_ERA_AQUATIC_MODELS,
  ...ENTITY_ERA_SMALL_MODELS,
  ...ENTITY_ERA_MISC_MODELS
}
