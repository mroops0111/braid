import type { ProposalDraft, SkillId } from '@telos/schema'
import { describe, expect, it, vi } from 'vitest'
import { ExtractionService } from '../../src/index.js'
import {
  fakeFactFragment,
  fakeIntentFragment,
  FakeSource,
  sourceIdCode,
  sourceIdIntent,
} from '../fakes/FakeSource.js'

describe('ExtractionService', () => {
  it('routes intent fragments to intents bucket, code fragments to facts bucket', async () => {
    const synthesize = vi.fn(async (merged): Promise<ProposalDraft> => ({
      operations: [],
      generatedBy: 'extract' as SkillId,
      rationale: `intents:${merged.intents.length} facts:${merged.facts.length}`,
    }))

    const service = new ExtractionService({ synthesize })

    const intentSource = new FakeSource(sourceIdIntent, 'intent', [
      fakeIntentFragment('user voids a task', sourceIdIntent),
    ])
    const codeSource = new FakeSource(sourceIdCode, 'code', [
      fakeFactFragment('voidTask', sourceIdCode),
      fakeFactFragment('cancelTask', sourceIdCode),
    ])

    const draft = await service.run({
      scope: { tokens: [], pathGlobs: [] },
      intentSources: [intentSource],
      codeSources: [codeSource],
    })

    expect(synthesize).toHaveBeenCalledOnce()
    expect(draft.rationale).toBe('intents:1 facts:2')
  })

  it('discards mismatched fragment kinds returned by a source', async () => {
    const synthesize = vi.fn(async (merged): Promise<ProposalDraft> => ({
      operations: [],
      generatedBy: 'extract' as SkillId,
      rationale: `intents:${merged.intents.length} facts:${merged.facts.length}`,
    }))

    const service = new ExtractionService({ synthesize })

    // intent source mistakenly yields a fact fragment — should be filtered
    const intentSource = new FakeSource(sourceIdIntent, 'intent', [
      fakeFactFragment('not-an-intent', sourceIdIntent),
    ])

    const draft = await service.run({
      scope: { tokens: [], pathGlobs: [] },
      intentSources: [intentSource],
      codeSources: [],
    })

    expect(draft.rationale).toBe('intents:0 facts:0')
  })

  it('handles empty source lists gracefully', async () => {
    const synthesize = vi.fn(async (): Promise<ProposalDraft> => ({
      operations: [],
      generatedBy: 'extract' as SkillId,
      rationale: 'noop',
    }))

    const service = new ExtractionService({ synthesize })
    const draft = await service.run({
      scope: { tokens: [], pathGlobs: [] },
      intentSources: [],
      codeSources: [],
    })

    expect(draft.rationale).toBe('noop')
  })
})
