import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['scripts/**/*.mjs'],
      exclude: [
        // Network download, fs, and spawn orchestration.
        // Exercised end-to-end by builds, not unit-tested.
        'scripts/prepare-sidecar.mjs',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
})
