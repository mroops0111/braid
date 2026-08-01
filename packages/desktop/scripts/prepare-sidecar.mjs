#!/usr/bin/env node
// Prepare the two things a Tauri build embeds, before dev or build runs.
// The server bundle is a resource, the Node runtime is the sidecar.
// 1. Force `@braidhq/server` to rebuild and rebundle,
//    so a stale turbo cache cannot leak into the installer.
// 2. Copy bundle/ into src-tauri/resources/server/,
//    so Tauri ships it as a resource inside the .app bundle.
// 3. Download the official Node runtime into src-tauri/binaries/,
//    keyed by target triple, where Tauri's externalBin picks up the sidecar.
// Node version is pinned in NODE_VERSION below. Bump it deliberately,
// the Tauri bundle ships exactly this binary to end users.

import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { chmod, cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { nodeDistInfo, rustTargetTriple } from './lib/platform.mjs'

const NODE_VERSION = '22.21.1'

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, '..')
const repoRoot = resolve(desktopDir, '../..')
const serverBundleDir = resolve(repoRoot, 'packages/server/bundle')
const resourcesDir = resolve(desktopDir, 'src-tauri/resources/server')
const binariesDir = resolve(desktopDir, 'src-tauri/binaries')

function currentTriple() {
  return rustTargetTriple({
    platform: process.platform,
    arch: process.arch,
    override: process.env.BRAID_RUST_TARGET,
  })
}

function logStep(message) {
  console.log(`[prepare-sidecar] ${message}`)
}

// Run a child process with array-form args so paths with spaces stay safe,
// and throw if it exits non-zero so failures surface immediately.
function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    const reason = result.error?.message ?? `exit ${result.status ?? 'signal'}`
    throw new Error(`${cmd} ${args.join(' ')} failed: ${reason}`)
  }
}

function rebuildServerBundle() {
  logStep('rebuilding @braidhq/server bundle')
  run('pnpm', ['--filter', '@braidhq/server', 'build'], repoRoot)
  run('pnpm', ['--filter', '@braidhq/server', 'bundle'], repoRoot)
}

async function copyBundleToResources() {
  logStep(`copying bundle into ${resourcesDir}`)
  if (existsSync(resourcesDir))
    rmSync(resourcesDir, { recursive: true, force: true })
  mkdirSync(resourcesDir, { recursive: true })
  await cp(serverBundleDir, resourcesDir, { recursive: true })
}

async function downloadAndExtractNode(triple) {
  const isWindows = triple.includes('windows')
  const targetPath = join(binariesDir, `node-${triple}${isWindows ? '.exe' : ''}`)
  if (existsSync(targetPath)) {
    logStep(`node binary already present: ${targetPath}`)
    return
  }

  mkdirSync(binariesDir, { recursive: true })

  const { file, format, binPath } = nodeDistInfo(triple, NODE_VERSION)
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${file}`
  const tmpRoot = await mkdtemp(join(tmpdir(), 'braid-node-'))
  const archivePath = join(tmpRoot, file)

  logStep(`downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok || !response.body)
    throw new Error(`Failed to download ${url}: ${response.status}`)
  await pipeline(response.body, createWriteStream(archivePath))

  logStep(`extracting ${file}`)
  if (format === 'tgz')
    run('tar', ['-xzf', archivePath, '-C', tmpRoot], repoRoot)
  else if (format === 'txz')
    run('tar', ['-xJf', archivePath, '-C', tmpRoot], repoRoot)
  else if (format === 'zip')
    run('unzip', ['-q', archivePath, '-d', tmpRoot], repoRoot)

  const extractedDirName = file.replace(/\.(tar\.gz|tar\.xz|zip)$/, '')
  const sourceBin = join(tmpRoot, extractedDirName, binPath)
  if (!existsSync(sourceBin))
    throw new Error(`Extraction missing expected binary: ${sourceBin}`)

  await cp(sourceBin, targetPath)
  await chmod(targetPath, 0o755)
  await rm(tmpRoot, { recursive: true, force: true })
  logStep(`node binary ready: ${targetPath}`)
}

async function main() {
  const triple = currentTriple()
  rebuildServerBundle()
  await copyBundleToResources()
  await downloadAndExtractNode(triple)
  logStep(`done (target ${triple})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
