import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { createRequire } from 'module'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { EntityModelPart } from 'mc-assets/dist/entityModels'
import { EntityAnimTracker, entityEraState, registerEntityDrivers, registerEntityEraAdapters, type EntityAnimInput } from '../../entityAnimState'
import { getEntityModelsStore, loadEntityModels, setEntityModelsSource } from '../../exportedEntityModels'
import { ModelPose, animContext, animModelsFor, floatState } from '../../setupAnim'
import { PI, f, floatSinCos, lerp } from '../../setupAnim/mth'
import { QUADRUPEDS_DRIVERS } from '../quadrupeds'
import { SMALL_DRIVERS } from '../small'
import { EQUINES_DRIVERS } from '../equines'
import { AQUATIC_DRIVERS } from '../aquatic'
import { ENTITY_ERA_ANIMALS_ADAPTERS } from './animals'

vi.mock('../../../threeJsUtils', () => ({ loadThreeJsTextureFromUrlSync: () => ({ promise: new Promise(() => {}) }) }))

registerEntityDrivers({ ...QUADRUPEDS_DRIVERS, ...SMALL_DRIVERS, ...EQUINES_DRIVERS, ...AQUATIC_DRIVERS })
registerEntityEraAdapters(ENTITY_ERA_ANIMALS_ADAPTERS)

/** An entity of a version: its synched data by index (the export's names for 1.14+), ticked and read like the scene. */
const make = (name: string, version: string, data: Record<number, unknown> = {}, dataNames: Record<string, string> = {}, extra: Partial<EntityAnimInput> = {}) => {
  const meta: Record<string, unknown> = {}
  for (const [index, key] of Object.entries(dataNames)) if (data[Number(index)] !== undefined && meta[key] === undefined) meta[key] = data[Number(index)]
  const input: EntityAnimInput = { name, version, meta, data, bodyYaw: 0, headYaw: 0, pitch: 0, onGround: true, ...extra }
  const tracker = new EntityAnimTracker(name, version)
  tracker.memory.random = () => 0.5
  tracker.setInput(input)
  return {
    input,
    tracker,
    /** a synched value arrives */
    set(index: number, value: unknown) {
      data[index] = value
      const key = dataNames[index]
      if (key) meta[key] = value
    },
    ticks(n: number) {
      for (let i = 0; i < n; i++) tracker.tick()
    },
    state(partialTick = 0) {
      tracker.walk.partialTick = partialTick
      return entityEraState(tracker, input, dataNames)
    }
  }
}

describe('horses', () => {
  it('1.20.1: the eat, stand and mouth animations from id_flags', () => {
    const horse = make('horse', '1.20.1', { 17: 16 }, { 16: 'baby', 17: 'id_flags' })
    horse.ticks(1)
    let state = horse.state()
    expect(state['entity.eatAnim']).toBe(f(f(f(1 * f(0.4)) + f(0.05))))
    expect(state['entity.eatAnimO']).toBe(0)
    expect(state['entity.tailCounter']).toBe(0)
    // standing (32) resets the eat animation
    horse.set(17, 32 | 64)
    horse.ticks(1)
    state = horse.state()
    expect(state['entity.eatAnim']).toBe(0)
    expect(state['entity.standAnim']).toBe(f(f(0.4) + f(0.05)))
    expect(state['entity.mouthAnim']).toBe(f(f(f(1 * f(0.7)) + f(0.05))))
  })

  it('1.8.9: an int at 16, eating grass 32, field_6897 the tail (1 then 2 in the same tick)', () => {
    const horse = make('entity_horse', '1.8.9', { 16: 32 })
    horse.tracker.memory.random = () => 0
    horse.ticks(1)
    const state = horse.state()
    expect(state['entity.eatingGrassAnimationProgress']).toBe(f(f(0.4) + f(0.05)))
    expect(state['entity.lastEatingGrassAnimationProgress']).toBe(0)
    expect(state['entity.angryAnimationProgress']).toBe(0)
    expect(state['entity.field_6897']).toBe(2)
    expect(state['entity.eatAnim']).toBeUndefined()
  })

  it('1.12.2: a byte at 13, open mouth 64, field_15506 / field_15507', () => {
    const horse = make('horse', '1.12.2', { 13: 64 })
    horse.ticks(2)
    const state = horse.state()
    expect(state['entity.field_15507']).toBe(f(0.75))
    expect(state['entity.field_15506']).toBe(f(f(0.75) + f(f(f(1 - f(0.75)) * f(0.7)) + f(0.05))) > 1 ? 1 : f(f(0.75) + f(f(f(1 - f(0.75)) * f(0.7)) + f(0.05))))
    expect(state['entity.hasPassengers']).toBe(false)
  })
})

describe('wolves', () => {
  it('1.12.2: the tail angle from its own health at 15, the head tilt from 16 (field_3727)', () => {
    const wolf = make('wolf', '1.12.2', { 13: 4, 15: 10, 16: true })
    wolf.ticks(1)
    const state = wolf.state()
    expect(state.ageInTicks).toBe(f(f(f(0.55) - f(f(20 - 10) * f(0.02))) * PI))
    expect(state['entity.field_3727']).toBe(f(0.4))
    expect(state['entity.field_3728']).toBe(0)
  })

  it('1.14.4: the wolf health (its second `health`), not the living one', () => {
    const wolf = make('wolf', '1.14.4', { 8: 20, 15: 4, 17: 12 }, { 8: 'health', 15: 'flags', 17: 'health', 18: 'interested' })
    expect(wolf.state().ageInTicks).toBe(f(f(f(0.55) - f(f(20 - 12) * f(0.02))) * PI))
  })

  it('1.20.5: the health ratio of a tame wolf (40), angry by the remaining anger time', () => {
    const names = { 9: 'health', 17: 'flags', 21: 'remaining_anger_time' }
    const wolf = make('wolf', '1.20.5', { 9: 30, 17: 4 }, names)
    expect(wolf.state().ageInTicks).toBe(f(f(f(0.55) - f(f(f(40 - 30) / 40) * f(0.4))) * PI))
    wolf.set(21, 100)
    expect(wolf.state().ageInTicks).toBe(f(1.539_380_4))
  })

  it('1.15.2: being wet stops the shake on the client', () => {
    const wolf = make('wolf', '1.15.2', {}, { 16: 'flags' })
    wolf.tracker.event(8)
    wolf.ticks(4)
    expect(wolf.state()['entity.shakeAnim']).toBe(wolf.tracker.memory.wolf.shakeAnim)
    expect(wolf.state()['entity.shakeAnim']).toBeGreaterThan(0)
    wolf.input.isInWater = true
    expect(wolf.state()['entity.shakeAnim']).toBe(0)
  })
})

describe('flapping', () => {
  const flapAge = (doubles: boolean, ticks: number, pt: number) => {
    let flap = 0
    let oFlap = 0
    let speed = 0
    let oSpeed = 0
    let flapping = 1
    for (let i = 0; i < ticks; i++) {
      oFlap = flap
      oSpeed = speed
      speed = Math.min(1, doubles ? f(speed + 4 * 0.3) : f(speed + f(4 * f(0.3))))
      // off the ground: back to 1 before slowing
      flapping = 1
      flapping = doubles ? f(flapping * 0.9) : f(flapping * f(0.9))
      flap = f(flap + f(flapping * 2))
    }
    return f(f(floatSinCos.sin(lerp(pt, oFlap, flap)) + 1) * lerp(pt, oSpeed, speed))
  }

  it('a chicken in the air flaps in doubles in 1.14.4, in floats in 1.20.1 (the age)', () => {
    for (const [version, doubles] of [
      ['1.14.4', true],
      ['1.20.1', false],
      ['1.8.9', true]
    ] as const) {
      const chicken = make('chicken', version, {}, {}, { onGround: false })
      chicken.ticks(3)
      expect(chicken.state(0.5).ageInTicks).toBe(flapAge(doubles, 3, 0.5))
    }
  })

  it('a riding parrot does not flap since 1.14', () => {
    const riding = { onGround: false, isPassenger: true }
    const old = make('parrot', '1.12.2', {}, {}, riding)
    const parrot = make('parrot', '1.16.5', {}, { 16: 'flags' }, riding)
    old.ticks(2)
    parrot.ticks(2)
    expect(old.state(0.5).ageInTicks).toBe(flapAge(true, 2, 0.5))
    // riding: the flap speed stays 0
    expect(parrot.state(0.5).ageInTicks).toBe(0)
    expect(parrot.state()['entity.partyParrot']).toBe(false)
  })
})

describe('rabbit, fox', () => {
  it('a rabbit jumps for 10 ticks before 1.21.2', () => {
    const rabbit = make('rabbit', '1.16.5', {}, { 16: 'type' })
    rabbit.tracker.event(1)
    rabbit.ticks(3)
    expect(rabbit.state()['entity.jumpTicks']).toBe(3)
    expect(rabbit.state()['entity.jumpDuration']).toBe(10)
    rabbit.ticks(7)
    expect(rabbit.state()['entity.jumpTicks']).toBe(10)
    rabbit.ticks(1)
    expect(rabbit.state()['entity.jumpTicks']).toBe(0)
    expect(rabbit.state()['entity.jumpDuration']).toBe(0)
  })

  it("a fox's crouch stops at 3", () => {
    const fox = make('fox', '1.16.5', { 17: 4 }, { 17: 'flags' })
    fox.ticks(20)
    expect(fox.tracker.memory.fox.crouchAmount).toBeGreaterThan(3)
    expect(fox.state()['entity.crouchAmount']).toBe(3)
    fox.ticks(1)
    fox.set(17, 0)
    fox.ticks(1)
    expect(fox.state()['entity.crouchAmount']).toBe(0)
    expect(fox.state()['entity.crouchAmountO']).toBe(3)
  })
})

describe('quadrupeds', () => {
  const pandaNames = { 15: 'baby', 16: 'unhappy_counter', 17: 'sneeze_counter', 18: 'eat_counter', 19: 'main_gene', 20: 'hidden_gene', 21: 'id_flags' }

  it("a panda: its own copy of the counters (data), sitting from id_flags, no head pitch while sitting", () => {
    const panda = make('panda', '1.16.5', { 16: 5, 21: 8 }, pandaNames, { pitch: 0.4 })
    panda.ticks(2)
    const state = panda.state()
    expect(state['data.16']).toBe(3)
    expect(state['entity.sitAmount']).toBe(f(f(0.15) + f(0.15)))
    expect(state['entity.sitAmountO']).toBe(f(0.15))
    expect(state.xRot).toBe(0)
    expect(state['entity.isScared']).toBe(false)
    // the server's new value replaces the copy
    panda.set(16, 20)
    panda.ticks(1)
    expect(panda.state()['data.16']).toBe(19)
  })

  it('a 1.12.2 polar bear stands up from the boolean at 13 (field_15034, field_15033)', () => {
    const bear = make('polar_bear', '1.12.2', { 13: true })
    bear.ticks(3)
    const state = bear.state()
    expect(state['entity.field_15034']).toBe(3)
    expect(state['entity.field_15033']).toBe(2)
  })

  it('a 1.8.9 sheep eats grass (eatGrassTimer), its pitch is the entity pitch', () => {
    const sheep = make('sheep', '1.8.9', { 12: -1 }, {}, { pitch: -0.3 })
    sheep.tracker.event(10)
    sheep.ticks(1)
    const state = sheep.state()
    expect(state['entity.eatGrassTimer']).toBe(39)
    expect(state['entity.pitch']).toBe(f(0.3 * (180 / Math.PI)))
    expect(state['model.child']).toBe(true)
  })
})

describe('animation states', () => {
  it('a 1.20.4 bat rests from id_flags', () => {
    const bat = make('bat', '1.20.4', { 16: 1 }, { 16: 'id_flags' })
    bat.ticks(2)
    const state = bat.state(0.5)
    expect(state['entity.restAnimationState']).toEqual({ lastTime: 125, accumulatedTime: 75 })
    expect(state['entity.flyAnimationState']).toBeNull()
  })

  it('a 1.20.1 sniffer: its state by name, the digging animation from the callback', () => {
    const sniffer = make('sniffer', '1.20.1', { 17: 5 }, { 17: 'state' })
    sniffer.ticks(1)
    const state = sniffer.state()
    expect(state['data.17']).toBe('DIGGING')
    expect(state['entity.diggingAnimationState']).toEqual({ lastTime: 50, accumulatedTime: 50 })
    expect(state['entity.risingAnimationState']).toBeNull()
  })

  it('a 1.19.4 sniffer walks at the speed of its motion, searches with its own animation', () => {
    const sniffer = make('sniffer', '1.19.4', { 17: 4 }, { 17: 'state' }, { velocity: { x: 0.01, y: 0, z: 0 } })
    sniffer.ticks(1)
    let state = sniffer.state()
    expect(state['entity.walkingAnimationState']).toEqual({ lastTime: 50, accumulatedTime: 0 })
    // started by the callback at tick 0, run at the walk speed: 50 ms * 0.9
    expect(state['entity.searchingAnimationState']).toEqual({ lastTime: 50, accumulatedTime: 45 })
    // speed min(0.0001 * 9000, 1) = 0.9: 25 ms later, 22 ms on
    state = sniffer.state(0.5)
    expect(state['entity.walkingAnimationState']).toEqual({ lastTime: 75, accumulatedTime: Math.trunc(f(25 * f(f(0.01 * 0.01) * 9000))) })
  })

  it("a camel's dash ends below 55 in 1.19.4, below 50 since 1.20", () => {
    const names = { 17: 'id_flags', 18: 'dash', 19: 'last_pose_change_tick' }
    for (const [version, dashing] of [
      ['1.19.4', false],
      ['1.20.1', true]
    ] as const) {
      const camel = make('camel', version, { 18: false }, names)
      camel.ticks(1)
      camel.state()
      camel.set(18, true)
      camel.ticks(1)
      expect(camel.state()['entity.dashAnimationState']).not.toBeNull()
      expect(camel.state()['entity.dashCooldown']).toBe(54)
      camel.ticks(1)
      expect(camel.state()['entity.dashAnimationState'] !== null).toBe(dashing)
      expect(camel.state()['entity.idleAnimationState']).not.toBeNull()
    }
  })
})

// ---- integration: the ported models posed from the built state ----

const require = createRequire(import.meta.url)
const mcAssetsDist = path.dirname(require.resolve('mc-assets/dist/entityModels.json'))
setEntityModelsSource({ load: async exportVersion => JSON.parse(fs.readFileSync(path.join(mcAssetsDist, 'entityModels', `${exportVersion}.json`), 'utf8')) })

type Sampled = { modelClass: string; layer: string; part?: string; dataNames?: Record<string, string> }
const fixture = (version: string): Record<string, Sampled> =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', `setupAnimSamples-${version}.json.gz`))).toString()).models

const descend = (root: EntityModelPart, part: string | undefined) => {
  let current = root
  for (const name of (part ?? '').split('/').filter(Boolean)) current = current.children![name]!
  return current
}

/** One model per port family: entity era quadrupeds, equines, small animals, aquatic; legacy quadrupeds, small animals. */
const FAMILIES: Array<{ version: string; entity: string; sampled: string; data?: Record<number, unknown>; extra?: Partial<EntityAnimInput> }> = [
  { version: '1.20.1', entity: 'panda', sampled: 'PandaModel|minecraft:panda#main', data: { 22: 8 | 4 } },
  { version: '1.20.1', entity: 'horse', sampled: 'HorseModel|minecraft:horse#main', data: { 17: 4 | 16 }, extra: { isVehicle: true } },
  { version: '1.20.1', entity: 'camel', sampled: 'CamelModel|minecraft:camel#main', data: { 18: true } },
  { version: '1.20.1', entity: 'wolf', sampled: 'WolfModel|minecraft:wolf#main', data: { 17: 4, 19: true } },
  { version: '1.20.1', entity: 'parrot', sampled: 'ParrotModel|minecraft:parrot#main', extra: { onGround: false } },
  { version: '1.19.2', entity: 'frog', sampled: 'FrogModel|minecraft:frog#main' },
  { version: '1.20.1', entity: 'axolotl', sampled: 'AxolotlModel|minecraft:axolotl#main', extra: { isInWater: true } },
  { version: '1.8.9', entity: 'entity_horse', sampled: 'HorseBaseEntityModel|legacy:horse_base_entity_model', data: { 16: 32 | 4 } },
  { version: '1.12.2', entity: 'sheep', sampled: 'SheepEntityModel|legacy:sheep_entity_model' },
  { version: '1.12.2', entity: 'wolf', sampled: 'WolfEntityModel|legacy:wolf_entity_model', data: { 13: 4, 15: 14, 16: true } },
  { version: '1.8.9', entity: 'chicken', sampled: 'ChickenEntityModel|legacy:chicken_entity_model', extra: { onGround: false } }
]

describe('the ported models posed from entityEraState', () => {
  const versions = [...new Set(FAMILIES.map(family => family.version))]
  const fixtures: Record<string, Record<string, Sampled>> = {}
  beforeAll(async () => {
    for (const version of versions) {
      fixtures[version] = fixture(version)
      await loadEntityModels(version)
    }
  }, 60_000)

  for (const family of FAMILIES) {
    it(`${family.version} ${family.entity} (${family.sampled.split('|')[0]}): finite poses standing and walking`, () => {
      const sampled = fixtures[family.version]![family.sampled]!
      expect(sampled).toBeDefined()
      const store = getEntityModelsStore(family.version)!
      const layer = store.getModel(family.version, sampled.layer)!
      const pose = new ModelPose(descend(layer.root, sampled.part))
      const model = new (animModelsFor(family.version)[sampled.modelClass]!)(pose, animContext(family.version, name => store.getAnimation(family.version, name)))
      const entity = make(family.entity, family.version, { ...family.data }, sampled.dataNames ?? {}, { position: { x: 0, y: 64, z: 0 }, pitch: 0.2, headYaw: 0.3, ...family.extra })
      const finite = () => {
        for (const part of pose.byPath.values()) {
          for (const value of [...part.pose, ...part.scale]) expect(Number.isFinite(value), `${part.path} ${part.pose}`).toBe(true)
        }
      }
      // standing
      for (let i = 0; i < 5; i++) entity.tracker.advance(0.05)
      model.setupAnim(floatState(entity.state(0.3)))
      finite()
      // walking
      for (let i = 0; i < 20; i++) {
        entity.tracker.setInput({ ...entity.input, position: { x: i * 0.2, y: 64, z: 0 }, velocity: { x: 0.2, y: 0, z: 0 } })
        entity.tracker.advance(0.05)
      }
      const state = entity.state(0.6)
      expect(state.walkAnimationSpeed).toBeGreaterThan(0)
      model.setupAnim(floatState(state))
      finite()
    })
  }
})
