// @ts-check
import { context, build } from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'
import { createWorkerBuildOptions } from './buildWorkerShared.mjs'
import { dynamicMcDataFiles } from '../src/lib/buildSharedConfig.mjs'

const __dirname = path.dirname(fileURLToPath(new URL(import.meta.url)))
const rootDir = path.join(__dirname, '..')

const watch = process.argv.includes('-w')

// Mesher worker mc-data files
const mesherMcData = [...Object.keys(dynamicMcDataFiles), 'version']

const buildOptions = createWorkerBuildOptions({
  entryPoint: path.join(rootDir, './src/mesher/mesher.ts'),
  bundleMcData: mesherMcData,
  watch,
  esbuildOptions: {}
})

if (watch) {
  const ctx = await context(buildOptions)
  await ctx.watch()
} else {
  await build(buildOptions)
}
