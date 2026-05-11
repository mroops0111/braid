import type { FactFragment, IntentFragment } from '@telos/schema'

export interface MergedFragments {
  intents: IntentFragment[]
  facts: FactFragment[]
}

export class FragmentMerger {
  merge(intents: IntentFragment[], facts: FactFragment[]): MergedFragments {
    return { intents: [...intents], facts: [...facts] }
  }
}
