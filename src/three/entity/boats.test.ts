import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import * as THREE from 'three'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { applyBoatRock, applyExportedSetupAnim, buildExportedEntity, loadEntityModels, setEntityModelsSource } from './exportedEntityModels'
import { animContext, floatState } from './setupAnim'
import { EntityAnimTracker, entityAnimState, registerEntityDrivers } from './entityAnimState'
import { BOATS_DRIVERS } from './drivers/boats'
import reference26 from './fixtures/entityReferenceQuads-26.3.json'
import reference1204 from './fixtures/entityReferenceQuads-1.20.4.json'

vi.mock('../threeJsUtils', () => ({ loadThreeJsTextureFromUrlSync: () => ({ promise: new Promise(() => {}) }) }))

const require = createRequire(import.meta.url)
const mcAssetsDist = path.dirname(require.resolve('mc-assets/dist/entityModels.json'))
setEntityModelsSource({ load: async exportVersion => JSON.parse(fs.readFileSync(path.join(mcAssetsDist, 'entityModels', `${exportVersion}.json`), 'utf8')) })
beforeAll(async () => {
  await loadEntityModels('26.3')
  await loadEntityModels('1.20.4')
})

type BoatDraw = { state: number[]; entries: Record<string, number[][][]> }

/** The quads of every model entry of the build, in entity space, by entry order. */
const entryQuads = (object: THREE.Object3D) => {
  object.updateMatrixWorld(true)
  return object.children
    .filter(child => (child.name.startsWith('exported_') || child.name === 'boat_water_patch') && child.visible)
    .map(holder => {
      const quads: number[][][] = []
      holder.traverse(mesh => {
        if (!(mesh instanceof THREE.SkinnedMesh)) return
        mesh.skeleton.update()
        const position = mesh.geometry.getAttribute('position')
        const uv = mesh.geometry.getAttribute('uv')
        for (let start = 0; start < position.count; start += 4) {
          const quad: number[][] = []
          for (let i = start; i < start + 4; i++) {
            const vertex = new THREE.Vector3().fromBufferAttribute(position, i)
            mesh.applyBoneTransform(i, vertex)
            vertex.applyMatrix4(mesh.matrixWorld)
            quad.push([vertex.x, vertex.y, vertex.z, uv.getX(i), uv.getY(i)])
          }
          quads.push(quad)
        }
      })
      return quads
    })
}

// BoatRenderer's draws of boats (and a raft) for render states of several yaws, hurt wobbles, bubble column rocking and
// rowing times (the exporter's referenceQuads.json): the exported boat, turned by the entity's yaw as the scene turns
// every entity, rocked by applyBoatRock and its paddles posed by the ported BoatModel, draws the same quads
describe.each(Object.entries((reference26 as unknown as { boats: Record<string, BoatDraw[]> }).boats))('%s as BoatRenderer draws it', (name, draws) => {
  test.each(draws.map(draw => [draw.state.join(', '), draw] as const))('yRot, hurt, damage, dir, bubble, under water, rowing left, right: %s', (_label, draw) => {
    const build = buildExportedEntity('26.3', name)!
    expect(build.rig.anims.length).toBeGreaterThan(0)
    const [yRot, hurtTime, damageTime, hurtDir, bubbleAngle, isUnderWater, rowingTimeLeft, rowingTimeRight] = draw.state as [number, number, number, number, number, number, number, number]
    const state = floatState({ yRot, hurtTime, damageTime, hurtDir, bubbleAngle, isUnderWater: isUnderWater !== 0, rowingTimeLeft, rowingTimeRight, ageInTicks: 0 })
    applyExportedSetupAnim(build.rig, state)
    applyBoatRock(build.rig, state, animContext('26.3').sin)
    // the scene turns an entity by its prismarine yaw: PI - yRot (the game's 180 - yRot degrees)
    build.object.rotation.y = THREE.MathUtils.degToRad(180 - yRot)
    if (!isUnderWater && build.object.userData.boatWaterPatch) build.object.userData.boatWaterPatch.visible = true
    const actual = entryQuads(build.object)
    const expected = Object.values(draw.entries)
    expect(actual.length).toBe(expected.length)
    for (const [e, quads] of expected.entries()) {
      expect(actual[e]!.length).toBe(quads.length)
      const water = Object.keys(draw.entries)[e]!.includes('water_patch')
      for (const [q, quad] of quads.entries()) {
        for (const [v, vertex] of quad.entries()) {
          for (let c = 0; c < (water ? 3 : 5); c++) {
            if (!(Math.abs(actual[e]![q]![v]![c]! - vertex[c]!) <= 1e-4)) throw new Error(`${Object.keys(draw.entries)[e]} quad ${q} vertex ${v}: ${actual[e]![q]![v]!.join(', ')}, the game draws ${vertex.join(', ')}`)
          }
        }
      }
    }
  })
})

// 1.20.4 (models posed from the entity): the boat's paddles row by Boat.getRowingTime with the player controlling it
// (the renderer passes the partial tick, 0 here, as setupAnim's first argument), the same rocking
describe.each(Object.entries((reference1204 as unknown as { boats: Record<string, BoatDraw[]> }).boats))('1.20.4 %s as BoatRenderer draws it', (name, draws) => {
  test.each(draws.map(draw => [draw.state.join(', '), draw] as const))('yRot, hurt, damage, dir, bubble, paddles, positions: %s', (_label, draw) => {
    const build = buildExportedEntity('1.20.4', name)!
    expect(build.rig.anims.length).toBeGreaterThan(0)
    const [yRot, hurtTime, damage, hurtDir, bubbleAngle, paddleLeft, paddleRight, positionLeft, positionRight] = draw.state as number[]
    const dataNames = (build as unknown as { dataNames?: Record<string, string> }).dataNames ?? Object.fromEntries(Object.entries(require('mc-assets/dist/entityModels/1.20.4.json').entities.latest[name].dataNames ?? {}))
    const index = (key: string) => Object.entries(dataNames).find(([, value]) => value === key)![0]
    const modelState = floatState({
      walkAnimationPos: 0,
      walkAnimationSpeed: 0,
      ageInTicks: -0.1,
      yRot: 0,
      xRot: 0,
      partialTick: 0,
      dataNames,
      [`data.${index('id_paddle_left')}`]: paddleLeft !== 0,
      [`data.${index('id_paddle_right')}`]: paddleRight !== 0,
      'entity.paddlePositions': [positionLeft, positionRight]
    })
    applyExportedSetupAnim(build.rig, modelState)
    applyBoatRock(build.rig, floatState({ hurtTime: hurtTime!, damageTime: damage!, hurtDir: hurtDir!, bubbleAngle: bubbleAngle!, isUnderWater: false }), animContext('1.20.4').sin)
    build.object.rotation.y = THREE.MathUtils.degToRad(180 - yRot!)
    if (build.object.userData.boatWaterPatch) build.object.userData.boatWaterPatch.visible = true
    const actual = entryQuads(build.object)
    const expected = Object.values(draw.entries)
    expect(actual.length).toBe(expected.length)
    for (const [e, quads] of expected.entries()) {
      expect(actual[e]!.length).toBe(quads.length)
      const water = Object.keys(draw.entries)[e]!.includes('water_patch')
      for (const [q, quad] of quads.entries()) {
        for (const [v, vertex] of quad.entries()) {
          for (let c = 0; c < (water ? 3 : 5); c++) {
            if (!(Math.abs(actual[e]![q]![v]![c]! - vertex[c]!) <= 1e-4)) throw new Error(`${Object.keys(draw.entries)[e]} quad ${q} vertex ${v}: ${actual[e]![q]![v]!.join(', ')}, the game draws ${vertex.join(', ')}`)
          }
        }
      }
    }
  })
})

describe('what drives a boat', () => {
  registerEntityDrivers(BOATS_DRIVERS)
  const input = (paddleLeft: boolean, paddleRight: boolean, meta: Record<string, unknown> = {}) => ({
    name: 'oak_boat',
    version: '26.3',
    meta,
    data: {},
    bodyYaw: 0,
    headYaw: 0,
    pitch: 0,
    renderHints: { boatPaddleLeft: paddleLeft, boatPaddleRight: paddleRight }
  })

  test('paddles turn PI/8 a tick while paddled, the rowing time lerps over the frame, and stop at 0', () => {
    const tracker = new EntityAnimTracker('oak_boat', '26.3')
    tracker.setInput(input(true, false))
    for (let i = 0; i < 3; i++) tracker.tick()
    const state = entityAnimState(tracker, input(true, false))
    const step = Math.fround(Math.PI / 8)
    // three ticks: 3 * PI/8; at partial tick 0 the game is one step behind (clampedLerp from position - PI/8)
    expect(state.rowingTimeLeft).toBeCloseTo(2 * step, 6)
    expect(state.rowingTimeRight).toBe(0)
    tracker.setInput(input(false, false))
    tracker.tick()
    expect(entityAnimState(tracker, input(false, false)).rowingTimeLeft).toBe(0)
  })

  test('the hurt wobble counts the synched hurt time and damage down every tick like the client', () => {
    const tracker = new EntityAnimTracker('oak_boat', '26.3')
    tracker.setInput(input(false, false, { hurt: 10, damage: 20, hurtdir: -1 }))
    tracker.tick()
    tracker.tick()
    const state = entityAnimState(tracker, input(false, false, { hurt: 10, damage: 20, hurtdir: -1 }))
    expect(state.hurtTime).toBe(9)
    expect(state.damageTime).toBe(19)
    expect(state.hurtDir).toBe(-1)
  })
})
