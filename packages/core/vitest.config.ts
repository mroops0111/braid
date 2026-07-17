import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        // Barrels re-export only, no logic to cover.
        'src/index.ts',
        'src/in-memory.ts',
        // Type-only contracts compile to nothing, v8 reports 0% with no meaning.
        'src/**/*Repository.ts',
        'src/domain/plugin/Plugin.ts',
        // Orchestrators owned by the server layer, exercised end to end by
        // @braidhq/server route and integration tests, not core unit tests.
        'src/application/HistoryService.ts',
        'src/application/ModelService.ts',
        'src/application/SourceLoaderRunner.ts',
        // Thin platform adapters, unit-testing them would test the platform.
        'src/infrastructure/SystemClock.ts',
        'src/infrastructure/SystemScheduler.ts',
        'src/infrastructure/logger.ts',
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
