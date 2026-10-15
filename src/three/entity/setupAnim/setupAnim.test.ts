import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { createRequire } from 'module'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { EntityModelPart } from 'mc-assets/dist/entityModels'
import { getEntityModelsStore, loadEntityModels, setEntityModelsSource } from '../exportedEntityModels'
import { ANIM_MODELS, ModelPose, animContext, floatState } from './index'

vi.mock('../../threeJsUtils', () => ({ loadThreeJsTextureFromUrlSync: () => ({ promise: new Promise(() => {}) }) }))

const require = createRequire(import.meta.url)
const mcAssetsDist = path.dirname(require.resolve('mc-assets/dist/entityModels.json'))
setEntityModelsSource({ load: async exportVersion => JSON.parse(fs.readFileSync(path.join(mcAssetsDist, 'entityModels', `${exportVersion}.json`), 'utf8')) })

type Sample = { in: Record<string, unknown>; out: { poses: Record<string, number[]>; hidden?: string[]; shown?: string[]; skipDraw?: string[]; drawn?: string[] } }
type Sampled = {
  modelClass: string
  stateClass: string
  layer: string
  part?: string
  entities: string[]
  base: Record<string, unknown>
  initial?: { hidden?: string[]; skipDraw?: string[] }
  samples: Sample[]
}
type Fixture = { version: string; models: Record<string, Sampled> }

// what setupAnim made of varied render states in the game, per model class and layer (minecraft-model-generator's
// setupAnimSamples.json, gzipped): the port has to pose every part as the game did
const fixturesDir = path.join(__dirname, '..', 'fixtures')
const fixtures: Fixture[] = fs
  .readdirSync(fixturesDir)
  .filter(name => /^setupAnimSamples-.*\.json\.gz$/.test(name))
  .map(name => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixturesDir, name))).toString()) as Fixture)

beforeAll(async () => {
  for (const fixture of fixtures) await loadEntityModels(fixture.version)
})

const descend = (root: EntityModelPart, part: string | undefined) => {
  let current = root
  for (const name of (part ?? '').split('/').filter(Boolean)) current = current.children![name]!
  return current
}

/** Runs the port on every sample; returns the differences, at most a few per model. */
export function checkSampled(version: string, sampled: Sampled, limit = 6): string[] {
  const store = getEntityModelsStore(version)!
  const layer = store.getModel(version, sampled.layer)
  if (!layer) return [`no layer ${sampled.layer}`]
  const pose = new ModelPose(descend(layer.root, sampled.part))
  const context = animContext(version, name => store.getAnimation(version, name))
  const Port = ANIM_MODELS[sampled.modelClass]!
  const model = new Port(pose, context)
  const hidden = new Set(sampled.initial?.hidden ?? [])
  const skipped = new Set(sampled.initial?.skipDraw ?? [])
  const problems: string[] = []
  for (const [index, sample] of sampled.samples.entries()) {
    for (const part of pose.byPath.values()) {
      part.visible = !hidden.has(part.path)
      part.skipDraw = skipped.has(part.path)
    }
    try {
      model.setupAnim(floatState({ ...sampled.base, ...sample.in }))
    } catch (err) {
      problems.push(`sample ${index} ${JSON.stringify(sample.in)}: ${(err as Error).stack}`)
      if (problems.length >= limit) break
      continue
    }
    const wrong: string[] = []
    for (const part of pose.byPath.values()) {
      // a moved part's pose, its scale when not 1; an unmoved part keeps its initial pose
      const moved = sample.out.poses[part.path]
      const want = moved
        ? moved.length === 6
          ? [...moved, 1, 1, 1]
          : moved
        : [0, 1, 2, 3, 4, 5].map(i => part.initial[i] ?? 0).concat([0, 1, 2].map(i => part.initialScale[i] ?? 1))
      const actual = [...part.pose, ...part.scale]
      if (want.some((value, i) => Math.abs(value - actual[i]!) > 1e-5 + 1e-6 * Math.abs(value))) {
        wrong.push(`${part.path || '<root>'}: ${actual.map(v => +v.toFixed(6)).join(', ')} vs game ${want.join(', ')}`)
      }
      const visible = sample.out.hidden?.includes(part.path) ? false : sample.out.shown?.includes(part.path) ? true : !hidden.has(part.path)
      if (part.visible !== visible) wrong.push(`${part.path || '<root>'}: visible ${part.visible} vs game ${visible}`)
      const skipDraw = sample.out.skipDraw?.includes(part.path) ? true : sample.out.drawn?.includes(part.path) ? false : skipped.has(part.path)
      if (part.skipDraw !== skipDraw) wrong.push(`${part.path || '<root>'}: skipDraw ${part.skipDraw} vs game ${skipDraw}`)
    }
    if (wrong.length) {
      problems.push(`sample ${index} ${JSON.stringify(sample.in)}:\n    ${wrong.join('\n    ')}`)
      if (problems.length >= limit) break
    }
  }
  return problems
}

for (const fixture of fixtures) {
  describe(`setupAnim of ${fixture.version}`, () => {
    const byClass = new Map<string, Sampled[]>()
    for (const sampled of Object.values(fixture.models)) {
      if (!byClass.has(sampled.modelClass)) byClass.set(sampled.modelClass, [])
      byClass.get(sampled.modelClass)!.push(sampled)
    }
    for (const [modelClass, sampledList] of [...byClass].sort(([a], [b]) => a.localeCompare(b))) {
      if (!ANIM_MODELS[modelClass]) {
        test.todo(`${modelClass} (${sampledList.flatMap(s => s.entities).join(', ')})`)
        continue
      }
      test(`${modelClass} poses as the game (${sampledList.reduce((n, s) => n + s.samples.length, 0)} samples)`, () => {
        const problems = sampledList.flatMap(sampled => checkSampled(fixture.version, sampled).map(problem => `${sampled.layer}${sampled.part ?? ''}: ${problem}`))
        expect(problems.slice(0, 8).join('\n')).toBe('')
      })
    }
  })
}
