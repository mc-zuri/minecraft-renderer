/**
 * Minecraft Data Shim
 *
 * Provides a minimal minecraft-data implementation that only loads
 * the versions specified in globalThis.includedVersions.
 */

const VERSION = '1.16.5'

// Lazy-loaded data for each data type
const createLazyData = (version: string) => ({
  get attributes() {
    return require('minecraft-data/minecraft-data/data/pc/1.16/attributes.json')
  },
  get blocks() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/blocks.json')
  },
  get blockCollisionShapes() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.1/blockCollisionShapes.json')
  },
  get biomes() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/biomes.json')
  },
  get effects() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.1/effects.json')
  },
  get items() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/items.json')
  },
  get enchantments() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.4/enchantments.json')
  },
  get recipes() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/recipes.json')
  },
  get instruments() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.1/instruments.json')
  },
  get materials() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/materials.json')
  },
  get language() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.1/language.json')
  },
  get entities() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/entities.json')
  },
  get protocol() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/protocol.json')
  },
  get windows() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.1/windows.json')
  },
  get version() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.5/version.json')
  },
  get foods() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.1/foods.json')
  },
  get particles() {
    return require('minecraft-data/minecraft-data/data/pc/1.16/particles.json')
  },
  get blockLoot() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/blockLoot.json')
  },
  get entityLoot() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/entityLoot.json')
  },
  get loginPacket() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/loginPacket.json')
  },
  get tints() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.2/tints.json')
  },
  get mapIcons() {
    return require('minecraft-data/minecraft-data/data/pc/1.16/mapIcons.json')
  },
  get sounds() {
    return require('minecraft-data/minecraft-data/data/pc/1.16/sounds.json')
  }
})

/** 1.21.4, for the playground's scenes of things newer than 1.16 (PLAYGROUND_VERSION=1.21.4) */
const createLazyData1214 = () => ({
  get attributes() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.3/attributes.json')
  },
  get blocks() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/blocks.json')
  },
  get blockCollisionShapes() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/blockCollisionShapes.json')
  },
  get biomes() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/biomes.json')
  },
  get effects() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/effects.json')
  },
  get items() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/items.json')
  },
  get enchantments() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.1/enchantments.json')
  },
  get recipes() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/recipes.json')
  },
  get instruments() {
    return require('minecraft-data/minecraft-data/data/pc/1.20.5/instruments.json')
  },
  get materials() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/materials.json')
  },
  get language() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/language.json')
  },
  get entities() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/entities.json')
  },
  get protocol() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/protocol.json')
  },
  get windows() {
    return require('minecraft-data/minecraft-data/data/pc/1.16.1/windows.json')
  },
  get version() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/version.json')
  },
  get foods() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.1/foods.json')
  },
  get particles() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/particles.json')
  },
  get blockLoot() {
    return require('minecraft-data/minecraft-data/data/pc/1.20/blockLoot.json')
  },
  get entityLoot() {
    return require('minecraft-data/minecraft-data/data/pc/1.20/entityLoot.json')
  },
  get loginPacket() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.3/loginPacket.json')
  },
  get tints() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/tints.json')
  },
  get mapIcons() {
    return require('minecraft-data/minecraft-data/data/pc/1.20.2/mapIcons.json')
  },
  get sounds() {
    return require('minecraft-data/minecraft-data/data/pc/1.21.4/sounds.json')
  },
})

module.exports = {
  pc: {
    [VERSION]: createLazyData(VERSION),
    '1.21.4': createLazyData1214()
  }
}
