import type { FactFragment, IntentFragment, IntentFragmentType } from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { FragmentMerger } from '../../../src/index.js'

function intent(text: string, fragmentType: IntentFragmentType): IntentFragment {
  return {
    kind: 'intent',
    sourceId: 's-intent' as never,
    text,
    location: { uri: `intent:${text}` },
    fragmentType,
  }
}

function fact(text: string, file: string): FactFragment {
  return {
    kind: 'fact',
    sourceId: 's-code' as never,
    text,
    location: { uri: `file://${file}` },
    codeSymbol: { file, symbol: text, language: 'typescript' },
  }
}

describe('FragmentMerger', () => {
  const merger = new FragmentMerger()

  it('returns separate buckets keyed by kind', () => {
    const merged = merger.merge(
      [intent('voidTask is cancellation' as never, 'prd' as IntentFragmentType)],
      [fact('voidTask', 'src/task.ts')],
    )
    expect(merged.intents).toHaveLength(1)
    expect(merged.facts).toHaveLength(1)
  })

  it('preserves order within each bucket', () => {
    const merged = merger.merge(
      [],
      [
        fact('a', 'src/a.ts'),
        fact('b', 'src/b.ts'),
      ],
    )
    expect(merged.facts.map(f => f.codeSymbol?.symbol)).toEqual(['a', 'b'])
  })
})
