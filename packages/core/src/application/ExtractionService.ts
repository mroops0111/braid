import type { FactFragment, IntentFragment, ProposalDraft, Scope, SourceFragment } from '@telos/schema'
import type { Source } from '../domain/source/Source.js'
import { FragmentMerger, type MergedFragments } from '../domain/source/FragmentMerger.js'

export interface ExtractionRequest {
  scope: Scope
  intentSources: Source[]
  codeSources: Source[]
}

export interface ExtractionServiceDeps {
  fragmentMerger?: FragmentMerger
  synthesize: (merged: MergedFragments) => Promise<ProposalDraft>
}

export class ExtractionService {
  private readonly merger: FragmentMerger

  constructor(private readonly deps: ExtractionServiceDeps) {
    this.merger = deps.fragmentMerger ?? new FragmentMerger()
  }

  async run(request: ExtractionRequest): Promise<ProposalDraft> {
    const intents = (await this.collect(request.intentSources, request.scope))
      .filter((fragment): fragment is IntentFragment => fragment.kind === 'intent')
    const facts = (await this.collect(request.codeSources, request.scope))
      .filter((fragment): fragment is FactFragment => fragment.kind === 'fact')
    const merged = this.merger.merge(intents, facts)
    return this.deps.synthesize(merged)
  }

  private async collect(sources: Source[], scope: Scope): Promise<SourceFragment[]> {
    const collected: SourceFragment[] = []
    for (const source of sources) {
      for await (const fragment of source.fetch({}, scope)) {
        collected.push(fragment)
      }
    }
    return collected
  }
}
