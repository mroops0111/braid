import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Studio is a React UI. JSX presentation is verified visually, so the
      // gate scopes to the pure-logic surface, the transforms and helpers
      // that run without a render. A new logic module joins this list with
      // its test, keeping the same 80% bar the backend packages hold.
      include: [
        'src/lib/brands.ts',
        'src/lib/currentUser.ts',
        'src/lib/errors.ts',
        'src/lib/optional.ts',
        'src/lib/references/mentionQuery.ts',
        'src/lib/references/menuNavigation.ts',
        'src/lib/references/nodeReferenceResolver.ts',
        'src/lib/references/referenceRegistry.ts',
        'src/lib/serverUrl.ts',
        'src/lib/sourceDraft.ts',
        'src/lib/tokenStore.ts',
        'src/lib/utils.ts',
        'src/components/graph/neighborhood.ts',
        'src/components/graph/revealFilters.ts',
        'src/components/references/rehypeReferences.ts',
        'src/components/SkillTranscript/formatArgsPreview.ts',
        'src/components/SkillTranscript/groupTranscript.ts',
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
