import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import * as THREE from 'three'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import {
  applyExportedSetupAnim,
  buildExportedEntity,
  entityExportVersionFor,
  entityModelName,
  entityModelsVersions,
  getExportedEntity,
  loadEntityModels,
  resolveExportedEntityName,
  setEntityModelsSource
} from './exportedEntityModels'
import { EntityAnimTracker, entityAnimState, entityEraState, type EntityAnimInput } from './entityAnimState'
import './drivers'

// textures are fetched in the browser; the poses are checked without them
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

/** The releases the client plays: minecraft-data's Java releases from 1.8. */
const playedVersions = (): string[] => require('minecraft-data').supportedVersions.pc.filter((version: string) => /^\d+\.\d+(\.\d+)?$/.test(version) && versionNumber(version) >= versionNumber('1.8'))

// what entities.ts does every frame for an exported entity whose animation code is ported: the client ticking from
// the entity's input, the render state, the state an old export's models read, then the models' setupAnim
/** Mobs that swing their legs walking, under their names in any version. */
const WALKERS = ['pig', 'cow', 'sheep', 'chicken', 'zombie', 'skeleton', 'creeper', 'spider', 'villager', 'wolf', 'horse', 'iron_golem', 'villager_golem', 'polar_bear', 'llama', 'fox', 'goat']

const bonePose = (object: THREE.Object3D) => {
  const out: number[] = []
  object.traverse(child => {
    if (child instanceof THREE.Bone) out.push(child.rotation.x, child.rotation.y, child.rotation.z)
  })
  return out
}

describe('every release animates every entity', () => {
  test.each(playedVersions())('%s: walking, every ported model poses without NaN, and the walkers swing their legs', version => {
    const failed: string[] = []
    const stillWalkers: string[] = []
    let posed = 0
    const names = new Set<string>(require('minecraft-data')(version).entitiesArray.map((e: { name: string }) => entityModelName(e.name)))
    for (const name of names) {
      const exportedName = resolveExportedEntityName(version, name)
      let build
      try {
        build = buildExportedEntity(version, exportedName)
      } catch (err) {
        failed.push(`${name}: build threw ${String(err)}`)
        continue
      }
      if (!build?.rig.anims.length) continue
      const tracker = new EntityAnimTracker(name, version)
      const input: EntityAnimInput = {
        name,
        version,
        meta: {},
        data: {},
        bodyYaw: 0.5,
        headYaw: 0.8,
        pitch: 0.2,
        position: { x: 0, y: 64, z: 0 },
        onGround: true,
        equipment: {},
        entityId: 1,
        renderHints: {},
        isInWater: false,
        gameTime: 1000,
        lookupEntity: () => undefined,
        cameraEyePosition: { x: 0, y: 66, z: 6 }
      }
      const exportVersion = entityExportVersionFor(version, exportedName) ?? version
      const dataNames = (getExportedEntity(version, exportedName) as { dataNames?: Record<string, string> } | undefined)?.dataNames ?? {}
      let walkedFrom: number[] | undefined
      let walkedMost = 0
      try {
        for (let tick = 0; tick < 12; tick++) {
          input.position = { x: tick * 0.15, y: 64, z: 0 }
          tracker.setInput(input)
          tracker.advance(0.05)
          const animState = entityAnimState(tracker, input)
          const modelState = versionNumber(exportVersion) < versionNumber('1.21.2') ? entityEraState(tracker, input, dataNames, animState) : animState
          applyExportedSetupAnim(build.rig, modelState)
          const pose = bonePose(build.object)
          if (tick === 1) walkedFrom = pose
          else if (walkedFrom) walkedMost = Math.max(walkedMost, ...pose.map((value, i) => Math.abs(value - walkedFrom![i]!)))
        }
      } catch (err) {
        failed.push(`${name}: setupAnim threw ${String(err).slice(0, 120)}`)
        continue
      }
      const nan = new Set<string>()
      build.object.traverse(child => {
        if (child instanceof THREE.Bone && [child.position.x, child.position.y, child.position.z, child.rotation.x, child.rotation.y, child.rotation.z, child.scale.x, child.scale.y, child.scale.z].some(Number.isNaN)) nan.add(child.name)
      })
      if (nan.size) failed.push(`${name}: NaN ${[...nan].join(', ')}`)
      if (WALKERS.includes(exportedName) && walkedMost < 0.1) stillWalkers.push(name)
      posed++
    }
    expect(failed).toEqual([])
    expect(stillWalkers).toEqual([])
    expect(posed).toBeGreaterThan(20)
  })
})
