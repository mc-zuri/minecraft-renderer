import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EntityAnimTracker, entityAnimState, entityEraState, registerEntityDrivers, registerEntityEraAdapters, type EntityAnimInput } from '../../entityAnimState'
import { getEntityModelsStore, getExportedEntity, loadEntityModels, setEntityModelsSource } from '../../exportedEntityModels'
import { ModelPose, animContext, animModelsFor, type AnimModel } from '../../setupAnim'
import { versionNumber } from '../../setupAnim/types'
import { clamp, f, wrapDegrees } from '../../setupAnim/mth'
import { DRIVERS } from '../index'
import { mthAtan2 } from '../monsters'
import { ENTITY_ERA_MOBS_ADAPTERS, ENTITY_ERA_MOBS_DRIVER_ALIASES } from './mobs'

vi.mock('../../../threeJsUtils', () => ({ loadThreeJsTextureFromUrlSync: () => ({ promise: new Promise(() => {}) }) }))

registerEntityDrivers(DRIVERS)
registerEntityDrivers(Object.fromEntries(Object.entries(ENTITY_ERA_MOBS_DRIVER_ALIASES).filter(([name, driver]) => driver && !DRIVERS[name])) as typeof DRIVERS)
registerEntityEraAdapters(ENTITY_ERA_MOBS_ADAPTERS)

const require = createRequire(import.meta.url)
const mcAssetsDist = path.dirname(require.resolve('mc-assets/dist/entityModels.json'))
setEntityModelsSource({ load: async exportVersion => JSON.parse(fs.readFileSync(path.join(mcAssetsDist, 'entityModels', `${exportVersion}.json`), 'utf8')) })

/** prismarine yaw (radians) whose game yRot is `degrees` */
const yawFor = (degrees: number) => ((180 - degrees) * Math.PI) / 180

/** the data names the export gives an entity in an entity era version */
const dataNamesOf = (version: string, name: string) => ((getExportedEntity(version, name) as { dataNames?: Record<string, string> } | undefined)?.dataNames ?? {})

/** data by name (the export's names) to data by index, and the meta keys entities.ts fills from them */
const byName = (version: string, name: string, values: Record<string, unknown>) => {
  const names = dataNamesOf(version, name)
  const data: Record<number, unknown> = {}
  for (const [index, other] of Object.entries(names)) if (values[other] !== undefined) data[Number(index)] = values[other]
  return { data, meta: { ...values } }
}

type Extra = Partial<EntityAnimInput>

const make = (name: string, version: string, extra: Extra = {}) => {
  const tracker = new EntityAnimTracker(name, version)
  const input: EntityAnimInput = {
    name,
    version,
    meta: {},
    data: {},
    bodyYaw: yawFor(0),
    headYaw: yawFor(0),
    pitch: 0,
    position: { x: 0.5, y: 64, z: 0.5 },
    onGround: true,
    ...extra
  }
  tracker.setInput(input)
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) tracker.tick()
  }
  const state = (partialTick = 0) => {
    tracker.walk.partialTick = partialTick
    return entityEraState(tracker, input, dataNamesOf(version, name))
  }
  return { tracker, input, ticks, state }
}

beforeAll(async () => {
  for (const version of ['1.8.9', '1.10.2', '1.12.2', '1.13.2', '1.16.5', '1.17.1', '1.19', '1.20.1', '1.21.1']) await loadEntityModels(version)
})

describe('humanoids', () => {
  it('count the fall flying ticks and keep the last swing hand (entity era)', () => {
    const { input, tracker, ticks, state } = make('zombie', '1.16.5')
    Object.assign(input, byName('1.16.5', 'zombie', { shared_flags: 0x80 }))
    ticks(6)
    let s = state()
    expect(s['entity.fallFlyTicks']).toBe(6)
    expect(s['entity.swingingArm']).toBeNull()
    tracker.swingArm('OFF_HAND')
    ticks(1)
    s = state()
    expect(s['entity.swingingArm']).toBe('OFF_HAND')
    input.data = {}
    input.meta = {}
    ticks(1)
    expect(state()['entity.fallFlyTicks']).toBe(0)
  })

  it("draw a baby's walk three times as fast before 1.19.4 (the tracker's from 1.19.4)", () => {
    for (const version of ['1.16.5', '1.20.1']) {
      const { input, tracker, state } = make('zombie', version)
      Object.assign(input, byName(version, 'zombie', { baby: true }))
      for (let i = 0; i < 10; i++) {
        input.position = { x: 0.5 + i * 0.1, y: 64, z: 0.5 }
        tracker.setInput(input)
        tracker.advance(0.05)
      }
      const s = state(0.5)
      const walk = tracker.walk.walk
      const plain = f(walk.position - f(walk.speed * f(1 - 0.5)))
      expect(s.walkAnimationPos).toBe(f(plain * 3))
    }
  })

  it('read the legacy synched data: a baby zombie, sneaking, the int arm poses of 1.8, 1.13 swimming', () => {
    const legacy = make('zombie', '1.12.2', { data: { 0: 2, 12: true } })
    legacy.ticks(1)
    let s = legacy.state()
    expect(s['model.child']).toBe(true)
    expect(s['model.sneaking']).toBe(true)
    expect(s['entity.mainHand']).toBeNull()
    legacy.tracker.swingArm('MAIN_HAND')
    expect(legacy.state()['entity.mainHand']).toBe('MAIN_HAND')

    const old = make('zombie', '1.8.9', { data: { 12: 1 } })
    s = old.state()
    expect(s['model.child']).toBe(true)
    expect(s['model.leftArmPose']).toBe(0)
    expect(s['model.rightArmPose']).toBe(0)

    const swimming = make('zombie', '1.13.2', { data: { 0: 0x10 } })
    swimming.ticks(3)
    s = swimming.state()
    expect(s['entity.field_16813']).toBe(f(f(f(0.09) + f(0.09)) + f(0.09)))
    expect(s['entity.field_16814']).toBe(f(f(0.09) + f(0.09)))
  })

  it('tell piglins apart by entity type, endermen carry and scream', () => {
    expect(make('piglin_brute', '1.16.5').state().entityType).toBe('piglin_brute')
    const enderman = make('enderman', '1.16.5')
    Object.assign(enderman.input, byName('1.16.5', 'enderman', { carry_state: 12, creepy: true }))
    let s = enderman.state()
    expect(s['model.carrying']).toBe(true)
    expect(s['model.creepy']).toBe(true)
    s = make('enderman', '1.8.9', { data: { 16: 0, 18: 1 } }).state()
    expect(s['model.carryingBlock']).toBe(false)
    expect(s['model.angry']).toBe(true)
    s = make('enderman', '1.12.2', { data: { 12: 3, 13: false } }).state()
    expect(s['model.carryingBlock']).toBe(true)
    expect(s['model.angry']).toBe(false)
  })
})

describe('iron golem', () => {
  it("swings its arms by the entity event's timer, under 1.8's name too", () => {
    const golem = make('villager_golem', '1.8.9')
    golem.tracker.event(4)
    expect(golem.state()['entity.attackTicksLeft']).toBe(10)
    golem.ticks(3)
    expect(golem.state()['entity.attackTicksLeft']).toBe(7)
    const modern = make('iron_golem', '1.16.5')
    modern.tracker.event(11)
    modern.ticks(1)
    expect(modern.state()['entity.offerFlowerTick']).toBe(399)
  })
})

describe('magma cube', () => {
  it('squishes as the old Slime.tick does: oSquish equal to squish', () => {
    // landing: target -0.5, * 0.9; each tick squish += (target - squish) * 0.5, the target decays by 0.9
    let squish = 0
    let target = 0
    const expected: number[] = []
    for (let i = 0; i < 4; i++) {
      squish = f(squish + f(f(target - squish) * 0.5))
      if (i === 0) target = -0.5
      target = f(target * f(0.9))
      expected.push(squish)
    }
    for (const [name, version, key, old] of [
      ['lava_slime', '1.8.9', 'entity.stretch', 'entity.lastStretch'],
      ['magma_cube', '1.16.5', 'entity.squish', 'entity.oSquish']
    ] as const) {
      const cube = make(name, version)
      cube.ticks(4)
      const s = cube.state(0.5)
      expect(s[key]).toBe(expected[3])
      expect(s[old]).toBe(expected[3])
    }
  })
})

describe('shulker', () => {
  it('peeks toward the synched amount by 0.05 a tick, legacy and entity era', () => {
    const legacy = make('shulker', '1.12.2', { data: { 14: 100 } })
    legacy.ticks(3)
    let s = legacy.state()
    expect(s['entity.field_14768']).toBe(f(f(f(0.05) + f(0.05)) + f(0.05)))
    expect(s['entity.field_14767']).toBe(f(f(0.05) + f(0.05)))
    const modern = make('shulker', '1.16.5')
    Object.assign(modern.input, byName('1.16.5', 'shulker', { peek: 30 }))
    modern.ticks(10)
    s = modern.state()
    expect(s['entity.currentPeekAmount']).toBe(f(30 * f(0.01)))
  })

  it('from 1.17, a new block position zeroes the peek', () => {
    const shulker = make('shulker', '1.17.1')
    Object.assign(shulker.input, byName('1.17.1', 'shulker', { peek: 100 }))
    shulker.ticks(4)
    expect(shulker.state()['entity.currentPeekAmount']).toBe(f(f(f(f(0.05) + f(0.05)) + f(0.05)) + f(0.05)))
    shulker.input.position = { x: 3.5, y: 64, z: 0.5 }
    shulker.ticks(1)
    const s = shulker.state()
    expect(s['entity.currentPeekAmountO']).toBe(f(f(f(f(0.05) + f(0.05)) + f(0.05)) + f(0.05)))
    expect(s['entity.currentPeekAmount']).toBe(f(f(f(f(0.05) + f(0.05)) + f(0.05))))
  })
})

describe('wither', () => {
  it("turns a legacy side head toward its target's eyes, 10 degrees of yaw a tick", () => {
    const target = { x: 10.5, y: 64, z: 0.5, eyeY: 65.62 }
    const wither = make('wither_boss', '1.8.9', { data: { 18: 7 }, lookupEntity: id => (id === 7 ? target : undefined) })
    wither.ticks(1)
    const s = wither.state()
    const bodyYaw = 0
    // head 1: getHeadX at angle (bodyYaw + 0) / 180F * PI
    const hx = 0.5 + Math.fround(Math.cos(0)) * 1.3
    const yaw = f(f((mthAtan2(0, target.x - hx) * 180) / f(Math.PI)) - 90)
    const step = (from: number, to: number, max: number) => f(from + clamp(wrapDegrees(f(to - from)), -max, max))
    expect(s['entity.sideHeadYaws'][0]).toBe(step(0, yaw, 10))
    // head 2 has no target: it follows the body
    expect(s['entity.sideHeadYaws'][1]).toBe(step(0, bodyYaw, 10))
    expect(s['entity.bodyYaw']).toBe(0)
  })

  it('reads the wither driver in the entity era', () => {
    const wither = make('wither', '1.16.5', { bodyYaw: yawFor(40) })
    wither.ticks(2)
    expect(wither.state()['entity.yRotHeads']).toEqual([20, 20])
  })
})

describe('guardian', () => {
  it('ticks its tail and spikes (in water, still), Yarn names swapped before 1.14', () => {
    for (const [version, tail, tailO, spikes] of [
      ['1.12.2', 'entity.spikesExtension', 'entity.prevSpikesExtension', 'entity.tailAngle'],
      ['1.16.5', 'entity.clientSideTailAnimation', 'entity.clientSideTailAnimationO', 'entity.clientSideSpikesAnimation']
    ] as const) {
      const guardian = make('guardian', version, { isInWater: true })
      guardian.tracker.memory.random = () => 0.25
      guardian.state()
      guardian.ticks(2)
      const s = guardian.state()
      const speed1 = f(f(0.125 - 0) * f(0.2))
      const speed2 = f(speed1 + f(f(0.125 - speed1) * f(0.2)))
      expect(s[tailO]).toBe(f(f(0.25) + speed1))
      expect(s[tail]).toBe(f(f(f(0.25) + speed1) + speed2))
      const spikes1 = f(0 + f(f(1 - 0) * f(0.06)))
      expect(s[spikes]).toBe(f(spikes1 + f(f(1 - spikes1) * f(0.06))))
    }
  })

  it('draws the spikes in while moving (the export names the data id_moving) and looks at its target', () => {
    const guardian = make('guardian', '1.16.5', { isInWater: true, lookupEntity: () => ({ x: 4, y: 64, z: 0, eyeY: 65.5 }) })
    Object.assign(guardian.input, byName('1.16.5', 'guardian', { id_moving: true, id_attack_target: 3 }))
    guardian.tracker.memory.random = () => 0.5
    guardian.state()
    guardian.ticks(1)
    const s = guardian.state()
    expect(s['entity.clientSideTailAnimation']).toBe(f(0.5 + 4))
    expect(s['entity.clientSideSpikesAnimation']).toBe(0)
    expect(s.attackTargetEyePosition).toEqual({ x: 4, y: 65.5, z: 0 })
    expect(s.eyePosition).toEqual({ x: 0.5, y: 64 + f(0.425), z: 0.5 })
  })
})

describe('villagers, witches, illagers', () => {
  it('counts the villager unhappy counter down', () => {
    const villager = make('villager', '1.16.5')
    Object.assign(villager.input, byName('1.16.5', 'villager', { unhappy_counter: 40 }))
    villager.ticks(5)
    const s = villager.state()
    const index = Object.entries(dataNamesOf('1.16.5', 'villager')).find(([, name]) => name === 'unhappy_counter')![0]
    expect(s[`data.${index}`]).toBe(35)
  })

  it('give the witch model its held item and the illager models their entity', () => {
    expect(make('witch', '1.16.5', { equipment: { mainhand: 'potion' } }).state()['model.holdingItem']).toBe(true)
    expect(make('witch', '1.12.2', { equipment: { mainhand: 'potion' } }).state()['model.field_5133']).toBe(true)
    expect(make('witch', '1.13.2').state()['model.field_20606']).toBe(false)
    expect(make('vindication_illager', '1.12.2').state().entityType).toBe('vindication_illager')
    const pillager = make('pillager', '1.16.5', { quickChargeLevel: 2 } as Extra)
    Object.assign(pillager.input, byName('1.16.5', 'pillager', { living_entity_flags: 1 }))
    pillager.ticks(3)
    const s = pillager.state()
    expect(s['entity.ticksUsingItem']).toBe(3)
    expect(s['entity.crossbowChargeDuration']).toBe(15)
  })
})

describe('warden, breeze', () => {
  it('plays the animation states from their start tick', () => {
    const warden = make('warden', '1.19')
    warden.ticks(2)
    warden.tracker.event(4)
    warden.ticks(5)
    const s = warden.state(0.5)
    // started at tick 2: (7.5 ticks * 50 ms) - 2 * 50
    expect(s['entity.attackAnimationState']).toEqual({ lastTime: 375, accumulatedTime: 275 })
    expect(s['entity.roarAnimationState']).toBeNull()
    const breeze = make('breeze', '1.21.1', { pose: 'LONG_JUMPING' })
    breeze.ticks(3)
    expect(breeze.state()['entity.longJump']).toEqual({ lastTime: 150, accumulatedTime: 100 })
  })
})

describe('armor stand, minecart, boat', () => {
  it('turns the base plate by the stand yaw, a small stand is a baby', () => {
    let s = make('armor_stand', '1.16.5', { bodyYaw: yawFor(30) }).state()
    expect(s['entity.yRot']).toBeCloseTo(30, 4)
    s = make('armor_stand', '1.12.2', { bodyYaw: yawFor(30), data: { 11: 1 } }).state()
    expect(s['entity.yaw']).toBeCloseTo(30, 4)
    expect(s['model.child']).toBe(true)
  })

  it("passes the minecart model the renderer's arguments", () => {
    expect(make('minecart', '1.16.5').state().ageInTicks).toBe(f(-0.1))
    expect(make('minecart', '1.20.1').state().ageInTicks).toBe(0)
  })

  it('rows the paddles: PI / 8 a tick (1.12+), 0.01 before; the partial tick as walkAnimationPos (1.15+)', () => {
    const boat = make('boat', '1.16.5', { renderHints: { passengerIds: [9] } })
    Object.assign(boat.input, byName('1.16.5', 'boat', { id_paddle_left: true, id_paddle_right: false }))
    boat.ticks(2)
    let s = boat.state(0.25)
    const step = f(Math.PI / 8)
    expect(s['entity.paddlePositions']).toEqual([f(step + step), 0])
    expect(s.walkAnimationPos).toBe(0.25)
    // nobody controls it: the paddles stop
    boat.input.renderHints = { passengerIds: [] }
    boat.ticks(1)
    s = boat.state()
    expect(s['entity.paddlePositions']).toEqual([0, 0])
    const legacy = make('boat', '1.10.2', { data: { 10: true } })
    legacy.ticks(3)
    s = legacy.state(0.5)
    const phase = f(f(f(0.01) + 0.01) + 0.01)
    expect(s['entity.paddlePhases'][0]).toBe(phase)
    expect(s['entity.rowingTimes'][0]).toBe(f(phase - 0.01 + 0.5 * 0.01))
    expect(s['entity.rowingTimes'][1]).toBe(0)
  })
})

/**
 * The models of an entity in a version: the export's looks whose model class has a port (each model once), as
 * ModelPoses of the exported layers.
 */
const modelsOf = (version: string, name: string) => {
  const store = getEntityModelsStore(version)!
  const entity = store.getEntity(version, name) as { states: Array<{ look?: Record<string, { type: string; model?: string; modelClass?: string }> }> }
  const ports = animModelsFor(version)
  const context = animContext(version, animation => store.getAnimation(version, animation))
  const seen = new Set<string>()
  const models: Array<{ key: string; pose: ModelPose; model: AnimModel }> = []
  for (const state of entity.states) {
    for (const look of Object.values(state.look ?? {})) {
      if (look.type !== 'model' || !look.model || !look.modelClass || !ports[look.modelClass]) continue
      const key = `${look.model} ${look.modelClass}`
      if (seen.has(key)) continue
      seen.add(key)
      const layer = store.getModel(version, look.model)
      if (!layer) continue
      const pose = new ModelPose(layer.root)
      models.push({ key, pose, model: new ports[look.modelClass]!(pose, context) })
    }
  }
  return models
}

/** One per port family: entity era humanoid, monsters, misc, aquatic (guardian), small (vex); legacy humanoid / monsters and misc. */
const INTEGRATION: Array<[string, string, Record<string, unknown>]> = [
  ['zombie', '1.16.5', { baby: true }],
  ['piglin', '1.16.5', {}],
  ['enderman', '1.20.1', { carry_state: 3 }],
  ['vex', '1.16.5', {}],
  ['wither', '1.17.1', {}],
  ['magma_cube', '1.19', {}],
  ['shulker', '1.16.5', { peek: 50 }],
  ['guardian', '1.20.1', { id_attack_target: 2 }],
  ['iron_golem', '1.16.5', {}],
  ['villager', '1.19', {}],
  ['pillager', '1.20.1', {}],
  ['warden', '1.19', {}],
  ['breeze', '1.21.1', {}],
  ['armor_stand', '1.16.5', {}],
  ['boat', '1.16.5', { id_paddle_left: true }],
  ['zombie', '1.12.2', {}],
  ['skeleton', '1.8.9', {}],
  ['enderman', '1.10.2', {}],
  ['wither_boss', '1.8.9', {}],
  ['guardian', '1.12.2', {}],
  ['lava_slime', '1.8.9', {}],
  ['villager_golem', '1.8.9', {}],
  ['shulker', '1.12.2', {}],
  ['evoker', '1.13.2', {}],
  ['armor_stand', '1.12.2', {}]
]

describe('entity era state through the ported models', () => {
  for (const [name, version, values] of INTEGRATION) {
    it(`poses ${name} ${version} standing and walking with finite numbers`, () => {
      const models = modelsOf(version, name)
      expect(models.length).toBeGreaterThan(0)
      const { input, tracker, state } = make(name, version, {
        isInWater: true,
        cameraEyePosition: { x: 2, y: 66, z: 3 },
        lookupEntity: () => ({ x: 4, y: 64, z: 1, eyeY: 65.6 }),
        renderHints: { passengerIds: [3] },
        headYaw: yawFor(30),
        pitch: 0.3
      })
      if (versionNumber(version) >= versionNumber('1.14')) Object.assign(input, byName(version, name, values))
      const check = (label: string) => {
        tracker.setInput(input)
        const s = state(0.4)
        for (const { key, pose, model } of models) {
          model.setupAnim({ ...s })
          for (const part of pose.byPath.values()) {
            const values = [...part.pose, ...part.scale]
            expect(values.every(Number.isFinite), `${label} ${key} ${part.path}: ${values.join(', ')}`).toBe(true)
          }
        }
      }
      tracker.advance(0.2)
      check('standing')
      tracker.swingArm('MAIN_HAND')
      for (let i = 0; i < 12; i++) {
        input.position = { x: 0.5 + i * 0.15, y: 64, z: 0.5 }
        tracker.setInput(input)
        tracker.advance(0.05)
      }
      expect(entityAnimState(tracker, input).walkAnimationSpeed).toBeGreaterThan(0)
      check('walking')
    })
  }
})
