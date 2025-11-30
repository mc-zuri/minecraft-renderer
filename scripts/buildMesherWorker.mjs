// @ts-check
import { context, build } from 'esbuild'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(new URL(import.meta.url)))
const rootDir = path.join(__dirname, '..')

const watch = process.argv.includes('-w')

// Files that need to be dynamically loaded
const dynamicMcDataFiles = ['blocks', 'blockCollisionShapes', 'biomes', 'version']
const allowedBundleFiles = ['legacy', 'versions', 'protocolVersions', 'features']

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  bundle: true,
  banner: {
    js: `globalThis.global = globalThis;process = {env: {}, versions: {} };`,
  },
  platform: 'browser',
  entryPoints: [path.join(rootDir, './src/mesher/mesher.ts')],
  minify: !watch,
  minifyIdentifiers: false,
  logLevel: 'info',
  drop: !watch ? ['debugger'] : [],
  sourcemap: 'linked',
  target: watch ? undefined : ['ios14'],
  write: false,
  metafile: true,
  outdir: path.join(rootDir, './dist'),
  define: {
    'process.env.BROWSER': '"true"',
  },
  loader: {
    '.png': 'dataurl',
    '.obj': 'text'
  },
  plugins: [
    {
      name: 'external-json',
      setup(build) {
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

        build.onResolve({
          filter: /^esbuild-data$/,
        }, () => {
          return {
            path: 'esbuild-data',
            namespace: 'esbuild-data',
          }
        })

        build.onLoad({
          filter: /.*/,
          namespace: 'esbuild-data',
        }, () => {
          const data = {
            tints: 'require("minecraft-data/minecraft-data/data/pc/1.16.2/tints.json")'
          }
          return {
            contents: `module.exports = {${Object.entries(data).map(([key, code]) => `${key}: ${code}`).join(', ')}}`,
            loader: 'js',
            resolveDir: process.cwd(),
          }
        })

        build.onEnd(({ metafile, outputFiles }) => {
          if (!metafile) return
          fs.mkdirSync(path.join(rootDir, './dist'), { recursive: true })
          fs.writeFileSync(path.join(rootDir, './dist/metafile.json'), JSON.stringify(metafile))
          for (const outputFile of outputFiles ?? []) {
            const writePath = path.join(rootDir, './dist/', path.basename(outputFile.path))
            fs.mkdirSync(path.dirname(writePath), { recursive: true })
            fs.writeFileSync(writePath, outputFile.text)
          }
        })
      }
    },
    polyfillNode(),
  ],
}

if (watch) {
  const ctx = await context(buildOptions)
  await ctx.watch()
} else {
  await build(buildOptions)
}
