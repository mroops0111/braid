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
        // cac wiring, exercised by running the binary, not unit tests.
        'src/main.ts',
        // Orchestrators over child processes and startServer, verified by hand.
        'src/commands/dev.ts',
        'src/commands/serve.ts',
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
