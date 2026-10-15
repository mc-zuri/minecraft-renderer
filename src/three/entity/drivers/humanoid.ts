import type { EntityAnimInput, EntityAnimTracker, EntityDriver } from '../entityAnimState'
import type { AnimState } from '../setupAnim/types'
import { f } from '../setupAnim/mth'
import { handArm, type KineticWeaponData } from '../setupAnim/models/humanoid'

/**
 * Zombies, skeletons, piglins and armor stands (26.3): their renderers' extractRenderState (HumanoidMobRenderer's arm
 * poses, AbstractZombieRenderer, DrownedRenderer, GiantMobRenderer, ZombieVillagerRenderer, AbstractSkeletonRenderer,
 * BoggedRenderer, PiglinRenderer, ZombifiedPiglinRenderer, ArmorStandRenderer) and the client side code feeding them
 * (Drowned's swimming, ArmorStand's hit wiggle).
 */

const bit = (value: unknown, mask: number) => typeof value === 'number' && (value & mask) !== 0
const sharedFlags = (input: EntityAnimInput) => input.meta.shared_flags ?? input.meta.entity_flags
const mobFlags = (input: EntityAnimInput) => input.meta.mob_flags ?? input.meta.insentient
/** Mob.isNoAi: mob flag 1 */
const isNoAi = (input: EntityAnimInput) => bit(mobFlags(input), 1)
/** Mob.isAggressive: mob flag 4 */
const isAggressive = (input: EntityAnimInput) => bit(mobFlags(input), 4)
const isTrue = (value: unknown) => value === true || value === 1

/** An item name without its namespace. */
const itemName = (value: unknown) => (typeof value === 'string' ? value.replace(/^minecraft:/, '') : undefined)
const mainHand = (input: EntityAnimInput) => itemName(input.equipment?.mainhand)
const offHand = (input: EntityAnimInput) => itemName(input.equipment?.offhand)
/** LivingEntity.getItemHeldByArm */
const heldByArm = (input: EntityAnimInput, state: AnimState, arm: string) => (arm === state.mainArm ? mainHand(input) : offHand(input))

const MATERIALS = ['wooden', 'copper', 'stone', 'golden', 'iron', 'diamond', 'netherite']

/** ItemTags.SPEARS */
const SPEARS = new Set(MATERIALS.map(material => `${material}_spear`))

/**
 * Items with the tool component (26.3): the tiered tools and swords (ToolMaterial.applyToolProperties /
 * applySwordProperties), shears, mace, trident.
 */
const TOOLS = new Set([...MATERIALS.flatMap(material => ['sword', 'shovel', 'pickaxe', 'axe', 'hoe'].map(tool => `${material}_${tool}`)), 'shears', 'mace', 'trident'])

/** ItemTags.PIGLIN_LOVED (26.3), gold_ores included. */
const PIGLIN_LOVED = new Set([
  'gold_ore',
  'nether_gold_ore',
  'deepslate_gold_ore',
  'gold_block',
  'gilded_blackstone',
  'light_weighted_pressure_plate',
  'gold_ingot',
  'bell',
  'clock',
  'golden_carrot',
  'glistering_melon_slice',
  'golden_apple',
  'enchanted_golden_apple',
  'golden_helmet',
  'golden_chestplate',
  'golden_leggings',
  'golden_boots',
  'golden_horse_armor',
  'golden_nautilus_armor',
  'golden_sword',
  'golden_spear',
  'golden_pickaxe',
  'golden_shovel',
  'golden_axe',
  'golden_hoe',
  'raw_gold',
  'raw_gold_block',
  'golden_dandelion'
])

/**
 * The kinetic_weapon component of the spears (Items: Item.Properties.spear(material, attackDuration, damageMultiplier,
 * delay, dismountTime, dismountThreshold, knockbackTime, knockbackThreshold, damageTime, damageThreshold)): the
 * durations are (int) (seconds * 20.0F).
 */
const ticks = (seconds: number) => Math.trunc(f(f(seconds) * 20))
const spear = (delay: number, dismountTime: number, knockbackTime: number, damageTime: number): KineticWeaponData => ({
  delayTicks: ticks(delay),
  dismountMaxDurationTicks: ticks(dismountTime),
  knockbackMaxDurationTicks: ticks(knockbackTime),
  damageMaxDurationTicks: ticks(damageTime)
})
export const SPEAR_KINETIC_WEAPONS: Record<string, KineticWeaponData> = {
  wooden_spear: spear(0.75, 5, 10, 15),
  stone_spear: spear(0.7, 4.5, 9, 13.75),
  copper_spear: spear(0.65, 4, 8.25, 12.5),
  iron_spear: spear(0.6, 2.5, 6.75, 11.25),
  golden_spear: spear(0.7, 3.5, 8.5, 13.75),
  diamond_spear: spear(0.5, 3, 6.5, 10),
  netherite_spear: spear(0.4, 2.5, 5.5, 8.75)
}

/**
 * CrossbowItem.getChargeDuration(entity.getUseItem(), entity): floor(max(0, 1.25 + Quick Charge's -0.25 per level) * 20)
 * of the crossbow in use (25 when no crossbow is in use). The enchantment level is not in EntityAnimInput: read from
 * `quickChargeLevel` (the Quick Charge level of the item in use) when the scene gives it.
 */
const crossbowChargeDuration = (input: EntityAnimInput, state: AnimState) => {
  let duration = f(1.25)
  const useItem = state.isUsingItem ? (state.useItemHand === 'OFF_HAND' ? offHand(input) : mainHand(input)) : undefined
  const level = (input as any).quickChargeLevel
  if (useItem === 'crossbow' && typeof level === 'number' && level > 0) {
    // AddValue(LevelBasedValue.perLevel(-0.25F)): value + (base + perLevelAboveFirst * (level - 1))
    duration = f(duration + f(f(-0.25) + f(f(-0.25) * (level - 1))))
  }
  return Math.floor(f(Math.max(0, duration) * 20))
}

/** HumanoidMobRenderer.usesSpearPose */
const usesSpearPose = (item: string | undefined, arm: string, state: AnimState) => {
  const swing = state.currentSwing as { hand: string; animation: { type: string } } | null
  return (!!swing && handArm(swing.hand, state.mainArm) === arm && swing.animation.type === 'STAB') || (item !== undefined && SPEARS.has(item))
}

type ArmPose = (state: AnimState, input: EntityAnimInput, arm: string) => string

/** HumanoidMobRenderer.getArmPose */
const spearArmPose: ArmPose = (state, input, arm) => (usesSpearPose(heldByArm(input, state, arm), arm, state) ? 'SPEAR' : 'EMPTY')

/**
 * What every humanoid renderer here fills beyond the framework: the arm poses (its getArmPose), the kinetic weapons of
 * the items in hand (the spear pose reads getUseItemStackForArm's: UndeadRenderState gives the main hand item for both
 * arms) and the crossbow charge duration.
 */
const humanoidMob = (state: AnimState, input: EntityAnimInput, armPose: ArmPose | undefined, undead: boolean) => {
  state.mainHandKineticWeapon = SPEAR_KINETIC_WEAPONS[mainHand(input) ?? '']
  state.offHandKineticWeapon = undead ? state.mainHandKineticWeapon : SPEAR_KINETIC_WEAPONS[offHand(input) ?? '']
  state.maxCrossbowChargeDuration = crossbowChargeDuration(input, state)
  if (armPose) {
    state.leftArmPose = armPose(state, input, 'LEFT')
    state.rightArmPose = armPose(state, input, 'RIGHT')
  }
}

// --- zombies

/** AbstractZombieRenderer: isAggressive, isConverting (Zombie.isUnderWaterConverting: the drowned conversion data). */
const abstractZombie = (state: AnimState, input: EntityAnimInput, armPose: ArmPose) => {
  humanoidMob(state, input, armPose, true)
  state.isAggressive = isAggressive(input)
  state.isConverting = isTrue(input.meta.drowned_conversion)
}

const zombie: EntityDriver = {
  state: (state, _tracker, input) => abstractZombie(state, input, spearArmPose)
}

/** DrownedRenderer.getArmPose: an aggressive drowned raises the trident in its main hand to throw it. */
const drownedArmPose: ArmPose = (state, input, arm) =>
  state.mainArm === arm && isAggressive(input) && heldByArm(input, state, arm) === 'trident' ? 'THROW_TRIDENT' : spearArmPose(state, input, arm)

/** Drowned.isVisuallySwimming: isSwimming (shared flag 0x10) && !isPassenger (a mob's pose stays STANDING). */
const drownedVisuallySwimming = (input: EntityAnimInput) => bit(sharedFlags(input), 0x10) && !input.isPassenger

const drowned: EntityDriver = {
  tick: (tracker: EntityAnimTracker, input) => {
    // LivingEntity.updateSwimAmount with Drowned.isVisuallySwimming (the common tick went by the pose)
    tracker.swimAmount = drownedVisuallySwimming(input) ? Math.min(1, f(tracker.swimAmountO + f(0.09))) : Math.max(0, f(tracker.swimAmountO - f(0.09)))
  },
  state: (state, _tracker, input) => {
    state.isVisuallySwimming = drownedVisuallySwimming(input)
    abstractZombie(state, input, drownedArmPose)
  }
}

/**
 * GiantMobRenderer: a MobRenderer (the arm poses stay EMPTY) extracting the humanoid state; isAggressive and
 * isConverting keep ZombieRenderState's defaults.
 */
const giant: EntityDriver = {
  state: (state, _tracker, input) => {
    humanoidMob(state, input, undefined, true)
    state.isAggressive = false
    state.isConverting = false
  }
}

const VILLAGER_TYPES = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga']
const VILLAGER_PROFESSIONS = ['none', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith']

const registryName = (value: unknown, names: string[]) => (typeof value === 'number' ? names[value] : typeof value === 'string' ? value.replace(/^minecraft:/, '') : undefined)

/** VillagerData from the villager_data synched data (registry ids in VillagerType / VillagerProfession bootstrap order). */
export const villagerData = (value: unknown) => {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  return {
    type: registryName(data.villagerType ?? data.type, VILLAGER_TYPES) ?? 'plains',
    profession: registryName(data.villagerProfession ?? data.profession, VILLAGER_PROFESSIONS) ?? 'none',
    level: typeof data.level === 'number' ? data.level : 1
  }
}

/** ZombieVillagerRenderer (a HumanoidMobRenderer): isConverting (its own converting data), villagerData, isAggressive. */
const zombieVillager: EntityDriver = {
  state: (state, _tracker, input) => {
    humanoidMob(state, input, spearArmPose, true)
    state.isConverting = isTrue(input.meta.converting)
    state.villagerData = villagerData(input.meta.villager_data)
    state.isAggressive = isAggressive(input)
  }
}

/** ZombifiedPiglinRenderer: isAggressive. */
const zombifiedPiglin: EntityDriver = {
  state: (state, _tracker, input) => {
    humanoidMob(state, input, spearArmPose, true)
    state.isAggressive = isAggressive(input)
  }
}

// --- skeletons

/** AbstractSkeletonRenderer.getArmPose: an aggressive skeleton draws the bow in its main hand. */
const skeletonArmPose: ArmPose = (state, input, arm) =>
  state.mainArm === arm && isAggressive(input) && mainHand(input) === 'bow' ? 'BOW_AND_ARROW' : spearArmPose(state, input, arm)

/**
 * AbstractSkeletonRenderer: isAggressive, isShaking (AbstractSkeleton.isShaking: fully frozen; Skeleton's: its stray
 * conversion data), isHoldingBow.
 */
const abstractSkeleton = (isShaking: (state: AnimState, input: EntityAnimInput) => boolean, extra?: (state: AnimState, input: EntityAnimInput) => void): EntityDriver => ({
  state: (state, _tracker, input) => {
    humanoidMob(state, input, skeletonArmPose, false)
    state.isAggressive = isAggressive(input)
    state.isShaking = isShaking(state, input)
    state.isHoldingBow = mainHand(input) === 'bow'
    extra?.(state, input)
  }
})

const frozen = (state: AnimState) => !!state.isFullyFrozen

// --- piglins

/**
 * AbstractPiglin.isConverting: !isImmuneToZombification && !isNoAi && the piglins_zombify environment attribute at its
 * position (true by default, false in the nether). The attribute is not in EntityAnimInput: read from `piglinsZombify`,
 * else from `dimension` (the_nether: false, any other: true); without either, false (piglins live in the nether).
 */
const piglinsZombify = (input: EntityAnimInput) => {
  const value = (input as any).piglinsZombify
  if (typeof value === 'boolean') return value
  const dimension = (input as any).dimension
  if (typeof dimension === 'string') return dimension.replace(/^minecraft:/, '') !== 'the_nether'
  return false
}

const piglinConverting = (input: EntityAnimInput) => !isTrue(input.meta.immune_to_zombification) && !isNoAi(input) && piglinsZombify(input)

/** AbstractPiglin.isHoldingMeleeWeapon: the main hand item has the tool component. */
const holdingMeleeWeapon = (input: EntityAnimInput) => TOOLS.has(mainHand(input) ?? '')

/**
 * Piglin.getArmPose. Whether the crossbow is charged (CrossbowItem.isCharged of the main hand item: its
 * charged_projectiles component) is not in EntityAnimInput: read from `mainHandCharged` when the scene gives it.
 */
const piglinArmPose = (input: EntityAnimInput) => {
  if (isTrue(input.meta.is_dancing)) return 'DANCING'
  if (PIGLIN_LOVED.has(offHand(input) ?? '')) return 'ADMIRING_ITEM'
  if (isAggressive(input) && holdingMeleeWeapon(input)) return 'ATTACKING_WITH_MELEE_WEAPON'
  if (isTrue(input.meta.is_charging_crossbow)) return 'CROSSBOW_CHARGE'
  const holdingCrossbow = mainHand(input) === 'crossbow' || offHand(input) === 'crossbow'
  return holdingCrossbow && (input as any).mainHandCharged === true ? 'CROSSBOW_HOLD' : 'DEFAULT'
}

/** PiglinBrute.getArmPose */
const piglinBruteArmPose = (input: EntityAnimInput) => (isAggressive(input) && holdingMeleeWeapon(input) ? 'ATTACKING_WITH_MELEE_WEAPON' : 'DEFAULT')

/** PiglinRenderer: isBrute, armPose, maxCrossbowChageDuration (sic), isConverting. */
const piglinRenderer = (brute: boolean): EntityDriver => ({
  state: (state, _tracker, input) => {
    humanoidMob(state, input, spearArmPose, false)
    state.isBrute = brute
    state.armPose = brute ? piglinBruteArmPose(input) : piglinArmPose(input)
    state.maxCrossbowChageDuration = state.maxCrossbowChargeDuration
    state.isConverting = piglinConverting(input)
  }
})

// --- armor stand

type Rotations = { x: number; y: number; z: number }

/** new Rotations(x, y, z): each angle % 360, NaN and infinities 0. */
const rotations = (x: number, y: number, z: number): Rotations => {
  const angle = (value: number) => (Number.isFinite(value) ? f(f(value) % 360) : 0)
  return { x: angle(x), y: angle(y), z: angle(z) }
}

/** A Rotations synched data value: prismarine gives { pitch, yaw, roll } (x, y, z). */
const rotationsData = (value: unknown, fallback: Rotations): Rotations => {
  if (!value || typeof value !== 'object') return fallback
  const data = value as Record<string, unknown>
  const x = data.pitch ?? data.x
  const y = data.yaw ?? data.y
  const z = data.roll ?? data.z
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return fallback
  return rotations(x, y, z)
}

/** ArmorStand.DEFAULT_*_POSE */
export const ARMOR_STAND_DEFAULT_POSES = {
  headPose: rotations(0, 0, 0),
  bodyPose: rotations(0, 0, 0),
  leftArmPose: rotations(-10, 0, -10),
  rightArmPose: rotations(-15, 0, 10),
  leftLegPose: rotations(-1, 0, -1),
  rightLegPose: rotations(1, 0, 1)
}

/**
 * ArmorStandRenderer (a LivingEntityRenderer extracting the humanoid state): yRot, isMarker, isSmall, showArms,
 * showBasePlate, the six poses (they replace HumanoidRenderState's arm pose enums, see ArmorStandArmorModel), wiggle.
 * ArmorStand.isBaby is isSmall (so ageScale 0.5); its body follows its yRot (tickHeadTurn), the input's body yaw.
 */
const armorStand: EntityDriver = {
  event: (tracker, id) => {
    // ArmorStand.handleEntityEvent(32): hit, lastHit = the game time
    if (id === 32) tracker.memory.lastHit = tracker.tickCount
  },
  state: (state, tracker, input) => {
    const flags = input.meta.client_flags
    const small = bit(flags, 1)
    state.isBaby = small
    state.ageScale = small ? 0.5 : 1
    // Mth.rotLerp(partialTicks, yRotO, getYRot()): the stand's own yaw, which yBodyRot is
    state.yRot = state.bodyRot
    state.isMarker = bit(flags, 16)
    state.isSmall = small
    state.showArms = bit(flags, 4)
    state.showBasePlate = !bit(flags, 8)
    state.headPose = rotationsData(input.meta.head_pose, ARMOR_STAND_DEFAULT_POSES.headPose)
    state.bodyPose = rotationsData(input.meta.body_pose, ARMOR_STAND_DEFAULT_POSES.bodyPose)
    state.leftArmPose = rotationsData(input.meta.left_arm_pose, ARMOR_STAND_DEFAULT_POSES.leftArmPose)
    state.rightArmPose = rotationsData(input.meta.right_arm_pose, ARMOR_STAND_DEFAULT_POSES.rightArmPose)
    state.leftLegPose = rotationsData(input.meta.left_leg_pose, ARMOR_STAND_DEFAULT_POSES.leftLegPose)
    state.rightLegPose = rotationsData(input.meta.right_leg_pose, ARMOR_STAND_DEFAULT_POSES.rightLegPose)
    // (float) (gameTime - lastHit) + partialTicks; never hit: lastHit 0, the whole game time (no wiggle)
    const lastHit = tracker.memory.lastHit as number | undefined
    state.wiggle = lastHit === undefined ? Number.POSITIVE_INFINITY : f(f(tracker.tickCount - lastHit) + tracker.partialTick)
  }
}

export const HUMANOID_DRIVERS: Record<string, EntityDriver> = {
  zombie,
  husk: zombie,
  drowned,
  giant,
  zombie_villager: zombieVillager,
  zombified_piglin: zombifiedPiglin,
  skeleton: abstractSkeleton((_state, input) => isTrue(input.meta.stray_conversion)),
  stray: abstractSkeleton(frozen),
  bogged: abstractSkeleton(frozen, (state, input) => {
    // BoggedRenderer: isSheared
    state.isSheared = isTrue(input.meta.sheared)
  }),
  wither_skeleton: abstractSkeleton(frozen),
  parched: abstractSkeleton(frozen),
  piglin: piglinRenderer(false),
  piglin_brute: piglinRenderer(true),
  armor_stand: armorStand
}
