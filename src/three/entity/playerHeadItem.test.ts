import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import * as THREE from 'three'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { SKINVIEW_HEAD_FRAME, buildHumanoidHeadItem, loadEntityModels, setEntityModelsSource } from './exportedEntityModels'
import reference26 from './fixtures/entityReferenceQuads-26.3.json'

vi.mock('../threeJsUtils', () => ({ loadThreeJsTextureFromUrlSync: () => ({ promise: new Promise(() => {}) }) }))

const require = createRequire(import.meta.url)
const mcAssetsDist = path.dirname(require.resolve('mc-assets/dist/entityModels.json'))
setEntityModelsSource({ load: async exportVersion => JSON.parse(fs.readFileSync(path.join(mcAssetsDist, 'entityModels', `${exportVersion}.json`), 'utf8')) })
beforeAll(async () => {
  await loadEntityModels('26.3')
})

type HeadDraw = { label: string; item: string; poses: Record<string, Record<string, { pose: number[] }>>; quads?: Record<string, number[][][]> }

/** Quads of the skinned meshes under an object, in world space. */
const quadsOf = (root: THREE.Object3D) => {
  root.updateMatrixWorld(true)
  const quads: number[][][] = []
  root.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    object.skeleton.update()
    const position = object.geometry.getAttribute('position')
    const uv = object.geometry.getAttribute('uv')
    for (let start = 0; start < position.count; start += 4) {
      const quad: number[][] = []
      for (let i = start; i < start + 4; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(position, i)
        object.applyBoneTransform(i, vertex)
        vertex.applyMatrix4(object.matrixWorld)
        quad.push([vertex.x, vertex.y, vertex.z, uv.getX(i), uv.getY(i)])
      }
      quads.push(quad)
    }
  })
  return quads
}

// the skulls the game's head layer draws on a zombie (HumanoidModel's head: the player model's too), at rest and with
// the head turned; on skinview3d's player (wrapper turned half around and scaled 1/16, the player 16 px up, the skin 8 px
// up, the head at the neck) the same quads must come out. skinview3d's neck is 1.5 blocks up where the game's model is
// moved 1.501 up (EntityModel.MODEL_Y_OFFSET): the quads differ by those 0.001 blocks in y and nothing else
describe('head items on a skinview3d player as the head layer draws them', () => {
  const draws = (reference26 as unknown as { heads: Record<string, HeadDraw[]> }).heads.zombie!.filter(draw => draw.quads)
  test.each(draws.map(draw => [draw.label, draw] as const))('%s', (_label, draw) => {
    const built = buildHumanoidHeadItem('26.3', { name: draw.item, isBlock: true })!
    expect(built).toBeTruthy()
    const wrapper = new THREE.Group()
    wrapper.scale.setScalar(1 / 16)
    wrapper.rotation.y = Math.PI
    const player = new THREE.Group()
    player.position.set(0, 16, 0)
    const skin = new THREE.Group()
    skin.position.y = 8
    const head = new THREE.Group()
    // the game's head rotation in skinview3d's axes: x stays, y and z turn the other way
    const [, , , xRot = 0, yRot = 0, zRot = 0] = Object.values(draw.poses)[0]!['/head']?.pose ?? []
    head.rotation.set(xRot, -yRot, -zRot, 'ZYX')
    const frame = new THREE.Group()
    frame.matrixAutoUpdate = false
    frame.matrix.copy(SKINVIEW_HEAD_FRAME)
    wrapper.add(player)
    player.add(skin)
    skin.add(head)
    head.add(frame)
    frame.add(built.group)
    const actual = quadsOf(wrapper)
    const expected = Object.values(draw.quads!).flat()
    expect(actual.length).toBe(expected.length)
    for (const [q, quad] of expected.entries()) {
      for (const [v, vertex] of quad.entries()) {
        const want = [vertex[0]!, vertex[1]! - 0.001, vertex[2]!, vertex[3]!, vertex[4]!]
        for (let c = 0; c < 5; c++) {
          if (Math.abs(actual[q]![v]![c]! - want[c]!) > 1e-4) throw new Error(`quad ${q} vertex ${v}: ${actual[q]![v]!.join(', ')}, the game draws ${want.join(', ')}`)
        }
      }
    }
  })
})
