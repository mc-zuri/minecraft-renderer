import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import * as THREE from 'three'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { composeEntityLook } from 'mc-assets/dist/entityModels'
import { buildExportedEntity, entityModelsVersions, getExportedEntity, loadEntityModels, setEntityModelsSource } from './exportedEntityModels'
import { legacyArrowQuads } from './legacyArrow'

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

describe('arrows before 1.21.2', () => {
  test("ArrowRenderer's quads: facing north, 0.9 long along z from 4 pixels behind the tip, the cross 45 degrees turned", () => {
    const quads = legacyArrowQuads()
    expect(quads).toHaveLength(6)
    const zs = quads.flat().map(([, , z]) => z!)
    expect(Math.min(...zs)).toBeCloseTo(-0.225, 5)
    expect(Math.max(...zs)).toBeCloseTo(0.675, 5)
    // the four 16 x 4 quads are two crossed planes, their edges 2 pixels out at 45 degrees (as 1.21.2's ArrowModel has them)
    for (const quad of quads.slice(2)) for (const [x, y] of quad) expect(Math.abs(Math.abs(x!) - 0.0795)).toBeLessThan(0.001), expect(Math.abs(Math.abs(y!) - 0.0795)).toBeLessThan(0.001)
  })

  test.each(entityModelsVersions().filter(version => versionNumber(version) < versionNumber('1.21.2')))('%s: arrows draw the quads with the export\'s texture', version => {
    for (const name of ['arrow', 'spectral_arrow']) {
      const entity = getExportedEntity(version, name)
      if (!entity) continue
      const entry = composeEntityLook(entity)[0]!.entry as { type: string; texture: string }
      expect(entry.type).toBe('custom')
      const build = buildExportedEntity(version, name)!
      const mesh = build.object.getObjectByName('legacy_arrow') as THREE.Mesh
      expect(mesh, `${version} ${name}`).toBeTruthy()
      expect(mesh.geometry.getAttribute('position').count).toBe(24)
    }
    expect((composeEntityLook(getExportedEntity(version, 'arrow')!)[0]!.entry as { texture: string }).texture).toBe(versionNumber(version) < versionNumber('1.9') ? 'minecraft:entity/arrow' : 'minecraft:entity/projectiles/arrow')
  })
})
