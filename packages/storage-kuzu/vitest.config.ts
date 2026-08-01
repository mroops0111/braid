import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Kuzu's NAPI binding doesn't survive vitest's default worker-thread
    // pool under CI memory pressure, workers die mid-test with a bare
    // "Worker exited unexpectedly". Run each test file in a single
    // forked process so the native module gets a clean address space.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        // Barrel re-exports only, no logic to cover.
        'src/index.ts',
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
