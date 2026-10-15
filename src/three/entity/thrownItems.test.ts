import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { BLOCK_ENTITIES, THROWN_ITEMS, exportedItemEntity, fallingBlockState, thrownItemOf } from './thrownItems'
import { entityModelName, entityModelsVersions, loadEntityModels, resolveExportedEntityName, setEntityModelsSource } from './exportedEntityModels'

vi.mock('../threeJsUtils', () => ({ loadThreeJsTextureFromUrlSync: () => ({ promise: new Promise(() => {}) }) }))

const require = createRequire(import.meta.url)
const mcAssetsDist = path.dirname(require.resolve('mc-assets/dist/entityModels.json'))
setEntityModelsSource({ load: async exportVersion => JSON.parse(fs.readFileSync(path.join(mcAssetsDist, 'entityModels', `${exportVersion}.json`), 'utf8')) })
beforeAll(async () => {
  for (const version of entityModelsVersions()) await loadEntityModels(version)
})
const versionNumber = (version: string) => {
  const [x, y = '0', z = '0'] = version.split('.')
  return +`${x.padStart(2, '0')}${y.padStart(2, '0')}${z.padStart(2, '0')}`
}
const playedVersions = (): string[] => require('minecraft-data').supportedVersions.pc.filter((version: string) => /^\d+\.\d+(\.\d+)?$/.test(version) && versionNumber(version) >= versionNumber('1.8'))
const thrownNames = new Set(THROWN_ITEMS.flatMap(entry => entry.names))

describe('item-like entities', () => {
  test.each(playedVersions())('%s: every item-like entity minecraft-data names is drawn as an item of the version', version => {
    const data = require('minecraft-data')(version)
    const missing: string[] = []
    let found = 0
    for (const { name } of data.entitiesArray as Array<{ name: string }>) {
      const modelName = entityModelName(name)
      if (!thrownNames.has(modelName)) continue
      found++
      const thrown = thrownItemOf(modelName, data.itemsByName)
      if (!thrown) missing.push(name)
    }
    expect(missing).toEqual([])
    // snowball, egg, ender pearl, eye of ender, potion, bottle o' enchanting, firework, fireballs
    expect(found).toBeGreaterThanOrEqual(7)
  })

  test("1.8's names and items: ThrownEgg an egg, FireworksRocketEntity the fireworks item, a fireball 3 times a fire charge", () => {
    const items = require('minecraft-data')('1.8.8').itemsByName
    expect(thrownItemOf(entityModelName('ThrownEgg'), items)).toEqual({ item: 'egg', scale: 1, lift: 0.125 })
    expect(thrownItemOf(entityModelName('FireworksRocketEntity'), items)).toEqual({ item: 'fireworks', scale: 1, lift: 0.125 })
    expect(thrownItemOf(entityModelName('Fireball'), items)).toEqual({ item: 'fire_charge', scale: 3, lift: 0.375 })
    expect(thrownItemOf(entityModelName('ThrownPotion'), items)).toEqual({ item: 'potion', scale: 1, lift: 0.125 })
  })
})

describe('block entities', () => {
  test("TNT and falling blocks under every version's name", () => {
    expect(['PrimedTnt', 'activated_tnt', 'tnt'].map(name => BLOCK_ENTITIES[entityModelName(name)])).toEqual(['tnt', 'tnt', 'tnt'])
    expect(['FallingSand', 'falling_objects', 'falling_block'].map(name => BLOCK_ENTITIES[entityModelName(name)])).toEqual(['falling_block', 'falling_block', 'falling_block'])
  })

  test("a falling block's state: the state id from 1.13, the block id and data before, nothing for air", () => {
    // sand (12), red sand (data 1): 12 | 1 << 12
    expect(fallingBlockState(12 | (1 << 12), '1.12.2')).toEqual({ blockState: (12 << 4) | 1 })
    expect(fallingBlockState(66, '1.20.4')).toEqual({ blockState: 66 })
    expect(fallingBlockState(0, '1.20.4')).toBeUndefined()
  })
})

describe('exported item entities', () => {
  test.each(entityModelsVersions())("%s: the renderer's scale, the ground display transform taken out (the export's pose goes into it from 1.21.9)", version => {
    const expected: Record<string, number> = { snowball: 1, fireball: 3, small_fireball: 0.75, eye_of_ender: 1 }
    for (const [name, scale] of Object.entries(expected)) {
      const exported = exportedItemEntity(version, resolveExportedEntityName(version, name))
      if (!exported) continue
      expect(exported.scale, `${version} ${name}`).toBeCloseTo(scale, 5)
    }
  })
})
