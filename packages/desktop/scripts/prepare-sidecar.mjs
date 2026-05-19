#!/usr/bin/env node
/**
 * Make the server sidecar available to Tauri before `tauri dev` /
 * `tauri build` runs:
 *
 *   1. Force `@braidhq/server` to rebuild + rebundle so we don't pick
 *      up a stale bundle from a previous turbo cache.
 *   2. Copy bundle/ into src-tauri/resources/server/ so Tauri ships it
 *      inside the .app bundle.
 *   3. Download the official Node runtime for the current target triple
 *      into src-tauri/binaries/node-<rust-triple>, which Tauri's
 *      `externalBin` config picks up as a sidecar binary.
 *
 * Node version is pinned with NODE_VERSION below. Bump deliberately —
 * the Tauri bundle ships exactly this binary to end users.
 */

import { execSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const NODE_VERSION = '22.21.1'

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, '..')
const repoRoot = resolve(desktopDir, '../..')
const serverBundleDir = resolve(repoRoot, 'packages/server/bundle')
const resourcesDir = resolve(desktopDir, 'src-tauri/resources/server')
const binariesDir = resolve(desktopDir, 'src-tauri/binaries')

/**
 * Tauri sidecar binaries must be named `<base>-<rust-target-triple>`.
 * We derive the triple from the current host so dev builds work; CI
 * cross-platform builds set BRAID_RUST_TARGET to override.
 */
function rustTargetTriple() {
  const explicit = process.env.BRAID_RUST_TARGET
  if (explicit)
    return explicit
  const platform = process.platform
  const arch = process.arch
  if (platform === 'darwin' && arch === 'arm64')
    return 'aarch64-apple-darwin'
  if (platform === 'darwin' && arch === 'x64')
    return 'x86_64-apple-darwin'
  if (platform === 'linux' && arch === 'arm64')
    return 'aarch64-unknown-linux-gnu'
  if (platform === 'linux' && arch === 'x64')
    return 'x86_64-unknown-linux-gnu'
  if (platform === 'win32' && arch === 'x64')
    return 'x86_64-pc-windows-msvc'
  throw new Error(`Unsupported host: ${platform}-${arch}`)
}

/** Map our rust-target-triple back to a nodejs.org distribution URL. */
function nodeDistInfo(triple) {
  switch (triple) {
    case 'aarch64-apple-darwin':
      return { file: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, format: 'tgz', binPath: 'bin/node' }
    case 'x86_64-apple-darwin':
      return { file: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, format: 'tgz', binPath: 'bin/node' }
    case 'aarch64-unknown-linux-gnu':
      return { file: `node-v${NODE_VERSION}-linux-arm64.tar.xz`, format: 'txz', binPath: 'bin/node' }
    case 'x86_64-unknown-linux-gnu':
      return { file: `node-v${NODE_VERSION}-linux-x64.tar.xz`, format: 'txz', binPath: 'bin/node' }
    case 'x86_64-pc-windows-msvc':
      return { file: `node-v${NODE_VERSION}-win-x64.zip`, format: 'zip', binPath: 'node.exe' }
    default:
      throw new Error(`No Node distribution mapping for ${triple}`)
  }
}

function logStep(message) {
  console.log(`[prepare-sidecar] ${message}`)
}

function run(cmd, args, cwd) {
  execSync([cmd, ...args].join(' '), { cwd, stdio: 'inherit' })
}

async function rebuildServerBundle() {
  logStep('rebuilding @braidhq/server bundle')
  // Use the workspace pnpm so the script is invocable as a node call.
  run('pnpm', ['--filter', '@braidhq/server', 'build'], repoRoot)
  run('pnpm', ['--filter', '@braidhq/server', 'bundle'], repoRoot)
}

async function copyBundleToResources() {
  logStep(`copying bundle → ${resourcesDir}`)
  if (existsSync(resourcesDir))
    rmSync(resourcesDir, { recursive: true, force: true })
  mkdirSync(resourcesDir, { recursive: true })
  run('cp', ['-R', `${serverBundleDir}/`, resourcesDir], repoRoot)
}

async function downloadNodeBinary(triple) {
  const targetPath = join(binariesDir, `node-${triple}${triple.includes('windows') ? '.exe' : ''}`)
  if (existsSync(targetPath)) {
    logStep(`node binary already present: ${targetPath}`)
    return
  }

  mkdirSync(binariesDir, { recursive: true })

  const { file, format, binPath } = nodeDistInfo(triple)
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

  run('cp', [sourceBin, targetPath], repoRoot)
  await chmod(targetPath, 0o755)
  await rm(tmpRoot, { recursive: true, force: true })
  logStep(`node binary ready: ${targetPath}`)
}

async function main() {
  const triple = rustTargetTriple()
  await rebuildServerBundle()
  await copyBundleToResources()
  await downloadNodeBinary(triple)
  logStep(`done (target ${triple})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
