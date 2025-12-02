// @ts-check
import { context, build } from 'esbuild'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(new URL(import.meta.url)))
const rootDir = path.join(__dirname, '..')

const watch = process.argv.includes('-w')
const minify = process.argv.includes('--minify')

// Files that need to be dynamically loaded
const dynamicMcDataFiles = ['blocks', 'blockCollisionShapes', 'biomes', 'version']
const allowedBundleFiles = ['legacy', 'versions', 'protocolVersions', 'features']

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  entryPoints: [path.join(rootDir, './src/index.ts')],
  outfile: path.join(rootDir, './dist/minecraft-renderer.js'),
  minify: minify,
  minifyIdentifiers: false,
  logLevel: 'info',
  drop: minify ? ['debugger', 'console'] : [],
  sourcemap: true,
  metafile: true,
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
    'process.env.BROWSER': '"true"',
    'globalThis.includedVersions': '["1.16.4", "1.16.5", "1.18.2", "1.19.4", "1.20.1", "1.21.4"]'
  },
  loader: {
    '.png': 'dataurl',
    '.webp': 'dataurl',
    '.obj': 'text',
    '.json': 'json'
  },
  external: [
    // External dependencies that should not be bundled
    'three',
    'vec3',
    'valtio',
    'minecraft-data',
    'prismarine-*'
  ],
  plugins: [
    {
      name: 'minecraft-data-patch',
      setup(build) {
        // Handle minecraft-data/data.js imports
        build.onLoad({ filter: /minecraft-data[\/\\]data\.js$/ }, () => {
          const VERSION = '1.16.4' // Default version
          const contents = `
            module.exports = {
              'pc': {
                '${VERSION}': {
                  get attributes() { return require("minecraft-data/minecraft-data/data/pc/1.16/attributes.json") },
                  get blocks() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/blocks.json") },
                  get blockCollisionShapes() { return require("minecraft-data/minecraft-data/data/pc/1.16.1/blockCollisionShapes.json") },
                  get biomes() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/biomes.json") },
                  get effects() { return require("minecraft-data/minecraft-data/data/pc/1.16.1/effects.json") },
                  get items() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/items.json") },
                  get enchantments() { return require("minecraft-data/minecraft-data/data/pc/1.16.4/enchantments.json") },
                  get recipes() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/recipes.json") },
                  get instruments() { return require("minecraft-data/minecraft-data/data/pc/1.16.1/instruments.json") },
                  get materials() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/materials.json") },
                  get language() { return require("minecraft-data/minecraft-data/data/pc/1.16.1/language.json") },
                  get entities() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/entities.json") },
                  get protocol() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/protocol.json") },
                  get windows() { return require("minecraft-data/minecraft-data/data/pc/1.16.1/windows.json") },
                  get version() { return require("minecraft-data/minecraft-data/data/pc/1.16.5/version.json") },
                  get foods() { return require("minecraft-data/minecraft-data/data/pc/1.16.1/foods.json") },
                  get particles() { return require("minecraft-data/minecraft-data/data/pc/1.16/particles.json") },
                  get blockLoot() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/blockLoot.json") },
                  get entityLoot() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/entityLoot.json") },
                  get loginPacket() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/loginPacket.json") },
                  get tints() { return require("minecraft-data/minecraft-data/data/pc/1.16.2/tints.json") },
                  get mapIcons() { return require("minecraft-data/minecraft-data/data/pc/1.16/mapIcons.json") },
                  get sounds() { return require("minecraft-data/minecraft-data/data/pc/1.16/sounds.json") }
                }
              }
            }
          `
          return { contents, loader: 'js' }
        })

        // Handle minecraft-data JSON files
        build.onResolve({ filter: /\.json$/ }, args => {
          const fileName = args.path.split('/').pop()?.replace('.json', '') ?? ''
          if (args.resolveDir.includes('minecraft-data')) {
            if (args.path.replaceAll('\\', '/').endsWith('bedrock/common/protocolVersions.json')) {
              return
            }
            if (args.path.includes('bedrock')) {
              return { path: args.path, namespace: 'empty-file' }
            }
            if (dynamicMcDataFiles.includes(fileName)) {
              return {
                path: args.path,
                namespace: 'mc-data',
              }
            }
            if (!allowedBundleFiles.includes(fileName)) {
              return { path: args.path, namespace: 'empty-file' }
            }
          }
        })

        build.onResolve({
          filter: /^zlib$/,
        }, ({ path }) => {
          return {
            path,
            namespace: 'empty-file',
          }
        })

        build.onLoad({
          filter: /.*/,
          namespace: 'empty-file',
        }, () => {
          return { contents: 'module.exports = undefined', loader: 'js' }
        })

        build.onLoad({
          namespace: 'mc-data',
          filter: /.*/,
        }, async ({ path }) => {
          const fileName = path.split(/[\\\/]/).pop()?.replace('.json', '')
          return {
            contents: `module.exports = globalThis.mcData["${fileName}"]`,
            loader: 'js',
            resolveDir: process.cwd(),
          }
        })

        build.onEnd(({ metafile, outputFiles, errors }) => {
          if (errors.length > 0) {
            console.error('Build errors:', errors)
            return
          }

          if (!metafile) return

          // Ensure dist directory exists
          fs.mkdirSync(path.join(rootDir, './dist'), { recursive: true })

          // Write metafile
          fs.writeFileSync(path.join(rootDir, './dist/metafile.json'), JSON.stringify(metafile, null, 2))

          // Write output files
          for (const outputFile of outputFiles ?? []) {
            const writePath = path.join(rootDir, './dist/', path.basename(outputFile.path))
            fs.mkdirSync(path.dirname(writePath), { recursive: true })
            fs.writeFileSync(writePath, outputFile.text)
          }

          console.log('✅ Library built successfully!')
          console.log(`📦 Output: ${path.join(rootDir, './dist/minecraft-renderer.js')}`)

          if (metafile) {
            const bundleSize = Object.values(metafile.outputs)[0]?.bytes
            if (bundleSize) {
              console.log(`📊 Bundle size: ${(bundleSize / 1024).toFixed(1)} KB`)
            }
          }
        })
      }
    },
    polyfillNode({
      // Only polyfill specific modules we need
      globals: {
        process: true,
        Buffer: true,
        global: true,
      },
      polyfills: {
        path: true,
        util: true,
        events: true,
        stream: true,
        buffer: true,
        crypto: true,
      }
    }),
  ],
}

// Build or watch
if (watch) {
  console.log('🔄 Starting watch mode...')
  const ctx = await context(buildOptions)
  await ctx.watch()
  console.log('👀 Watching for changes...')
} else {
  console.log('🔨 Building library...')
  await build(buildOptions)
}
