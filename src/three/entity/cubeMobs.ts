import { f, lerp } from './setupAnim/mth'
import type { EntityAnimInput, EntityAnimTracker } from './entityAnimState'
import { versionToNumber } from '../../lib/utils'

/** Slimes and magma cubes (1.8's LavaSlime): drawn by SlimeRenderer / MagmaCubeRenderer, which scale them by size and squish. */
export const CUBE_MOBS = new Set(['slime', 'magma_cube', 'lava_slime'])

/**
 * The renderer's scale (SlimeRenderer.scale, RenderSlime.preRenderCallback, the same in every version): squish over
 * (size / 2 + 1) makes h, i = 1 / (h + 1), then scale (i * size, size / i, i * size) about the feet. The exports are of a
 * size 1 cube at rest, so this is the scale on top of them.
 */
export function cubeMobScale(size: number, squish: number): [number, number, number] {
  const h = f(squish / f(size * 0.5 + 1))
  const i = f(1 / f(h + 1))
  return [f(i * size), f(f(1 / i) * size), f(i * size)]
}

/** The synched size: by its name (the export's data names, then minecraft-data's keys), before 1.14 by its index (1.8: 16, 1.9: 11, then 12). */
export function cubeMobSize(input: Pick<EntityAnimInput, 'version' | 'data' | 'meta'>, dataNames: Record<string, string>): number {
  let value: unknown
  if (versionToNumber(input.version) < versionToNumber('1.14')) {
    const index = versionToNumber(input.version) >= versionToNumber('1.10') ? 12 : versionToNumber(input.version) >= versionToNumber('1.9') ? 11 : 16
    value = input.data[index]
  } else {
    const index = Object.entries(dataNames).find(([, name]) => name === 'size' || name === 'id_size')?.[0]
    value = index === undefined ? undefined : input.data[Number(index)]
    value ??= input.meta.size
  }
  const size = typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 1
  return size > 0 ? size : 1
}

/** The squish of the frame: 26.3's render state interpolates it, earlier ticks keep oSquish equal to squish. */
export function cubeMobSquish(tracker: EntityAnimTracker, exportVersion: string): number {
  const memory = tracker.memory as { squish?: number; oSquish?: number }
  if (versionToNumber(exportVersion) >= versionToNumber('1.21.2')) return lerp(tracker.partialTick, memory.oSquish ?? 0, memory.squish ?? 0)
  return memory.squish ?? 0
}
