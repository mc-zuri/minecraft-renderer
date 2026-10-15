import type { AnimModelClass } from '../types'

/**
 * Models of 1.14.4 to 1.21.1 (before render states): prepareMobModel and setupAnim of the model classes (Mojang names),
 * posed from the entity: their state is named walkAnimationPos, walkAnimationSpeed, ageInTicks, yRot, xRot, partialTick,
 * model.<field> (attackTime, riding, young, crouching, arm poses...), data.<index> (synched data), entity.<field> (what
 * the entity's client ticking keeps) and item.mainhand / item.offhand.
 */
export const ENTITY_ERA_MODELS: Record<string, AnimModelClass> = {}
