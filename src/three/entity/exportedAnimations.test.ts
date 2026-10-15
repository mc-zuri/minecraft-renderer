import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { ExportedEntityAnimator, applyAnimationOffsets, poseName, sampleAnimation, walkTime } from './exportedAnimations'
import { buildExportedEntity, getEntityModelsStore, loadEntityModels, resetExportedPose, setEntityModelsSource, entityModelsVersions } from './exportedEntityModels'
import reference26 from './fixtures/entityReferenceQuads-26.3.json'
import reference1204 from './fixtures/entityReferenceQuads-1.20.4.json'

vi.mock('../threeJsUtils', () => ({ loadThreeJsTextureFromUrlSync: () => ({ promise: new Promise(() => {}) }) }))

const require = createRequire(import.meta.url)
const mcAssetsDist = path.dirname(require.resolve('mc-assets/dist/entityModels.json'))
setEntityModelsSource({ load: async exportVersion => JSON.parse(fs.readFileSync(path.join(mcAssetsDist, 'entityModels', `${exportVersion}.json`), 'utf8')) })
beforeAll(async () => {
  for (const version of entityModelsVersions()) await loadEntityModels(version)
})

type Sample = { millis: number; scale: number; bones: Record<string, number[]> }

// the game's own sampling (KeyframeAnimation.apply, KeyframeAnimations.animate in 1.20.4) of every animation, written
// by the exporter: offsets of parts at rest at times through and past each animation, and at half strength
describe.each([reference26, reference1204] as unknown as Array<{ version: string; animations: Record<string, Sample[]> }>)('animations sample as $version samples them', reference => {
  test.each(Object.keys(reference.animations))('%s', name => {
    const animation = getEntityModelsStore(reference.version)!.getAnimation(reference.version, name)!
    expect(animation).toBeTruthy()
    for (const sample of reference.animations[name]!) {
      const offsets = sampleAnimation(animation, sample.millis, sample.scale)
      for (const [bone, expected] of Object.entries(sample.bones)) {
        const o = offsets.get(bone)!
        const actual = [o[0], o[1], o[2], o[3], o[4], o[5], 1 + o[6]!, 1 + o[7]!, 1 + o[8]!]
        for (let i = 0; i < 9; i++) {
          if (Math.abs(actual[i]! - expected[i]!) > 1e-4) throw new Error(`${bone} at ${sample.millis} ms (scale ${sample.scale}): ${actual.join(', ')}, the game: ${expected.join(', ')}`)
        }
      }
    }
  })
})

describe('what drives the animations', () => {
  test('a walk: the time from the walk position, the strength from the speed', () => {
    expect(walkTime(2, 0.1, 2, 2.5)).toEqual({ millis: 200, scale: Math.fround(0.25) })
    expect(walkTime(2, 1, 2, 2.5).scale).toBe(1)
  })

  test('poses by protocol order', () => {
    expect(poseName(11, '1.19.2')).toBe('SNIFFING')
    expect(poseName(11, '1.20.4')).toBe('ROARING')
    expect(poseName(16, '1.21.4')).toBe('SHOOTING')
    expect(poseName('roaring', '26.3')).toBe('ROARING')
  })

  test('a warden roars when its pose says so, and attacks on entity event 4, which stops the roar', () => {
    const store = getEntityModelsStore('26.3')!
    const warden = ExportedEntityAnimator.create('warden', store, '26.3', 0)!
    warden.update('ROARING', () => undefined, 100)
    expect(warden.states.roar!.start).toBe(100)
    warden.event(4, 300)
    expect(warden.states.roar!.started).toBe(false)
    expect(warden.states.attack!.start).toBe(300)
    // the attack's pose at 100 ms in, added to the rig
    const offsets = warden.sample(400, 0, 0)
    const expected = sampleAnimation(store.getAnimation('26.3', 'WardenAnimation.WARDEN_ATTACK')!, 100)
    for (const [bone, o] of expected) expect([...offsets.get(bone)!]).toEqual([...o])
    const build = buildExportedEntity('26.3', 'warden')!
    resetExportedPose(build.rig)
    const [bone, o] = [...offsets].find(([, values]) => values.some(v => v !== 0))!
    const part = build.rig.parts.get(bone)![0]!
    const before = part.bone.rotation.clone()
    applyAnimationOffsets(build.rig, offsets)
    expect(part.bone.rotation.x).toBeCloseTo(before.x + o[3]!)
  })

  test('a frog shows its croaking body while it croaks', () => {
    const frog = ExportedEntityAnimator.create('frog', getEntityModelsStore('26.3')!, '26.3', 0)!
    frog.update('CROAKING', () => undefined, 0)
    expect(frog.visibility()).toEqual([{ part: 'croaking_body', visible: true }])
    frog.update('STANDING', () => undefined, 10)
    expect(frog.visibility()).toEqual([{ part: 'croaking_body', visible: false }])
    expect(frog.walks).toBe(true)
  })

  test('a bat rests while its flags say so, else flies; versions before the animations have none', () => {
    const bat = ExportedEntityAnimator.create('bat', getEntityModelsStore('26.3')!, '26.3', 0)!
    bat.update(undefined, key => (key === 'flags' ? 1 : undefined), 0)
    bat.sample(10, 0, 0)
    expect(bat.states.rest!.started).toBe(true)
    expect(bat.states.fly!.started).toBe(false)
    expect(ExportedEntityAnimator.create('bat', getEntityModelsStore('1.19.2')!, '1.19.2')).toBeUndefined()
  })

  test('a sniffer digs when its state does, a camel sits down then stays sat', () => {
    const sniffer = ExportedEntityAnimator.create('sniffer', getEntityModelsStore('26.3')!, '26.3', 0)!
    sniffer.update(undefined, key => (key === 'state' ? 5 : undefined), 50)
    expect(sniffer.states.digging!.start).toBe(50)
    const camel = ExportedEntityAnimator.create('camel', getEntityModelsStore('26.3')!, '26.3', 0)!
    camel.update('SITTING', key => (key === 'last_pose_change_tick' ? -100 : undefined), 1000)
    camel.sample(1100, 0, 0)
    expect(camel.states.sit!.started).toBe(true)
    camel.sample(1000 + 41 * 50, 0, 0)
    expect(camel.states.sit!.started).toBe(false)
    expect(camel.states.sitPose!.started).toBe(true)
  })
})
