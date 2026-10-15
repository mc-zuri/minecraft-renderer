import { beforeAll, describe, expect, it } from 'vitest'
import { EntityAnimTracker, entityAnimState, registerEntityDrivers, type EntityAnimInput } from '../entityAnimState'
import { f } from '../setupAnim/mth'
import { ARMOR_STAND_DEFAULT_POSES, HUMANOID_DRIVERS, SPEAR_KINETIC_WEAPONS } from './humanoid'

beforeAll(() => {
  registerEntityDrivers(HUMANOID_DRIVERS)
})

const VERSION = '26.3'

const makeInput = (name: string, input: Partial<EntityAnimInput> = {}): EntityAnimInput => ({
  name,
  version: VERSION,
  meta: {},
  data: {},
  bodyYaw: 0,
  headYaw: 0,
  pitch: 0,
  position: { x: 0, y: 64, z: 0 },
  onGround: true,
  ...input
})

/** A tracker fed this input, ticked n times, and its state at a partial tick. */
const run = (input: EntityAnimInput, ticks = 1, partialTick = 0) => {
  const tracker = new EntityAnimTracker(input.name, input.version)
  tracker.setInput(input)
  for (let i = 0; i < ticks; i++) tracker.tick()
  tracker.walk.partialTick = partialTick
  return { tracker, state: entityAnimState(tracker, input) }
}

const stateOf = (name: string, input: Partial<EntityAnimInput> = {}) => run(makeInput(name, input)).state

const AGGRESSIVE = 4
const LEFT_HANDED = 2
const NO_AI = 1

describe('spear kinetic weapons', () => {
  it('converts the spears seconds to ticks like (int) (seconds * 20.0F)', () => {
    expect(SPEAR_KINETIC_WEAPONS.wooden_spear).toEqual({ delayTicks: 15, dismountMaxDurationTicks: 100, knockbackMaxDurationTicks: 200, damageMaxDurationTicks: 300 })
    expect(SPEAR_KINETIC_WEAPONS.iron_spear).toEqual({ delayTicks: 12, dismountMaxDurationTicks: 50, knockbackMaxDurationTicks: 135, damageMaxDurationTicks: 225 })
    expect(SPEAR_KINETIC_WEAPONS.copper_spear).toEqual({ delayTicks: 13, dismountMaxDurationTicks: 80, knockbackMaxDurationTicks: 165, damageMaxDurationTicks: 250 })
    expect(SPEAR_KINETIC_WEAPONS.netherite_spear).toEqual({ delayTicks: 8, dismountMaxDurationTicks: 50, knockbackMaxDurationTicks: 110, damageMaxDurationTicks: 175 })
  })
})

describe('zombie', () => {
  it('keeps both arms EMPTY with nothing special in hand', () => {
    const state = stateOf('zombie', { equipment: { mainhand: 'iron_sword' } })
    expect(state.rightArmPose).toBe('EMPTY')
    expect(state.leftArmPose).toBe('EMPTY')
    expect(state.isAggressive).toBe(false)
    expect(state.isConverting).toBe(false)
  })

  it('holds a spear in the SPEAR pose, and its use item is the main hand one for both arms (UndeadRenderState)', () => {
    const state = stateOf('zombie', { equipment: { mainhand: 'minecraft:iron_spear' } })
    expect(state.rightArmPose).toBe('SPEAR')
    expect(state.leftArmPose).toBe('EMPTY')
    expect(state.mainHandKineticWeapon).toEqual(SPEAR_KINETIC_WEAPONS.iron_spear)
    expect(state.offHandKineticWeapon).toEqual(SPEAR_KINETIC_WEAPONS.iron_spear)
  })

  it('a left handed zombie holds its main hand spear in the left arm', () => {
    const state = stateOf('husk', { meta: { mob_flags: LEFT_HANDED }, equipment: { mainhand: 'stone_spear' } })
    expect(state.mainArm).toBe('LEFT')
    expect(state.leftArmPose).toBe('SPEAR')
    expect(state.rightArmPose).toBe('EMPTY')
  })

  it('a stab swing puts the swinging arm in the SPEAR pose', () => {
    const input = makeInput('zombie')
    const tracker = new EntityAnimTracker('zombie', VERSION)
    tracker.setInput(input)
    tracker.tick()
    tracker.swing.swing('OFF_HAND', 15, 'STAB')
    tracker.tick()
    const state = entityAnimState(tracker, input)
    expect(state.leftArmPose).toBe('SPEAR')
    expect(state.rightArmPose).toBe('EMPTY')
  })

  it('isAggressive from the mob flags, isConverting from the drowned conversion data', () => {
    const state = stateOf('zombie', { meta: { mob_flags: AGGRESSIVE, drowned_conversion: true } })
    expect(state.isAggressive).toBe(true)
    expect(state.isConverting).toBe(true)
  })
})

describe('drowned', () => {
  it('raises an aggressive main hand trident to throw it', () => {
    expect(stateOf('drowned', { meta: { mob_flags: AGGRESSIVE }, equipment: { mainhand: 'trident' } }).rightArmPose).toBe('THROW_TRIDENT')
    expect(stateOf('drowned', { meta: { mob_flags: 0 }, equipment: { mainhand: 'trident' } }).rightArmPose).toBe('EMPTY')
    const left = stateOf('drowned', { meta: { mob_flags: AGGRESSIVE | LEFT_HANDED }, equipment: { mainhand: 'trident' } })
    expect(left.leftArmPose).toBe('THROW_TRIDENT')
    expect(left.rightArmPose).toBe('EMPTY')
    // the off hand trident is not thrown
    expect(stateOf('drowned', { meta: { mob_flags: AGGRESSIVE }, equipment: { offhand: 'trident' } }).leftArmPose).toBe('EMPTY')
  })

  it('swims by its swimming flag (0x10), not its pose: + 0.09 a tick', () => {
    const input = makeInput('drowned', { meta: { shared_flags: 0x10 } })
    const { tracker, state } = run(input, 3, 0.5)
    const s1 = f(0 + f(0.09))
    const s2 = f(s1 + f(0.09))
    const s3 = f(s2 + f(0.09))
    expect(tracker.swimAmount).toBe(s3)
    expect(tracker.swimAmountO).toBe(s2)
    expect(state.swimAmount).toBe(f(s2 + f(0.5 * f(s3 - s2))))
    expect(state.isVisuallySwimming).toBe(true)
    // stops: - 0.09 a tick
    input.meta = {}
    tracker.tick()
    expect(tracker.swimAmount).toBe(f(s3 - f(0.09)))
  })

  it('does not swim as a passenger', () => {
    const { tracker, state } = run(makeInput('drowned', { meta: { shared_flags: 0x10 }, isPassenger: true }), 3)
    expect(tracker.swimAmount).toBe(0)
    expect(state.isVisuallySwimming).toBe(false)
  })
})

describe('giant', () => {
  it('a MobRenderer: arm poses stay EMPTY, isAggressive false', () => {
    const state = stateOf('giant', { meta: { mob_flags: AGGRESSIVE }, equipment: { mainhand: 'iron_spear' } })
    expect(state.rightArmPose).toBe('EMPTY')
    expect(state.leftArmPose).toBe('EMPTY')
    expect(state.isAggressive).toBe(false)
    expect(state.isConverting).toBe(false)
  })
})

describe('zombie_villager', () => {
  it('isConverting from its converting data, villagerData by registry id', () => {
    const state = stateOf('zombie_villager', {
      meta: { converting: true, drowned_conversion: false, mob_flags: AGGRESSIVE, villager_data: { villagerType: 3, villagerProfession: 9, level: 2 } }
    })
    expect(state.isConverting).toBe(true)
    expect(state.isAggressive).toBe(true)
    expect(state.villagerData).toEqual({ type: 'savanna', profession: 'librarian', level: 2 })
  })

  it('the drowned conversion does not shake it (ZombieVillagerRenderer is not an AbstractZombieRenderer)', () => {
    expect(stateOf('zombie_villager', { meta: { drowned_conversion: true } }).isConverting).toBe(false)
  })
})

describe('zombified_piglin', () => {
  it('isAggressive, spear pose', () => {
    const state = stateOf('zombified_piglin', { meta: { mob_flags: AGGRESSIVE }, equipment: { mainhand: 'golden_spear' } })
    expect(state.isAggressive).toBe(true)
    expect(state.rightArmPose).toBe('SPEAR')
    expect(state.offHandKineticWeapon).toEqual(SPEAR_KINETIC_WEAPONS.golden_spear)
  })
})

describe('skeletons', () => {
  it('draws a main hand bow when aggressive', () => {
    const state = stateOf('skeleton', { meta: { mob_flags: AGGRESSIVE }, equipment: { mainhand: 'bow' } })
    expect(state.rightArmPose).toBe('BOW_AND_ARROW')
    expect(state.leftArmPose).toBe('EMPTY')
    expect(state.isHoldingBow).toBe(true)
    expect(state.isAggressive).toBe(true)
    const calm = stateOf('stray', { equipment: { mainhand: 'bow' } })
    expect(calm.rightArmPose).toBe('EMPTY')
    expect(calm.isHoldingBow).toBe(true)
    const left = stateOf('wither_skeleton', { meta: { mob_flags: AGGRESSIVE | LEFT_HANDED }, equipment: { mainhand: 'bow' } })
    expect(left.leftArmPose).toBe('BOW_AND_ARROW')
    expect(left.rightArmPose).toBe('EMPTY')
  })

  it('a sword is not a bow', () => {
    const state = stateOf('wither_skeleton', { meta: { mob_flags: AGGRESSIVE }, equipment: { mainhand: 'stone_sword' } })
    expect(state.isHoldingBow).toBe(false)
    expect(state.rightArmPose).toBe('EMPTY')
  })

  it('the skeleton shakes when converting to a stray, the others when fully frozen', () => {
    expect(stateOf('skeleton', { meta: { stray_conversion: true } }).isShaking).toBe(true)
    expect(stateOf('skeleton', { meta: { ticks_frozen: 140 } }).isShaking).toBe(false)
    expect(stateOf('stray', { meta: { ticks_frozen: 140 } }).isShaking).toBe(true)
    expect(stateOf('parched', { meta: { ticks_frozen: 139 } }).isShaking).toBe(false)
  })

  it('bogged isSheared', () => {
    expect(stateOf('bogged', { meta: { sheared: true } }).isSheared).toBe(true)
    expect(stateOf('bogged').isSheared).toBe(false)
  })
})

describe('piglin', () => {
  it('arm pose by priority: dancing, admiring, melee, charging, crossbow hold, default', () => {
    expect(stateOf('piglin', { meta: { is_dancing: true }, equipment: { offhand: 'gold_ingot' } }).armPose).toBe('DANCING')
    expect(stateOf('piglin', { meta: { mob_flags: AGGRESSIVE }, equipment: { mainhand: 'golden_sword', offhand: 'gold_ingot' } }).armPose).toBe('ADMIRING_ITEM')
    expect(stateOf('piglin', { meta: { mob_flags: AGGRESSIVE, is_charging_crossbow: true }, equipment: { mainhand: 'golden_sword' } }).armPose).toBe('ATTACKING_WITH_MELEE_WEAPON')
    expect(stateOf('piglin', { meta: { is_charging_crossbow: true }, equipment: { mainhand: 'golden_sword' } }).armPose).toBe('CROSSBOW_CHARGE')
    expect(stateOf('piglin', { equipment: { mainhand: 'crossbow' }, ...({ mainHandCharged: true } as object) }).armPose).toBe('CROSSBOW_HOLD')
    expect(stateOf('piglin', { equipment: { mainhand: 'crossbow' } }).armPose).toBe('DEFAULT')
    // a spear has no tool component
    expect(stateOf('piglin', { meta: { mob_flags: AGGRESSIVE }, equipment: { mainhand: 'golden_spear' } }).armPose).toBe('DEFAULT')
  })

  it('crossbow charge duration: 25, shortened by Quick Charge while charging', () => {
    const using = { meta: { living_entity_flags: 1, is_charging_crossbow: true }, equipment: { mainhand: 'crossbow' } }
    expect(stateOf('piglin', using).maxCrossbowChageDuration).toBe(25)
    expect(stateOf('piglin', { ...using, ...({ quickChargeLevel: 1 } as object) }).maxCrossbowChageDuration).toBe(20)
    expect(stateOf('piglin', { ...using, ...({ quickChargeLevel: 2 } as object) }).maxCrossbowChageDuration).toBe(15)
    expect(stateOf('piglin', { ...using, ...({ quickChargeLevel: 3 } as object) }).maxCrossbowChageDuration).toBe(10)
    expect(stateOf('piglin', { ...using, ...({ quickChargeLevel: 3 } as object) }).maxCrossbowChargeDuration).toBe(10)
    // not using the crossbow: getUseItem is empty
    expect(stateOf('piglin', { equipment: { mainhand: 'crossbow' }, ...({ quickChargeLevel: 3 } as object) }).maxCrossbowChageDuration).toBe(25)
  })

  it('counts the ticks it charges its crossbow', () => {
    const { state } = run(makeInput('piglin', { meta: { living_entity_flags: 1, is_charging_crossbow: true }, equipment: { mainhand: 'crossbow' } }), 6, 0.5)
    expect(state.armPose).toBe('CROSSBOW_CHARGE')
    expect(state.isUsingItem).toBe(true)
    expect(state.ticksUsingItem).toBe(5.5)
  })

  it('converts outside the nether unless immune or without AI', () => {
    const overworld = { dimension: 'minecraft:overworld' } as object
    expect(stateOf('piglin', { ...overworld }).isConverting).toBe(true)
    expect(stateOf('piglin', { ...({ dimension: 'minecraft:the_nether' } as object) }).isConverting).toBe(false)
    expect(stateOf('piglin', { meta: { immune_to_zombification: true }, ...overworld }).isConverting).toBe(false)
    expect(stateOf('piglin_brute', { meta: { mob_flags: NO_AI }, ...overworld }).isConverting).toBe(false)
    expect(stateOf('piglin_brute', { ...({ piglinsZombify: true } as object) }).isConverting).toBe(true)
    expect(stateOf('piglin').isConverting).toBe(false)
  })

  it('the brute attacks with a melee weapon only', () => {
    const brute = stateOf('piglin_brute', { meta: { mob_flags: AGGRESSIVE, is_dancing: true }, equipment: { mainhand: 'golden_axe' } })
    expect(brute.isBrute).toBe(true)
    expect(brute.armPose).toBe('ATTACKING_WITH_MELEE_WEAPON')
    expect(stateOf('piglin_brute', { meta: { is_dancing: true } }).armPose).toBe('DEFAULT')
    expect(stateOf('piglin').isBrute).toBe(false)
  })
})

describe('armor_stand', () => {
  it('flags, defaults poses', () => {
    const state = stateOf('armor_stand', { meta: { client_flags: 1 | 4 | 8 } })
    expect(state.isSmall).toBe(true)
    expect(state.isBaby).toBe(true)
    expect(state.ageScale).toBe(0.5)
    expect(state.showArms).toBe(true)
    expect(state.showBasePlate).toBe(false)
    expect(state.isMarker).toBe(false)
    expect(state.headPose).toEqual({ x: 0, y: 0, z: 0 })
    expect(state.leftArmPose).toEqual(ARMOR_STAND_DEFAULT_POSES.leftArmPose)
    expect(state.rightArmPose).toEqual({ x: -15, y: 0, z: 10 })
    expect(state.leftLegPose).toEqual({ x: -1, y: 0, z: -1 })
    expect(state.rightLegPose).toEqual({ x: 1, y: 0, z: 1 })
    const plain = stateOf('armor_stand', { meta: { client_flags: 16 } })
    expect(plain.isMarker).toBe(true)
    expect(plain.isSmall).toBe(false)
    expect(plain.ageScale).toBe(1)
    expect(plain.showArms).toBe(false)
    expect(plain.showBasePlate).toBe(true)
  })

  it('poses from the synched rotations (% 360)', () => {
    const state = stateOf('armor_stand', { meta: { head_pose: { pitch: 370, yaw: -45.5, roll: 0.1 }, right_arm_pose: { pitch: Number.NaN, yaw: 720, roll: -400 } } })
    expect(state.headPose).toEqual({ x: 10, y: -45.5, z: f(0.1) })
    expect(state.rightArmPose).toEqual({ x: 0, y: 0, z: -40 })
  })

  it('yRot is its own yaw (its body rotation)', () => {
    const state = stateOf('armor_stand', { bodyYaw: Math.PI / 2, headYaw: 0 })
    expect(state.yRot).toBe(state.bodyRot)
    expect(state.yRot).toBeCloseTo(90, 4)
  })

  it('wiggles from the hit event (32)', () => {
    const input = makeInput('armor_stand')
    const tracker = new EntityAnimTracker('armor_stand', VERSION)
    tracker.setInput(input)
    tracker.tick()
    expect(entityAnimState(tracker, input).wiggle).toBe(Number.POSITIVE_INFINITY)
    tracker.event(32)
    tracker.walk.partialTick = 0.25
    expect(entityAnimState(tracker, input).wiggle).toBe(0.25)
    tracker.tick()
    tracker.tick()
    expect(entityAnimState(tracker, input).wiggle).toBe(2.25)
  })
})
