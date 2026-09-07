import { z } from 'zod'
import { AudienceId, BlockId, DriftIssueId, NodeId, SourceReference } from './common.js'

/**
 * Where a reference came from. `graph` was copied verbatim off a node's
 * `metadata.sourceReferences`, `agent-read` is a location the run opened itself.
 * A run exists to find what the model does not know yet, so the second kind
 * carries the findings the graph could not have produced. Studio renders it
 * as unverified rather than dropping it.
 */
export const RefProvenance = z.enum(['graph', 'agent-read'])
export type RefProvenance = z.infer<typeof RefProvenance>

export const BlockRef = z.object({
  provenance: RefProvenance,
  reference: SourceReference,
  // Set when provenance is `graph`, naming the node the ref was copied from.
  nodeId: NodeId.optional(),
}).openapi('BlockRef')
export type BlockRef = z.infer<typeof BlockRef>

const blockBase = {
  /**
   * Readers this block is only for, from the audiences the ontology declares.
   *
   * Empty is the common case and means every reader sees it, because a
   * conclusion belongs to whoever asked. Naming an audience is for content
   * that genuinely says nothing to the others, such as a search trail. What
   * differs between readers is usually how much of a reference is shown,
   * which the audience's own `evidenceDetail` decides, not whether the
   * finding above it exists.
   */
  audiences: z.array(AudienceId).default([]),
  /**
   * Blocks that belong together, named by a shared free string.
   *
   * This says the blocks are two readings of one comparison, not where to put
   * them. The surface lays a group out side by side when there is room and
   * stacks it when there is not, which is why a block still carries no
   * position and no size. Two flows being compared share a group, a flow and
   * the matrix summarising it do not.
   */
  group: z.string().min(1).max(80).optional(),
  title: z.string().min(1).max(200).optional(),
}

/**
 * Prose. `@node:` tokens inside the markdown render as live tags,
 * under the grammar in `reference.ts`.
 */
export const ShowAnswer = z.object({
  ...blockBase,
  call: z.literal('showAnswer'),
  markdown: z.string().min(1),
}).openapi('ShowAnswer')
export type ShowAnswer = z.infer<typeof ShowAnswer>

export const ShowEvidence = z.object({
  ...blockBase,
  call: z.literal('showEvidence'),
  refs: z.array(BlockRef).min(1),
}).openapi('ShowEvidence')
export type ShowEvidence = z.infer<typeof ShowEvidence>

/**
 * What a finding concluded. `unverifiable` is a first-class outcome,
 * a run that could not settle a question says so instead of picking a side.
 */
export const FindingVerdict = z.enum(['consistent', 'conflict', 'unverifiable'])
export type FindingVerdict = z.infer<typeof FindingVerdict>

export const FindingSide = z.object({
  summary: z.string().min(1).max(400),
  refs: z.array(BlockRef).default([]),
})
export type FindingSide = z.infer<typeof FindingSide>

/**
 * How much the references behind a finding actually carry it.
 *
 * Derived from the sides, never stated by the skill. A model asked for its own
 * confidence returns a number in a narrow band whatever the evidence, so the
 * figure reads like a measurement while carrying no information.
 */
export const EvidenceSupport = z.enum(['corroborated', 'partial', 'thin'])
export type EvidenceSupport = z.infer<typeof EvidenceSupport>

/**
 * One consistency statement. A finding belongs to whoever asked the question,
 * so it is never engineering-only even when its evidence is a line number.
 */
export const ShowFinding = z.object({
  ...blockBase,
  call: z.literal('showFinding'),
  statement: z.string().min(1).max(400),
  verdict: FindingVerdict,
  // True when the model already records this as a DriftIssue.
  registered: z.boolean().default(false),
  driftId: DriftIssueId.optional(),
  sides: z.array(FindingSide).min(2),
  // Computed from the sides when the block is recorded, never sent by the skill.
  // Optional because a run log is append-only and holds blocks written before
  // this was derived, and dropping those lines would erase recorded history.
  support: EvidenceSupport.optional(),
  // Only for the unverifiable case, naming what would settle it.
  suggestedSource: z.string().min(1).max(400).optional(),
}).openapi('ShowFinding')
export type ShowFinding = z.infer<typeof ShowFinding>

/**
 * How a matrix cell reads at a glance. The label beside it is free text the
 * skill chooses, so an ontology names its own states while a renderer only
 * needs to know which of five ways to colour them.
 */
export const CellTone = z.enum(['affirmed', 'denied', 'conditional', 'conflict', 'not-applicable'])
export type CellTone = z.infer<typeof CellTone>

export const AxisItem = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
})
export type AxisItem = z.infer<typeof AxisItem>

export const MatrixAxis = z.object({
  label: z.string().min(1).max(120),
  items: z.array(AxisItem).min(1),
})
export type MatrixAxis = z.infer<typeof MatrixAxis>

export const MatrixCell = z.object({
  row: z.string().min(1),
  column: z.string().min(1),
  // What this crossing amounts to, in the skill's own words.
  state: z.string().min(1).max(120),
  tone: CellTone,
  note: z.string().max(400).optional(),
  refs: z.array(BlockRef).default([]),
})
export type MatrixCell = z.infer<typeof MatrixCell>

/**
 * Two axes crossing, each cell a state rather than a sentence.
 * Both axes are the skill's choice, so this carries no ontology vocabulary.
 */
export const ShowMatrix = z.object({
  ...blockBase,
  call: z.literal('showMatrix'),
  rowAxis: MatrixAxis,
  columnAxis: MatrixAxis,
  cells: z.array(MatrixCell).min(1),
}).openapi('ShowMatrix')
export type ShowMatrix = z.infer<typeof ShowMatrix>

export const TraceSearch = z.object({
  query: z.string().min(1).max(200),
  hits: z.number().int().nonnegative(),
})
export type TraceSearch = z.infer<typeof TraceSearch>

export const TraceSkip = z.object({
  ref: BlockRef,
  // Why this was opened and then left out, so a reader can challenge the call.
  why: z.string().min(1).max(200),
})
export type TraceSkip = z.infer<typeof TraceSkip>

/**
 * What the run searched, read, cited, and deliberately left out.
 * Renders to both audiences, because what was not looked at is the one thing
 * a reader cannot infer from the answer.
 */
export const ShowTrace = z.object({
  ...blockBase,
  call: z.literal('showTrace'),
  searched: z.array(TraceSearch).default([]),
  read: z.array(BlockRef).default([]),
  cited: z.array(NodeId).default([]),
  skipped: z.array(TraceSkip).default([]),
}).openapi('ShowTrace')
export type ShowTrace = z.infer<typeof ShowTrace>

/**
 * A diagram, as a mermaid definition.
 *
 * The renderer already exists for node descriptions, so this carries the
 * definition and nothing else. Use it for a flow or a state machine, where the
 * shape of the thing is the point and a table would flatten it.
 */
export const ShowDiagram = z.object({
  ...blockBase,
  call: z.literal('showDiagram'),
  mermaid: z.string().min(1),
  caption: z.string().max(400).optional(),
}).openapi('ShowDiagram')
export type ShowDiagram = z.infer<typeof ShowDiagram>

export const SubgraphEdge = z.object({
  from: NodeId,
  to: NodeId,
  label: z.string().max(80).optional(),
})
export type SubgraphEdge = z.infer<typeof SubgraphEdge>

/**
 * A slice of the graph the answer stands on.
 *
 * Node ids and the edges between them, nothing else. The surface resolves each
 * id to its own name, type, and colour, so this carries no ontology vocabulary
 * and stays correct when a node is renamed.
 */
export const ShowSubgraph = z.object({
  ...blockBase,
  call: z.literal('showSubgraph'),
  nodes: z.array(NodeId).min(1),
  edges: z.array(SubgraphEdge).default([]),
}).openapi('ShowSubgraph')
export type ShowSubgraph = z.infer<typeof ShowSubgraph>

export const RenderBlock = z.discriminatedUnion('call', [
  ShowAnswer,
  ShowEvidence,
  ShowFinding,
  ShowMatrix,
  ShowTrace,
  ShowDiagram,
  ShowSubgraph,
])
export type RenderBlock = z.infer<typeof RenderBlock>

export type RenderCall = RenderBlock['call']

export const RENDER_CALLS = ['showAnswer', 'showEvidence', 'showFinding', 'showMatrix', 'showTrace', 'showDiagram', 'showSubgraph'] as const

/** The call names as a schema, so a skill can declare which ones it owes. */
export const RenderCallName = z.enum(RENDER_CALLS)

/** A block as it reaches a surface, the call plus the identity the server minted. */
export const EmittedBlock = z.object({
  id: BlockId,
  block: RenderBlock,
}).openapi('EmittedBlock')
export type EmittedBlock = z.infer<typeof EmittedBlock>
