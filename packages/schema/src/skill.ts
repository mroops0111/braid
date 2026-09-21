import { z } from 'zod'
import { AgentEffort, AgentKind } from './agent.js'
import { RENDER_CALLS, RenderBlock, RenderCallName } from './block.js'
import { AbsolutePath, BlockId, PluginId, SkillId, SkillRunId, SourceId, Timestamp, UserId, WorkspaceId } from './common.js'
import { localizedText } from './locale.js'
import { McpServerId } from './mcp.js'
import { SourceRole } from './source.js'
import { WorkspaceRole } from './workspace.js'

export const SkillOrigin = z.enum(['builtin', 'plugin', 'workspace', 'extension'])
export type SkillOrigin = z.infer<typeof SkillOrigin>

/**
 * A SkillId is `<namespace>:<verb>`, such as `ddd:extract` or `braid:ask`.
 * The namespace is the contributing plugin, the verb the bare action.
 * Split on the first colon, so a hyphenated verb like `generate-doc` survives.
 */
export function splitSkillId(id: SkillId): { namespace: string, verb: string } {
  const colon = id.indexOf(':')
  if (colon <= 0 || colon === id.length - 1)
    throw new Error(`SkillId "${id}" is not in <namespace>:<verb> form`)
  return { namespace: id.slice(0, colon), verb: id.slice(colon + 1) }
}

/**
 * Frontmatter the Claude Code CLI reads to register the slash command, plus its invocation rules. camelCase in TS,
 * emitted as kebab-case in YAML.
 */
export const ClaudeCodeSkillFrontmatter = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  argumentHint: z.string().optional(),
  disableModelInvocation: z.boolean().default(false),
  allowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
})
export type ClaudeCodeSkillFrontmatter = z.infer<typeof ClaudeCodeSkillFrontmatter>

/** Studio sidebar section, mapped 1:1. ask: read-only Q&A. build: mutate the graph. generate: produce artifacts. */
export const SkillCategory = z.enum(['ask', 'build', 'generate'])
export type SkillCategory = z.infer<typeof SkillCategory>

/**
 * The most any run of a kind may be offered, before its skill narrows further.
 *
 * A ceiling rather than the surface itself.
 * What a run of a kind could never sensibly call is settled here,
 * and which of the rest it actually gets is the skill's own declaration,
 * so two skills of one kind need not carry each other's calls.
 * Held in one table.
 * Ten routes each marking their own gave ten chances to disagree,
 * against the one table a validator checks a declaration against.
 */
export const RENDER_CALL_CATEGORIES: Record<RenderCallName, readonly SkillCategory[]> = {
  showAnswer: ['ask', 'build', 'generate'],
  showEvidence: ['ask', 'build', 'generate'],
  showFinding: ['ask', 'build'],
  showMatrix: ['ask', 'generate'],
  showTrace: ['ask', 'build'],
  showDiagram: ['ask', 'build', 'generate'],
  showSubgraph: ['ask', 'build', 'generate'],
  showSection: ['generate'],
  showCheck: ['generate'],
  showCustom: ['generate'],
}

/** The calls a run of this kind may be offered at most. */
export function renderCallsFor(category: SkillCategory): readonly RenderCallName[] {
  return RENDER_CALLS.filter(call => RENDER_CALL_CATEGORIES[call].includes(category))
}

/**
 * The form a run's output takes, decided before it starts.
 *
 * `blocks` is the default: the run renders typed blocks a surface draws,
 * carrying evidence a reader can open and findings they can act on.
 * `prose` is the answer written out and nothing else,
 * which is what a reader wanting the answer rather than what it rests on gets,
 * and what a run nobody is watching gets whether it asked or not.
 *
 * The two are alternatives rather than a pair.
 * A run that renders blocks has already said everything it has to say,
 * and writing the same answer out again is paid for twice and read once.
 *
 * Recorded on the run rather than held as a reader's preference,
 * because it decides what the run produces.
 * A conversation lent to somebody else therefore reads
 * the way its author made it, not the way its reader would have asked for.
 */
export const OutputForm = z.enum(['blocks', 'prose']).describe('What the run leaves behind. `blocks` draws on a surface as the run works, and `prose` writes the answer out instead. The two are alternatives rather than a pair.')
export type OutputForm = z.infer<typeof OutputForm>

/**
 * What each form leaves behind, so adding one is adding a row here.
 *
 * Every decision a form drives asks this one question.
 * A run either renders blocks a surface draws, or writes its answer out,
 * and what narrows its tool surface, what `emit_block` refuses,
 * and what an unattended run falls to all read it from here.
 * Held as a table rather than as comparisons against `'prose'`,
 * so a third form is a row and a value in a skill's `forms`,
 * rather than an edit to every branch that ever named a form.
 */
const OUTPUT_FORM_TRAITS: Record<OutputForm, { readonly rendersBlocks: boolean }> = {
  blocks: { rendersBlocks: true },
  prose: { rendersBlocks: false },
}

/** Whether a run in this form is offered the render operations at all. */
export function rendersBlocks(form: OutputForm): boolean {
  return OUTPUT_FORM_TRAITS[form].rendersBlocks
}

/**
 * What a skill produces when it declares nothing.
 *
 * Blocks alone, which is what every skill did before a form could be asked for.
 * A skill whose blocks are its artefact keeps producing them,
 * however little of it anybody reads.
 */
export const DEFAULT_OUTPUT_FORMS: readonly OutputForm[] = ['blocks']

/**
 * The render calls one run is offered, narrowed from its kind's ceiling.
 *
 * A run that renders nothing is offered none, whatever its skill declares,
 * since the form is settled first and the surface follows it.
 * A skill declaring nothing keeps the ceiling,
 * and one declaring a call its kind never offers gets the overlap,
 * not the wish.
 */
export function settleRenderCalls(input: {
  readonly category: SkillCategory
  readonly form: OutputForm
  readonly declaredCalls?: readonly RenderCallName[] | undefined
}): readonly RenderCallName[] {
  if (!rendersBlocks(input.form))
    return []
  const ceiling = renderCallsFor(input.category)
  if (!input.declaredCalls)
    return ceiling
  return ceiling.filter(call => input.declaredCalls!.includes(call))
}

/**
 * The form one run produces, settled from what is on offer and who is reading.
 *
 * Nothing outside a skill's own list can be reached by asking,
 * so a skill whose blocks are its artefact keeps rendering,
 * even when no one is watching.
 * Within the list, a run nobody is watching takes the form that renders nothing,
 * since rendering is paid for by whoever produces it and read by nobody,
 * and an attended run takes what its reader asked for.
 */
export function settleOutputForm(input: {
  readonly declaredForms?: readonly OutputForm[] | undefined
  readonly requestedForm?: OutputForm | undefined
  readonly unattended?: boolean | undefined
}): OutputForm {
  const offeredForms = input.declaredForms?.length ? input.declaredForms : DEFAULT_OUTPUT_FORMS
  const defaultForm = offeredForms[0]!
  if (input.unattended)
    return offeredForms.find(form => !rendersBlocks(form)) ?? defaultForm
  if (input.requestedForm && offeredForms.includes(input.requestedForm))
    return input.requestedForm
  return defaultForm
}

/**
 * Declarative form schema rendered by Studio's Actions page.
 * Skills without an inputs block fall back to the legacy argumentHint textarea.
 */
export const SkillInputStaticOption = z.object({
  value: z.string(),
  label: z.string().min(1),
  description: z.string().optional(),
})
export type SkillInputStaticOption = z.infer<typeof SkillInputStaticOption>

export const SkillInputStaticProvider = z.object({
  kind: z.literal('static'),
  options: z.array(SkillInputStaticOption).min(1),
})
export type SkillInputStaticProvider = z.infer<typeof SkillInputStaticProvider>

/** Pulls graph nodes, optionally filtered by type / status / renderHint. value = node.id. */
export const SkillInputGraphNodeProvider = z.object({
  kind: z.literal('graph-node'),
  filter: z.object({
    types: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    // container: true picks node types flagged as top-level containers, e.g. boundedContext.
    renderHint: z.object({ container: z.boolean().optional() }).optional(),
  }).optional(),
})
export type SkillInputGraphNodeProvider = z.infer<typeof SkillInputGraphNodeProvider>

/** Enumerates items from sources of the given role. value is the loader-relative path. */
export const SkillInputSourceProvider = z.object({
  kind: z.literal('source'),
  filter: z.object({
    // Restrict to sources of this role. Omit to include the ontology's unit-bearing roles.
    role: SourceRole.optional(),
    // Restrict to sources whose loader.kind matches. Omit to include all.
    loaderKind: z.string().optional(),
  }).optional(),
})
export type SkillInputSourceProvider = z.infer<typeof SkillInputSourceProvider>

/** Clarifications, filtered by status. Defaults to all statuses. */
export const SkillInputClarificationProvider = z.object({
  kind: z.literal('clarify'),
  filter: z.object({
    status: z.enum(['pending', 'answered', 'applied', 'skipped']).optional(),
  }).optional(),
})
export type SkillInputClarificationProvider = z.infer<typeof SkillInputClarificationProvider>

export const SkillInputProvider = z.discriminatedUnion('kind', [
  SkillInputStaticProvider,
  SkillInputGraphNodeProvider,
  SkillInputSourceProvider,
  SkillInputClarificationProvider,
])
export type SkillInputProvider = z.infer<typeof SkillInputProvider>

/** What the form does on zero options. text: swap to free-text (default). disabled: for server-required selections. */
export const SkillInputFallback = z.enum(['text', 'disabled']).default('text')
export type SkillInputFallback = z.infer<typeof SkillInputFallback>

const SkillInputBaseShape = {
  // Identifier the form binds to, composed into the skill's $ARGUMENTS at run time.
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'Input name must be a lowerCamelCase identifier'),
  label: z.string().min(1),
  description: z.string().optional(),
  // When true the input may be empty. Defaults to false (required).
  optional: z.boolean().default(false),
  default: z.string().optional(),
  placeholder: z.string().optional(),
}

export const SkillInputText = z.object({
  ...SkillInputBaseShape,
  kind: z.literal('text'),
  // When true, renders as a multi-line textarea.
  multiline: z.boolean().default(false),
})
export type SkillInputText = z.infer<typeof SkillInputText>

// pick and multi-pick differ only in their kind literal.
const SkillInputPickShape = {
  ...SkillInputBaseShape,
  provider: SkillInputProvider,
  fallback: SkillInputFallback,
}

export const SkillInputPick = z.object({
  ...SkillInputPickShape,
  kind: z.literal('pick'),
})
export type SkillInputPick = z.infer<typeof SkillInputPick>

export const SkillInputMultiPick = z.object({
  ...SkillInputPickShape,
  kind: z.literal('multi-pick'),
})
export type SkillInputMultiPick = z.infer<typeof SkillInputMultiPick>

export const SkillInputDescriptor = z.discriminatedUnion('kind', [SkillInputText, SkillInputPick, SkillInputMultiPick])
export type SkillInputDescriptor = z.infer<typeof SkillInputDescriptor>

/** One options-endpoint option. value is submitted, label/description are display only. */
export const SkillInputDynamicOption = z.object({
  value: z.string(),
  label: z.string().min(1),
  description: z.string().optional(),
  // Set by the source provider so a run can name its source unit.
  // Empty for providers that don't speak in source units (graph-node, clarify).
  sourceId: SourceId.optional(),
})
export type SkillInputDynamicOption = z.infer<typeof SkillInputDynamicOption>

export const SkillInputOptionsResponse = z.object({
  items: z.array(SkillInputDynamicOption),
})
export type SkillInputOptionsResponse = z.infer<typeof SkillInputOptionsResponse>

/**
 * Per-skill agent selection. Every field is optional, unset ones fall back to the server agent,
 * which defaults to claude-code.
 */
export const SkillAgentOverride = z.object({
  kind: AgentKind.optional(),
  model: z.string().min(1).optional(),
  effort: AgentEffort.optional(),
})
export type SkillAgentOverride = z.infer<typeof SkillAgentOverride>

/**
 * Braid-specific fields under the braid: key, so they never collide with Claude Code's own.
 * Read by SubprocessSkillRunner for preflight (env / path / MCP) before spawning.
 */
/**
 * What this skill's output is, and what a finished run owes before it counts.
 *
 * A prompt asking for something is not the same as getting it,
 * and a run that stops early looks like one that had nothing more to say.
 * Declaring the contract lets the framework check the output,
 * and hand the gap back to the agent rather than leaving a reader to find it.
 */
export const SkillOutputContract = z.object({
  /**
   * The forms a run of this skill can produce, richest first.
   *
   * The first is what an attended run gets when nobody asks for another,
   * so a list is an ordering as much as it is a set.
   * Declaring `prose` says the prompt can answer without the render calls,
   * which is what lets a run nobody is watching stop paying for them.
   * A skill leaving this out renders, as every skill did before this existed.
   */
  forms: z.array(OutputForm).min(1).default([...DEFAULT_OUTPUT_FORMS]),
  /**
   * The render calls a run of this skill may make.
   *
   * The kind of run sets a ceiling, and this narrows within it,
   * so two skills of one kind stop carrying each other's calls.
   * Absent leaves the ceiling in place,
   * which is what a skill declaring nothing got before it could say.
   */
  calls: z.array(RenderCallName).optional(),
  // Calls the run must have made at least once, a subset of `calls`.
  requiredCalls: z.array(RenderCallName).default([]),
  /**
   * Blocks each declared reader must be able to see, at least.
   *
   * A block naming nobody is addressed to everyone, so it counts for each,
   * so this is a floor on the answer's size,
   * rather than a rule about addressing anyone in particular.
   * Named by count rather than by reader,
   * so a builtin skill holds a floor,
   * without knowing which readers a product splits on.
   */
  minBlocksPerReader: z.number().int().positive().optional(),
  // How many corrective retries the framework may spend before giving up.
  // One is usually enough, and a loop here burns a subscription.
  maxRetries: z.number().int().min(0).max(3).default(1),
})
export type SkillOutputContract = z.infer<typeof SkillOutputContract>

export const BraidSkillExtension = z.object({
  requiredEnv: z.array(z.string()).default([]),
  requiredMcpServers: z.array(McpServerId).default([]),
  // Picks agent/effort for this skill. Unset fields use the server default.
  agent: SkillAgentOverride.optional(),
  category: SkillCategory.optional(),
  // Step number within build, Studio sorts by it. Ignored for ask / generate.
  order: z.number().int().positive().optional(),
  /**
   * What to call this step in front of a reader.
   *
   * A skill id is an address,
   * and `ddd:extract` says nothing to somebody looking at a board.
   * Localised the same way an ontology's node and edge types are,
   * since a step of the pipeline is as much its vocabulary as they are.
   * Absent, a surface falls back to the id, which is at least true.
   */
  label: localizedText(z.string().min(1).max(40)).optional(),
  // One-line tagline for narrow Studio surfaces, else description's first sentence.
  summary: z.string().min(1).max(80).optional(),
  // Declarative form for the Actions page. Omitted falls back to the argumentHint textarea.
  inputs: z.array(SkillInputDescriptor).optional(),
  // Server-side orchestration only, hidden from Studio's Actions list.
  hidden: z.boolean().optional(),
  // Roles allowed to run this by default (owner implicit). Defaults to owner + maintainer.
  // Add guest for read-only skills. Per-member skillOverrides take precedence.
  allowedRoles: z.array(WorkspaceRole).min(1).default(['owner', 'maintainer']),
  // Checked when the run exits, with the gap handed back for one more turn.
  output: SkillOutputContract.optional(),
})
export type BraidSkillExtension = z.infer<typeof BraidSkillExtension>

export const SkillFrontmatter = ClaudeCodeSkillFrontmatter.extend({
  braid: BraidSkillExtension.default({
    requiredEnv: [],
    requiredMcpServers: [],
    allowedRoles: ['owner', 'maintainer'],
  }),
})
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>

export const SkillManifest = z.object({
  id: SkillId,
  origin: SkillOrigin,
  path: AbsolutePath,
  frontmatter: SkillFrontmatter,
  extensionPath: AbsolutePath.optional(),
  // Set when origin is plugin, naming which plugin contributed it.
  pluginId: PluginId.optional(),
})
export type SkillManifest = z.infer<typeof SkillManifest>

export const SkillEventStarted = z.object({
  type: z.literal('started'),
  runId: SkillRunId,
  skillId: SkillId,
  // The user-supplied argument string, shown in the transcript.
  args: z.string(),
  // True when this run resumed an existing claude session.
  resumed: z.boolean().default(false),
  /**
   * The run this one takes up, when it takes one up.
   *
   * `resumed` says a conversation was continued, not which one.
   * Without the link, the reasoning that led a run to stop has no route back,
   * once the thing that pointed at it is settled,
   * and work spread over three runs reports three costs nothing adds up.
   */
  continues: SkillRunId.optional(),
  at: Timestamp,
})

/** The claude session id, passed to the next run to resume via claude --resume. */
export const SkillEventSessionStarted = z.object({
  type: z.literal('session-started'),
  sessionId: z.string().min(1),
})

export const SkillEventMessage = z.object({
  type: z.literal('message'),
  text: z.string(),
  /**
   * Who said it.
   * Absent reads as the agent,
   * which is what a message was before anything else could produce one,
   * so nothing recorded earlier changes meaning.
   * A run's own prompt is the one thing the user says, and it is said once.
   */
  role: z.enum(['user', 'agent']).optional(),
})

/**
 * A piece of a message still being written.
 *
 * Live only, never appended to a run's log.
 * The whole message follows and is what the log keeps,
 * so a replayed run reads exactly as it did before deltas existed.
 */
export const SkillEventMessageDelta = z.object({
  type: z.literal('message-delta'),
  // The increment, not the text so far, so a consumer accumulates or ignores.
  text: z.string(),
})

export const SkillEventToolCall = z.object({
  type: z.literal('tool-call'),
  tool: z.string().min(1),
  args: z.unknown(),
  // Stable id from the agent's stream, pairs with a tool-result.
  toolCallId: z.string().min(1).optional(),
})

export const SkillEventToolResult = z.object({
  type: z.literal('tool-result'),
  toolCallId: z.string().min(1),
  output: z.string(),
  isError: z.boolean(),
})

export const SkillArtifactKind = z.enum(['proposal', 'clarify', 'view'])
export type SkillArtifactKind = z.infer<typeof SkillArtifactKind>

export const SkillEventArtifactWritten = z.object({
  type: z.literal('artifact-written'),
  artifactKind: SkillArtifactKind,
  artifactId: z.string().min(1),
  path: AbsolutePath,
})

/**
 * A render call the run made, lifted out of its tool call.
 * Surfaces compose these instead of reading the transcript,
 * so a skill that makes none still renders as prose.
 */
export const SkillEventBlock = z.object({
  type: z.literal('block'),
  id: BlockId,
  block: RenderBlock,
})

export const SkillEventCompleted = z.object({
  type: z.literal('completed'),
  runId: SkillRunId,
  exitCode: z.number().int(),
  at: Timestamp,
})

export const SkillEventError = z.object({
  type: z.literal('error'),
  message: z.string().min(1),
  at: Timestamp,
})

/**
 * The agent's private reasoning,
 * surfaced so a reviewer can see why a skill proposed what it did.
 * Studio renders it collapsed, since it is not the output.
 */
export const SkillEventThinking = z.object({
  type: z.literal('thinking'),
  text: z.string(),
})

/**
 * The agent hit a usage limit.
 * Only emitted when the run is actually throttled,
 * so a stalled transcript reads as waiting rather than frozen.
 */
export const SkillEventRateLimit = z.object({
  type: z.literal('rate-limit'),
  status: z.string(),
  // Unix seconds when the limit resets, when the agent reports it.
  resetsAt: z.number().optional(),
})

/**
 * Cost and effort of a finished run,
 * surfaced so the reviewer sees what each skill run spent.
 * Every field is optional, since agents report a different subset.
 */
export const SkillEventUsage = z.object({
  type: z.literal('usage'),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  turns: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
})

export const SkillEvent = z.discriminatedUnion('type', [
  SkillEventStarted,
  SkillEventSessionStarted,
  SkillEventMessage,
  SkillEventMessageDelta,
  SkillEventToolCall,
  SkillEventToolResult,
  SkillEventArtifactWritten,
  SkillEventBlock,
  SkillEventCompleted,
  SkillEventError,
  SkillEventThinking,
  SkillEventRateLimit,
  SkillEventUsage,
])
export type SkillEvent = z.infer<typeof SkillEvent>

/**
 * Append-only run summary in artifacts/runs/index.jsonl, reader keeps the last line per runId.
 * The full event stream lives at artifacts/runs/<runId>.jsonl.
 */
export const RunRecord = z.object({
  runId: SkillRunId,
  workspaceId: WorkspaceId,
  skillId: SkillId,
  /** What the agent was told, verbatim. The record of what actually went out. */
  args: z.string(),
  /**
   * What the run works on, when that is not what it was told.
   *
   * A fresh per-unit run is started by naming its unit,
   * so the two are the same and this stays absent.
   * A run carrying another on is told to continue instead,
   * and every surface attributes work by matching a document against this,
   * so without it a continued run detaches from what it is reading.
   */
  scope: z.string().optional(),
  resumed: z.boolean().default(false),
  /**
   * The run this one takes up, when it takes one up.
   *
   * `resumed` says a conversation was continued, not which one.
   * Without the link, the reasoning that led a run to stop has no route back,
   * once the thing that pointed at it is settled,
   * and work spread over three runs reports three costs nothing adds up.
   */
  continues: SkillRunId.optional(),
  // Whose identity the run acts under, matching the caller token it carries.
  // A person for anything a route starts, batch included,
  // and the service account itself for an autonomous run such as the reactor's.
  startedBy: UserId,
  // Set once claude reports its session id, absent if the run errored first.
  sessionId: z.string().min(1).optional(),
  startedAt: Timestamp,
  completedAt: Timestamp.optional(),
  exitCode: z.number().int().optional(),
  /**
   * True when nobody was watching,
   * so nothing it asks will be answered in time to carry it on.
   * Recorded rather than held in memory,
   * because what a run's questions mean outlives the process that spawned it.
   */
  unattended: z.boolean().optional(),
  /**
   * The form this run was asked to produce.
   *
   * Absent on every run made before the question could be asked,
   * and those rendered blocks, which is what the default reads as.
   */
  outputForm: OutputForm.default('blocks'),
})
export type RunRecord = z.infer<typeof RunRecord>

/**
 * Per-session user metadata, separate from RunRecord. The reviewer owns it (rename).
 * Append-only at artifacts/runs/sessions.jsonl, last-wins per sessionId.
 */
export const SessionMetadata = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).nullable(),
  updatedAt: Timestamp,
})
export type SessionMetadata = z.infer<typeof SessionMetadata>

/**
 * One person let into one conversation.
 *
 * The session is the unit rather than the run,
 * because a resumed conversation spans several runs,
 * and sharing one of them would leave the reader half a transcript.
 *
 * Append-only at artifacts/runs/shares.jsonl,
 * last-wins per sessionId and grantee together.
 * Withdrawal appends a record carrying `revokedAt`,
 * so replaying the file in order still ends on the current answer.
 */
export const SessionShare = z.object({
  sessionId: z.string().min(1),
  /** Who may read it. One member per record, no roles and no wildcards. */
  grantee: UserId,
  /** Who let them in. Only the person who started the session can. */
  grantedBy: UserId,
  grantedAt: Timestamp,
  /** Set when the grant is withdrawn, which ends the read. */
  revokedAt: Timestamp.optional(),
})
export type SessionShare = z.infer<typeof SessionShare>
