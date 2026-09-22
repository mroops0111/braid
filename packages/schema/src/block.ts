import { z } from 'zod'
import { AudienceId, BlockId, DriftIssueId, NodeId, SourceReference } from './common.js'

/**
 * Where a reference came from.
 * `graph` was copied verbatim off a node's `metadata.sourceReferences`,
 * and `agent` is a location the run opened itself.
 * A run exists to find what the model does not know yet,
 * so the second kind carries findings the graph could not have produced.
 * Studio renders it as unverified rather than dropping it.
 */
export const RefProvenance = z.enum(['graph', 'agent']).describe('Where this reference came from. `graph` was copied off a node\'s recorded evidence, and `agent` is a place the run opened itself, which the surface marks as unverified.')
export type RefProvenance = z.infer<typeof RefProvenance>

export const BlockRef = z.object({
  provenance: RefProvenance,
  reference: SourceReference,
  nodeId: NodeId.optional().describe('The node the reference was copied from, sent when provenance is `graph`.'),
}).describe('One citation shown inside a block, and where it came from.').openapi('BlockRef')
export type BlockRef = z.infer<typeof BlockRef>

const blockBase = {
  /**
   * What differs between readers is usually how much of a reference is shown,
   * which the audience's own `evidenceDetail` decides,
   * rather than whether the finding above it exists.
   */
  audiences: z.array(AudienceId).default([]).describe('Readers this block is only for. Empty is the common case and means every reader sees it, since a conclusion belongs to whoever asked. Name an audience only for content that says nothing to the others.'),
  group: z.string().min(1).max(80).optional().describe('A free string two blocks share to say they are readings of one comparison. It never says where to put them, the surface sets them side by side when there is room. Two flows being compared share a group, a flow and the matrix summarising it do not.'),
  title: z.string().min(1).max(200).optional().describe('A heading for this block, for a reader scanning rather than reading.'),
}

/**
 * Prose. `@node:` tokens inside the markdown render as live tags,
 * under the grammar in `reference.ts`.
 */
export const ShowAnswer = z.object({
  ...blockBase,
  call: z.literal('showAnswer'),
  markdown: z.string().min(1).describe('The prose itself, in Markdown. An `@node:<id>` token renders as a live tag a reader can open.'),
}).openapi('ShowAnswer')
export type ShowAnswer = z.infer<typeof ShowAnswer>

export const ShowEvidence = z.object({
  ...blockBase,
  call: z.literal('showEvidence'),
  refs: z.array(BlockRef).min(1).describe('The passages this block shows, at least one.'),
}).openapi('ShowEvidence')
export type ShowEvidence = z.infer<typeof ShowEvidence>

/**
 * What a finding concluded. `unverifiable` is a first-class outcome,
 * a run that could not settle a question says so instead of picking a side.
 */
export const FindingVerdict = z.enum(['consistent', 'conflict', 'unverifiable']).describe('What the finding concluded. `unverifiable` is a first-class outcome, so a run that could not settle the question says so rather than picking a side.')
export type FindingVerdict = z.infer<typeof FindingVerdict>

export const FindingSide = z.object({
  summary: z.string().min(1).max(400).describe('What this side says, in its own terms rather than as a comparison.'),
  refs: z.array(BlockRef).default([]).describe('The passages this side rests on.'),
}).describe('One of the readings a finding weighs.').openapi('FindingSide')
export type FindingSide = z.infer<typeof FindingSide>

/**
 * How much the references behind a finding actually carry it.
 *
 * Derived from the sides, never stated by the skill.
 * A model asked for its own confidence returns a number in a narrow band,
 * whatever the evidence,
 * so the figure reads like a measurement while carrying no information.
 */
export const EvidenceSupport = z.enum(['corroborated', 'partial', 'thin']).describe('How far the references behind a finding carry it. Derived from the sides and never sent by a run, reading `corroborated` when every side rests on a `graph` reference, `partial` when every side has a reference but at least one is `agent`, and `thin` when a side has none.')
export type EvidenceSupport = z.infer<typeof EvidenceSupport>

/**
 * One consistency statement. A finding belongs to whoever asked the question,
 * so it is never engineering-only even when its evidence is a line number.
 */
export const ShowFinding = z.object({
  ...blockBase,
  call: z.literal('showFinding'),
  statement: z.string().min(1).max(400).describe('What was checked, written as a claim rather than a question, so the verdict below reads against it.'),
  verdict: FindingVerdict,
  registered: z.boolean().default(false).describe('True when the graph already records this as a drift issue, so a reader knows it is tracked rather than newly noticed.'),
  driftId: DriftIssueId.optional().describe('The drift issue this finding reports, when the graph already records one.'),
  sides: z.array(FindingSide).min(2).describe('The readings being weighed, at least two, one entry each.'),
  // Computed from the sides when the block is recorded, never sent by the skill.
  // Optional because a run log is append-only,
  // and holds blocks written before this was derived,
  // where dropping those lines would erase recorded history.
  support: EvidenceSupport.optional(),
  suggestedSource: z.string().min(1).max(400).optional().describe('What would settle this, named only when the verdict is `unverifiable`.'),
}).openapi('ShowFinding')
export type ShowFinding = z.infer<typeof ShowFinding>

/**
 * How a matrix cell reads at a glance.
 * The label beside it is free text the skill chooses,
 * so an ontology names its own states,
 * while a renderer only needs to know which of five ways to colour them.
 */
export const CellTone = z.enum(['affirmed', 'denied', 'conditional', 'conflict', 'not-applicable']).describe('How the cell reads at a glance, which is all a renderer needs to colour the grid. The label beside it stays in the run\'s own words.')
export type CellTone = z.infer<typeof CellTone>

export const AxisItem = z.object({
  id: z.string().min(1).describe('Short id for this item, which a cell names to say where it sits.'),
  label: z.string().min(1).max(120).describe('What a reader sees for this item.'),
}).describe('One position along an axis.').openapi('AxisItem')
export type AxisItem = z.infer<typeof AxisItem>

export const MatrixAxis = z.object({
  label: z.string().min(1).max(120).describe('What this axis is, such as what the comparison varies along.'),
  items: z.array(AxisItem).min(1).describe('The positions along this axis, in the order a reader should meet them.'),
}).describe('One side of the comparison, which the run chooses rather than the ontology.').openapi('MatrixAxis')
export type MatrixAxis = z.infer<typeof MatrixAxis>

export const MatrixCell = z.object({
  row: z.string().min(1).describe('Which row this cell sits in, by the row item\'s id.'),
  column: z.string().min(1).describe('Which column this cell sits in, by the column item\'s id.'),
  state: z.string().min(1).max(120).describe('What this crossing amounts to, in the run\'s own words rather than a fixed vocabulary.'),
  tone: CellTone,
  note: z.string().max(400).optional().describe('One line of detail a reader needs to take the state at face value.'),
  refs: z.array(BlockRef).default([]).describe('The passages this cell rests on.'),
}).describe('One crossing of the two axes.').openapi('MatrixCell')
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
  cells: z.array(MatrixCell).min(1).describe('One entry per crossing that means something, rather than one per pair.'),
}).openapi('ShowMatrix')
export type ShowMatrix = z.infer<typeof ShowMatrix>

export const TraceSearch = z.object({
  query: z.string().min(1).max(200).describe('The query as it was run, not a paraphrase of it.'),
  hits: z.number().int().nonnegative().describe('How many results came back, zero included, since an empty search is worth recording.'),
}).describe('One search the run ran, and what it returned.').openapi('TraceSearch')
export type TraceSearch = z.infer<typeof TraceSearch>

export const TraceSkip = z.object({
  ref: BlockRef.describe('The passage that was opened and then left out.'),
  why: z.string().min(1).max(200).describe('Why it was left out, in one line, including having run out of budget rather than having ruled it out.'),
}).describe('Something the run opened and chose not to use, which is where a wrong answer hides.').openapi('TraceSkip')
export type TraceSkip = z.infer<typeof TraceSkip>

/**
 * What the run searched, read, cited, and deliberately left out.
 * Renders to both audiences,
 * because what was not looked at cannot be inferred from the answer.
 */
export const ShowTrace = z.object({
  ...blockBase,
  call: z.literal('showTrace'),
  searched: z.array(TraceSearch).default([]).describe('Every query the run ran, with how many hits each came back with.'),
  read: z.array(BlockRef).default([]).describe('The sources the run actually opened.'),
  cited: z.array(NodeId).default([]).describe('The nodes the answer ends up standing on.'),
  skipped: z.array(TraceSkip).default([]).describe('What was opened and then dismissed, each with its reason, which a reader cannot infer from the answer.'),
}).openapi('ShowTrace')
export type ShowTrace = z.infer<typeof ShowTrace>

/**
 * A diagram, as a mermaid definition.
 *
 * The renderer already exists for node descriptions,
 * so this carries the definition and nothing else.
 * Use it for a flow or a state machine,
 * where the shape of the thing is the point and a table would flatten it.
 */
export const ShowDiagram = z.object({
  ...blockBase,
  call: z.literal('showDiagram'),
  mermaid: z.string().min(1).describe('The diagram as a mermaid definition. Keep it small enough to read without panning.'),
  caption: z.string().max(400).optional().describe('One line saying what the diagram shows, for a reader who will not trace it.'),
}).openapi('ShowDiagram')
export type ShowDiagram = z.infer<typeof ShowDiagram>

export const SubgraphEdge = z.object({
  from: NodeId.describe('The node the arrow starts at.'),
  to: NodeId.describe('The node the arrow points to.'),
  label: z.string().max(80).optional().describe('What the relationship is, when the shape alone does not say.'),
}).describe('One relationship drawn between two of the nodes shown.').openapi('SubgraphEdge')
export type SubgraphEdge = z.infer<typeof SubgraphEdge>

/**
 * A slice of the graph the answer stands on.
 *
 * Node ids and the edges between them, nothing else.
 * The surface resolves each id to its own name, type, and colour,
 * so this carries no ontology vocabulary,
 * and stays correct when a node is renamed.
 */
export const ShowSubgraph = z.object({
  ...blockBase,
  call: z.literal('showSubgraph'),
  nodes: z.array(NodeId).min(1).describe('The nodes to draw, by id and nothing more. The surface resolves each to its own name and colour, so a name repeated here goes stale on a rename. Send only ids a read of the graph has returned.'),
  edges: z.array(SubgraphEdge).default([]).describe('The relationships to draw between those nodes.'),
}).openapi('ShowSubgraph')
export type ShowSubgraph = z.infer<typeof ShowSubgraph>

/** How deep a part sits, closed so a renderer can style each one. */
export const SectionLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]).describe('How deep this part sits. 1 opens a part, 2 a chapter inside it, 3 a passage inside that.')
export type SectionLevel = z.infer<typeof SectionLevel>

/**
 * A part of a document, and what it is about.
 *
 * `title` on a block names one thing, and a document is a shape,
 * so nesting needs a level a title cannot carry.
 * `covers` is the citation for the part rather than for the whole,
 * which is what lets one section be told it has gone stale,
 * while the rest of the document has not.
 */
export const ShowSection = z.object({
  ...blockBase,
  call: z.literal('showSection'),
  heading: z.string().min(1).max(120).describe('What this part is about, as a heading rather than a sentence.'),
  level: SectionLevel,
  covers: z.array(NodeId).default([]).describe('The nodes this part is written from, which is what lets one part be told it has gone stale while the rest has not. Name what the part explains rather than everything it mentions.'),
}).openapi('ShowSection')
export type ShowSection = z.infer<typeof ShowSection>

/** How deep a question reaches, which is not the same as how hard it is. */
export const CheckLevel = z.enum(['recall', 'apply', 'judge']).describe('How deep the question reaches, which is not how hard it is. `recall` asks for a fact, `apply` asks the reader to use it, and `judge` asks them to weigh something.')
export type CheckLevel = z.infer<typeof CheckLevel>

export const CheckChoice = z.object({
  id: z.string().min(1).max(40).describe('Short id for this choice, which `correct` names.'),
  text: z.string().min(1).max(400).describe('The choice as the reader reads it.'),
}).describe('One option a reader can pick.').openapi('CheckChoice')
export type CheckChoice = z.infer<typeof CheckChoice>

/**
 * The fields of a check, without the rule that ties two of them together.
 *
 * Kept apart because a refined schema cannot be narrowed with `.omit()`,
 * and the route serving this call has to drop `call` from the body.
 * Both the union member and the route body apply the rule themselves.
 */
export const ShowCheckFields = z.object({
  ...blockBase,
  call: z.literal('showCheck'),
  prompt: z.string().min(1).max(1000).describe('The question the reader answers before they are shown the answer, in one sentence.'),
  level: CheckLevel,
  choices: z.array(CheckChoice).default([]).describe('The options to pick between. Send them where picking is the honest test, and send none where the reader should produce the answer themselves.'),
  correct: z.string().min(1).optional().describe('Which choice is right, by its id. Required once there are choices, since a reader who picked wrong should be told plainly rather than left to infer it from the explanation.'),
  answer: z.string().min(1).describe('What the reader should have arrived at, and why, shown once they have committed.'),
  covers: z.array(NodeId).default([]).describe('The nodes this question is asking about.'),
})

/**
 * Whether a question that offers choices says which of them is right.
 *
 * A predicate rather than a zod check,
 * so the union member and the route body can each wrap it,
 * without the rule itself being written twice.
 */
export function namesItsAnswer(check: {
  readonly choices: readonly { readonly id: string }[]
  readonly correct?: string | undefined
}): boolean {
  if (check.choices.length === 0)
    return true
  return check.correct !== undefined && check.choices.some(choice => choice.id === check.correct)
}

export const CHOICE_NEEDS_ANSWER = 'A question with choices names which one is right, by its id'

/**
 * One question the reader answers before they are shown the answer.
 *
 * A reader who has just read something believes they know it,
 * and is usually wrong,
 * so a passage that never asks cannot tell whether it landed.
 * Prose cannot carry this,
 * because holding the answer back until the reader commits,
 * is a state the surface owns rather than a sentence.
 *
 * `answer` travels to the reader's own machine,
 * so this checks understanding,
 * rather than guarding against a reader who wants to cheat themselves.
 *
 * Depth is not difficulty.
 * A recall question can be brutally hard and is still recall,
 * because what makes it hard is how obscure the fact was,
 * rather than how much of the reader's understanding it draws on.
 */
export const ShowCheck = ShowCheckFields.check((context) => {
  if (!namesItsAnswer(context.value))
    context.issues.push({ code: 'custom', input: context.value, path: ['correct'], message: CHOICE_NEEDS_ANSWER })
}).openapi('ShowCheck')
export type ShowCheck = z.infer<typeof ShowCheck>

/**
 * A block shape the framework does not know, named by whoever ships it.
 *
 * Open the way a view kind and an agent kind are open,
 * so a plugin with a shape of its own is not blocked on a change here.
 * The plugin registers a schema and the server validates against it,
 * which keeps a malformed block out of a stored document.
 *
 * Braid's own surface does not draw one.
 * It renders the calls it knows and says so plainly about the rest,
 * because a framework cannot be responsible for looks it did not design.
 * A plugin that wants its shape drawn draws it in its own surface.
 */
export const BlockKind = z.string().min(1).brand<'BlockKind'>().describe('Which shape this block is, named by the plugin that ships it. The server validates the payload against that plugin\'s schema.')
export type BlockKind = z.infer<typeof BlockKind>

export const ShowCustom = z.object({
  ...blockBase,
  call: z.literal('showCustom'),
  kind: BlockKind,
  payload: z.unknown().describe('The block\'s content, in whatever shape the plugin behind `kind` declares.'),
  covers: z.array(NodeId).default([]).describe('The nodes this block is written from.'),
}).openapi('ShowCustom')
export type ShowCustom = z.infer<typeof ShowCustom>

export const RenderBlock = z.discriminatedUnion('call', [
  ShowAnswer,
  ShowEvidence,
  ShowFinding,
  ShowMatrix,
  ShowTrace,
  ShowDiagram,
  ShowSubgraph,
  ShowSection,
  ShowCheck,
  ShowCustom,
])
export type RenderBlock = z.infer<typeof RenderBlock>

export type RenderCall = RenderBlock['call']

export const RENDER_CALLS = ['showAnswer', 'showEvidence', 'showFinding', 'showMatrix', 'showTrace', 'showDiagram', 'showSubgraph', 'showSection', 'showCheck', 'showCustom'] as const

/** The call names as a schema, so a skill can declare which ones it owes. */
export const RenderCallName = z.enum(RENDER_CALLS)
export type RenderCallName = z.infer<typeof RenderCallName>

/** A block as it reaches a surface, the call plus the identity the server minted. */
export const EmittedBlock = z.object({
  id: BlockId,
  block: RenderBlock.describe('The call as the run made it.'),
}).describe('A block as it reaches a surface, the call plus the identity the server minted.').openapi('EmittedBlock')
export type EmittedBlock = z.infer<typeof EmittedBlock>
