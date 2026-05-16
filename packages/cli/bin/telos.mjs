#!/usr/bin/env node
import { dirname, resolve } from 'node:path'
// Bin shim. Loads the compiled entry from dist/. Until the build pipeline
// emits dist/ (next phase), `pnpm exec telos` works because pnpm resolves
// the workspace package and we re-route through tsx in dev via `pnpm
// --filter @telos/cli dev`. For a published install, `npm run build`
// against the package will populate dist/main.js.
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
await import(resolve(here, '..', 'dist', 'main.js'))
