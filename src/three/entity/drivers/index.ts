import { registerEntityDrivers, registerEntityEraAdapters, type EntityDriver } from '../entityAnimState'
import { ENTITY_ERA_MOBS_ADAPTERS } from './entityEra/mobs'
import { ENTITY_ERA_ANIMALS_ADAPTERS } from './entityEra/animals'
import { HUMANOID_DRIVERS } from './humanoid'
import { QUADRUPEDS_DRIVERS } from './quadrupeds'
import { EQUINES_DRIVERS } from './equines'
import { SMALL_DRIVERS } from './small'
import { AQUATIC_DRIVERS } from './aquatic'
import { MONSTERS_DRIVERS } from './monsters'
import { MISC_DRIVERS } from './misc'
import { BOATS_DRIVERS } from './boats'

/** Every entity's driver: its client ticking, entity events and renderer's render state fields (see entityAnimState). */
export const DRIVERS: Record<string, EntityDriver> = {
  ...HUMANOID_DRIVERS,
  ...QUADRUPEDS_DRIVERS,
  ...EQUINES_DRIVERS,
  ...SMALL_DRIVERS,
  ...AQUATIC_DRIVERS,
  ...MONSTERS_DRIVERS,
  ...MISC_DRIVERS,
  ...BOATS_DRIVERS
}

registerEntityDrivers(DRIVERS)
registerEntityEraAdapters({ ...ENTITY_ERA_MOBS_ADAPTERS, ...ENTITY_ERA_ANIMALS_ADAPTERS })
