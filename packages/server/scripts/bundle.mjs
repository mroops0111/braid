#!/usr/bin/env node
/**
 * Produce a self-contained server bundle for the Tauri desktop shell.
 *
 * - esbuild bundles dist/server.js into bundle/server.mjs (kuzu external)
 * - kuzu's JS dispatcher + the platform-specific .node binary are copied
 *   to bundle/node_modules/kuzu/ so the require('kuzu') call inside the
 *   bundle resolves at runtime.
 *
 * The bundle is invoked with `node bundle/server.mjs`. The desktop shell
 * provides the Node runtime as a Tauri sidecar binary.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(here, '..')
const bundleDir = resolve(packageDir, 'bundle')
const require = createRequire(import.meta.url)

function targetTriple() {
  const explicit = process.env.BRAID_BUNDLE_TARGET
  if (explicit)
    return explicit
  const platform = process.platform
  const arch = process.arch
  if (platform === 'darwin' && arch === 'arm64')
    return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64')
    return 'darwin-x64'
  if (platform === 'linux' && arch === 'arm64')
    return 'linux-arm64'
  if (platform === 'linux' && arch === 'x64')
    return 'linux-x64'
  if (platform === 'win32' && arch === 'x64')
    return 'win32-x64'
  throw new Error(`Unsupported bundle target: ${platform}-${arch}`)
}

async function bundleServer() {
  const entry = resolve(packageDir, 'dist/server.js')
  if (!existsSync(entry))
    throw new Error(`Server build missing — run \`pnpm build\` first (looked for ${entry}).`)

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: join(bundleDir, 'server.mjs'),
    external: ['kuzu'],
    banner: {
      // CommonJS shims for the few node_modules that still use `require`
      // at module-eval time after being bundled into ESM output.
      js: 'import { createRequire as __braidCreateRequire } from \'node:module\'; const require = __braidCreateRequire(import.meta.url);',
    },
    legalComments: 'none',
    minify: false,
  })
}

async function copyKuzuRuntime() {
  // kuzu is a transitive dep via @braidhq/storage-kuzu (which doesn't
  // expose package.json through its `exports` field). Anchor the resolve
  // on a file storage-kuzu does export and re-resolve kuzu from there.
  const storageKuzuMain = require.resolve('@braidhq/storage-kuzu')
  const storageKuzuRequire = createRequire(storageKuzuMain)
  const kuzuMain = storageKuzuRequire.resolve('kuzu')
  const kuzuDir = dirname(kuzuMain)
  const target = join(bundleDir, 'node_modules/kuzu')
  mkdirSync(target, { recursive: true })

  // Ship only the JS dispatcher + platform-specific .node, not the
  // ~95 MB prebuilt/ folder that bundles every platform.
  const triple = targetTriple()
  const prebuiltName = `kuzujs-${triple}.node`
  const prebuiltPath = join(kuzuDir, 'prebuilt', prebuiltName)
  if (!existsSync(prebuiltPath))
    throw new Error(`Missing kuzu prebuilt for ${triple}: ${prebuiltPath}`)

  for (const file of readdirSync(kuzuDir)) {
    if (file === 'prebuilt' || file === 'kuzu-source' || file === 'node_modules')
      continue
    const src = join(kuzuDir, file)
    const dest = join(target, file)
    if (statSync(src).isDirectory())
      continue
    // Replace the platform symlink kuzujs.node with the resolved binary.
    if (file === 'kuzujs.node')
      continue
    await cp(src, dest)
  }

  // Drop the resolved native binding next to the JS files.
  await cp(prebuiltPath, join(target, 'kuzujs.node'))

  // Minimal package.json so `require('kuzu')` resolves to index.js.
  const pkgJson = JSON.parse(await readFile(join(kuzuDir, 'package.json'), 'utf8'))
  const trimmed = {
    name: pkgJson.name,
    version: pkgJson.version,
    main: pkgJson.main ?? 'index.js',
    type: pkgJson.type ?? 'commonjs',
  }
  await writeFile(join(target, 'package.json'), `${JSON.stringify(trimmed, null, 2)}\n`)
}

async function main() {
  if (existsSync(bundleDir))
    rmSync(bundleDir, { recursive: true, force: true })
  mkdirSync(bundleDir, { recursive: true })

  await bundleServer()
  await copyKuzuRuntime()

  console.log(`[bundle] ready: ${bundleDir} (target: ${targetTriple()})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
