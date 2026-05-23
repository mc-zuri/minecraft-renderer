/**
 * Vitest: resolve `require('esbuild-data')` used by shaderCubeBridge (no published package).
 */
import Module from 'node:module'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const setupRequire = createRequire(import.meta.url)
const pkgRoot = path.dirname(setupRequire.resolve('minecraft-data/package.json'))
const tints = setupRequire(path.join(pkgRoot, 'minecraft-data', 'data', 'pc', '1.16.2', 'tints.json'))

const virtualPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/test-shims/esbuild-data-virtual.cjs')
const virtualMod = new Module(virtualPath)
virtualMod.exports = { tints }
;(virtualMod as { loaded?: boolean }).loaded = true
// @ts-expect-error Node require cache
require.cache[virtualPath] = virtualMod

const resolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'esbuild-data') {
    return virtualPath
  }
  return resolveFilename.call(this, request, parent, ...rest)
}
