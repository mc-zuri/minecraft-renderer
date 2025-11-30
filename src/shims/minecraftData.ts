/**
 * Minecraft Data Shim
 *
 * Provides a minimal minecraft-data implementation that only loads
 * the versions specified in globalThis.includedVersions.
 */

const VERSION = (globalThis as any).includedVersions?.[0] ?? '1.20.4'

// Lazy-loaded data for each data type
const createLazyData = (version: string) => ({
  get attributes() { return require(`minecraft-data/minecraft-data/data/pc/${version}/attributes.json`) },
  get blocks() { return require(`minecraft-data/minecraft-data/data/pc/${version}/blocks.json`) },
  get blockCollisionShapes() { return require(`minecraft-data/minecraft-data/data/pc/${version}/blockCollisionShapes.json`) },
  get biomes() { return require(`minecraft-data/minecraft-data/data/pc/${version}/biomes.json`) },
  get effects() { return require(`minecraft-data/minecraft-data/data/pc/${version}/effects.json`) },
  get items() { return require(`minecraft-data/minecraft-data/data/pc/${version}/items.json`) },
  get enchantments() { return require(`minecraft-data/minecraft-data/data/pc/${version}/enchantments.json`) },
  get recipes() { return require(`minecraft-data/minecraft-data/data/pc/${version}/recipes.json`) },
  get instruments() { return require(`minecraft-data/minecraft-data/data/pc/${version}/instruments.json`) },
  get materials() { return require(`minecraft-data/minecraft-data/data/pc/${version}/materials.json`) },
  get language() { return require(`minecraft-data/minecraft-data/data/pc/${version}/language.json`) },
  get entities() { return require(`minecraft-data/minecraft-data/data/pc/${version}/entities.json`) },
  get protocol() { return require(`minecraft-data/minecraft-data/data/pc/${version}/protocol.json`) },
  get windows() { return require(`minecraft-data/minecraft-data/data/pc/${version}/windows.json`) },
  get version() { return require(`minecraft-data/minecraft-data/data/pc/${version}/version.json`) },
  get foods() { return require(`minecraft-data/minecraft-data/data/pc/${version}/foods.json`) },
  get particles() { return require(`minecraft-data/minecraft-data/data/pc/${version}/particles.json`) },
  get blockLoot() { return require(`minecraft-data/minecraft-data/data/pc/${version}/blockLoot.json`) },
  get entityLoot() { return require(`minecraft-data/minecraft-data/data/pc/${version}/entityLoot.json`) },
  get loginPacket() { return require(`minecraft-data/minecraft-data/data/pc/${version}/loginPacket.json`) },
  get tints() { return require(`minecraft-data/minecraft-data/data/pc/${version}/tints.json`) },
  get mapIcons() { return require(`minecraft-data/minecraft-data/data/pc/${version}/mapIcons.json`) },
  get sounds() { return require(`minecraft-data/minecraft-data/data/pc/${version}/sounds.json`) },
})

module.exports = {
  pc: {
    [VERSION]: createLazyData(VERSION),
  }
}
