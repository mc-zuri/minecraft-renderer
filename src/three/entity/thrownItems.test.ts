import { createRequire } from 'module'
import { describe, expect, test } from 'vitest'
import { THROWN_ITEMS, thrownItemOf } from './thrownItems'
import { entityModelName } from './exportedEntityModels'

const require = createRequire(import.meta.url)
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
    expect(thrownItemOf(entityModelName('ThrownEgg'), items)).toEqual({ item: 'egg', scale: 1 })
    expect(thrownItemOf(entityModelName('FireworksRocketEntity'), items)).toEqual({ item: 'fireworks', scale: 1 })
    expect(thrownItemOf(entityModelName('Fireball'), items)).toEqual({ item: 'fire_charge', scale: 3 })
    expect(thrownItemOf(entityModelName('ThrownPotion'), items)).toEqual({ item: 'potion', scale: 1 })
  })
})
