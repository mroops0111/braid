#!/usr/bin/env node
// Produce a self-contained server bundle for the Tauri desktop shell.
// 1. esbuild bundles dist/server.js into bundle/server.mjs, kuzu external.
// 2. The platform kuzu .node, the kuzu JS dispatcher,
//    and a trimmed package.json land in bundle/node_modules/kuzu/,
//    so require('kuzu') inside the bundle resolves at runtime.
// The bundle runs standalone with `node bundle/server.mjs`.
// In the desktop app it is a Tauri resource,
// run by the Node sidecar that prepare-sidecar downloads.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { targetTriple } from './lib/triple.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(here, '..')
const bundleDir = resolve(packageDir, 'bundle')
const require = createRequire(import.meta.url)

function currentTriple() {
  return targetTriple({
    platform: process.platform,
    arch: process.arch,
    override: process.env.BRAID_BUNDLE_TARGET,
  })
}

async function bundleServerJs() {
  const entry = resolve(packageDir, 'dist/server.js')
  if (!existsSync(entry))
    throw new Error(`Server build missing. Run \`pnpm build\` first (looked for ${entry}).`)

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: join(bundleDir, 'server.mjs'),
    external: ['kuzu'],
    banner: {
      // CommonJS shim. Bundled CJS deps (pino/thread-stream) reference
      // `require`, `__dirname`, and `__filename` at module-eval time,
      // none of which exist in ESM output without these definitions.
      js: [
        'import { createRequire as __braidCreateRequire } from \'node:module\';',
        'import { fileURLToPath as __braidFileURLToPath } from \'node:url\';',
        'import { dirname as __braidDirname } from \'node:path\';',
        'const require = __braidCreateRequire(import.meta.url);',
        'const __filename = __braidFileURLToPath(import.meta.url);',
        'const __dirname = __braidDirname(__filename);',
      ].join(' '),
    },
    legalComments: 'none',
    minify: false,
  })
}

function resolveKuzuDir() {
  // kuzu is a transitive dep via @braidhq/storage-kuzu, whose `exports`
  // field does not re-export package.json. Anchor on a file storage-kuzu
  // does export and re-resolve kuzu from there.
  const storageKuzuMain = require.resolve('@braidhq/storage-kuzu')
  const storageKuzuRequire = createRequire(storageKuzuMain)
  const kuzuMain = storageKuzuRequire.resolve('kuzu')
  return dirname(kuzuMain)
}

function kuzuFilesToCopy(kuzuDir) {
  const skipped = new Set(['prebuilt', 'kuzu-source', 'node_modules', 'kuzujs.node'])
  return readdirSync(kuzuDir).filter((file) => {
    if (skipped.has(file))
      return false
    return !statSync(join(kuzuDir, file)).isDirectory()
  })
}

async function copyKuzuJsFiles(kuzuDir, targetDir) {
  for (const file of kuzuFilesToCopy(kuzuDir))
    await cp(join(kuzuDir, file), join(targetDir, file))
}

async function copyKuzuNativeBinding(kuzuDir, targetDir, triple) {
  const prebuiltPath = join(kuzuDir, 'prebuilt', `kuzujs-${triple}.node`)
  if (!existsSync(prebuiltPath))
    throw new Error(`Missing kuzu prebuilt for ${triple}: ${prebuiltPath}`)
  await cp(prebuiltPath, join(targetDir, 'kuzujs.node'))
}

async function writeTrimmedKuzuManifest(kuzuDir, targetDir) {
  const pkgJson = JSON.parse(await readFile(join(kuzuDir, 'package.json'), 'utf8'))
  const trimmed = {
    name: pkgJson.name,
    version: pkgJson.version,
    main: pkgJson.main ?? 'index.js',
    type: pkgJson.type ?? 'commonjs',
  }
  await writeFile(join(targetDir, 'package.json'), `${JSON.stringify(trimmed, null, 2)}\n`)
}

async function copyKuzuRuntime(triple) {
  const kuzuDir = resolveKuzuDir()
  const targetDir = join(bundleDir, 'node_modules/kuzu')
  mkdirSync(targetDir, { recursive: true })
  await copyKuzuJsFiles(kuzuDir, targetDir)
  await copyKuzuNativeBinding(kuzuDir, targetDir, triple)
  await writeTrimmedKuzuManifest(kuzuDir, targetDir)
}

/**
 * Skill prompts are read from disk at run time,
 * so the bundle has to carry them. Each package gets its own directory,
 * because more than one ships a `shared/` and a flat copy would lose one of them.
 */
async function copySkills() {
  const packages = [
    ['core', resolve(packageDir, '../core/skills')],
    ['ontology-ddd', resolve(packageDir, '../ontology-ddd/skills')],
  ]
  for (const [name, source] of packages) {
    if (!existsSync(source))
      throw new Error(`[bundle] missing skills for ${name}: ${source}`)
    await cp(source, join(bundleDir, 'skills', name), { recursive: true })
  }
}

async function main() {
  const triple = currentTriple()
  if (existsSync(bundleDir))
    rmSync(bundleDir, { recursive: true, force: true })
  mkdirSync(bundleDir, { recursive: true })

  await bundleServerJs()
  await copyKuzuRuntime(triple)
  await copySkills()

  console.log(`[bundle] ready: ${bundleDir} (target: ${triple})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
