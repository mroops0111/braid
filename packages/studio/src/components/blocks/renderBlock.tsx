import type { RenderBlock } from '@braidhq/schema'
import type { ReactElement } from 'react'
import { ShowAnswerBlock } from './ShowAnswerBlock'
import { ShowDiagramBlock } from './ShowDiagramBlock'
import { ShowEvidenceBlock } from './ShowEvidenceBlock'
import { ShowFindingBlock } from './ShowFindingBlock'
import { ShowMatrixBlock } from './ShowMatrixBlock'
import { ShowSubgraphBlock } from './ShowSubgraphBlock'
import { ShowTraceBlock } from './ShowTraceBlock'

/**
 * One renderer per render call, picked by the call the agent made.
 * Each renderer owns its own chrome, because the calls differ in role.
 * An answer is the document, a finding annotates it, evidence backs it.
 * A single card wrapper around all of them would flatten that difference.
 */
export function renderBlock(block: RenderBlock): ReactElement {
  switch (block.call) {
    case 'showAnswer':
      return <ShowAnswerBlock block={block} />
    case 'showEvidence':
      return <ShowEvidenceBlock block={block} />
    case 'showFinding':
      return <ShowFindingBlock block={block} />
    case 'showMatrix':
      return <ShowMatrixBlock block={block} />
    case 'showTrace':
      return <ShowTraceBlock block={block} />
    case 'showDiagram':
      return <ShowDiagramBlock block={block} />
    case 'showSubgraph':
      return <ShowSubgraphBlock block={block} />
    default: {
      const exhaustive: never = block
      throw new Error(`Unhandled: ${JSON.stringify(exhaustive)}`)
    }
  }
}
