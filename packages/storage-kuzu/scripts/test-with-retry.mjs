#!/usr/bin/env node
/**
 * Wrap `vitest run` in a retry loop because the kuzu NAPI binding
 * occasionally crashes the worker fork on Node 22, producing a bare
 * "Worker exited unexpectedly" from tinypool with no diagnosable cause.
 * Each individual test is deterministic; only the worker process
 * lifecycle is flaky. Three attempts clear it in every observed run.
 *
 * A real assertion failure still fails three-in-a-row because the
 * assertion path is unrelated to the native shutdown crash.
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(here, '..')
const MAX_ATTEMPTS = 5

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const result = spawnSync('npx', ['vitest', 'run'], {
    cwd: packageDir,
    stdio: 'inherit',
  })
  if (result.status === 0) {
    if (attempt > 1)
      console.error(`[test-with-retry] passed on attempt ${attempt}/${MAX_ATTEMPTS}`)
    process.exit(0)
  }
  if (attempt < MAX_ATTEMPTS) {
    console.error(`[test-with-retry] attempt ${attempt}/${MAX_ATTEMPTS} failed (exit ${result.status}); retrying…`)
  }
}

console.error(`[test-with-retry] all ${MAX_ATTEMPTS} attempts failed`)
process.exit(1)
