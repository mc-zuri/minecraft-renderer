import { versionToNumber } from '../../lib/utils'

/**
 * Item-like entities (ThrownItemRenderer; the fireballs draw their fire charge 3 and 0.75 times as big) under every name
 * minecraft-data has given them (1.8's ThrownEgg to 1.21.5's splash_potion), with the items they are drawn as under the
 * names items have had: what versions the exports have no item entity for draw.
 */
export const THROWN_ITEMS: Array<{ names: string[]; items: string[]; scale: number }> = [
  { names: ['snowball'], items: ['snowball'], scale: 1 },
  { names: ['egg', 'thrown_egg'], items: ['egg'], scale: 1 },
  { names: ['ender_pearl', 'thrown_enderpearl'], items: ['ender_pearl'], scale: 1 },
  { names: ['eye_of_ender', 'eye_of_ender_signal', 'eye_of ender'], items: ['ender_eye'], scale: 1 },
  { names: ['potion', 'thrown_potion', 'splash_potion'], items: ['splash_potion', 'potion'], scale: 1 },
  { names: ['lingering_potion'], items: ['lingering_potion'], scale: 1 },
  { names: ['experience_bottle', 'xp_bottle', 'thrown_exp_bottle', 'thrown_exp bottle'], items: ['experience_bottle'], scale: 1 },
  { names: ['firework_rocket', 'fireworks_rocket', 'fireworks_rocket_entity'], items: ['firework_rocket', 'fireworks'], scale: 1 },
  { names: ['fireball'], items: ['fire_charge'], scale: 3 },
  { names: ['small_fireball', 'firecharge'], items: ['fire_charge'], scale: 0.75 }
]

/** The item an item-like entity of that name is drawn as, as the version names it, and the renderer's scale. */
export function thrownItemOf(name: string, itemsByName: Record<string, unknown> | undefined): { item: string; scale: number } | undefined {
  const thrown = THROWN_ITEMS.find(entry => entry.names.includes(name))
  const item = thrown?.items.find(item => !itemsByName || itemsByName[item])
  return thrown && item ? { item, scale: thrown.scale } : undefined
}

/** Entities drawn as a block, under every name minecraft-data has given them (1.8's PrimedTnt and FallingSand, 1.13's activated_tnt and falling_objects). */
export const BLOCK_ENTITIES: Record<string, 'tnt' | 'falling_block' | undefined> = {
  tnt: 'tnt',
  primed_tnt: 'tnt',
  activated_tnt: 'tnt',
  falling_block: 'falling_block',
  falling_sand: 'falling_block',
  falling_objects: 'falling_block'
}

/** A falling block's state from its spawn data: the block state id from 1.13, the block id and data (id | data << 12) before; air draws nothing. */
export function fallingBlockState(objectData: unknown, version: string): { blockState: number } | undefined {
  if (typeof objectData !== 'number' || objectData <= 0) return undefined
  if (versionToNumber(version) >= versionToNumber('1.13')) return { blockState: objectData }
  return { blockState: ((objectData & 0xfff) << 4) | ((objectData >> 12) & 0xf) }
}
