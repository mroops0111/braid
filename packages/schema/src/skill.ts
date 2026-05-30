import { z } from 'zod'
import { AbsolutePath, PluginId, SkillId, SkillRunId, Timestamp, UserId, WorkspaceId } from './common.js'
import { McpServerId } from './mcp.js'

export const SkillRunStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled'])
export type SkillRunStatus = z.infer<typeof SkillRunStatus>

export const SkillRun = z.object({
  id: SkillRunId,
  skillId: SkillId,
  startedAt: Timestamp,
  finishedAt: Timestamp.optional(),
  status: SkillRunStatus,
  triggeredBy: UserId,
  durationMs: z.number().int().nonnegative().optional(),
  tokensUsed: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
})
export type SkillRun = z.infer<typeof SkillRun>

export const SkillOrigin = z.enum(['builtin', 'plugin', 'workspace', 'extension'])
export type SkillOrigin = z.infer<typeof SkillOrigin>

/**
 * Frontmatter fields recognised by the Claude Code CLI itself. Anything in
 * this object lives at the top level of the YAML block; the CLI reads these
 * to register the slash command, enforce invocation rules, etc.
 *
 * Keep camelCase in TS but emit kebab-case in YAML (handled by the
 * frontmatter parser's key normaliser).
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

/**
 * Which sidebar group a skill belongs to. Maps 1:1 onto a Studio UI
 * section; no derivation layer in between.
 *
 *   ask      -> read-only Q&A / analysis (valid at any point)
 *   build    -> mutate the graph via proposals (extract / clarify / model)
 *   generate -> produce artifacts from the graph (docs, .feature, designs)
 *
 * Optional. Skills without a category land in the "Custom" bucket at the
 * end of the sidebar, which is a fine spot for one-off workspace skills
 * that don't fit the canonical workflow.
 */
export const SkillCategory = z.enum(['ask', 'build', 'generate'])
export type SkillCategory = z.infer<typeof SkillCategory>

/**
 * Skill input descriptor — declarative form schema rendered by Studio's
 * Actions page. Phase 1 supports `text` and `pick` with the `static`
 * provider only; dynamic providers (graph-node / source-intent / clarify
 * / proposal) come in phase 2; `multi-pick` (for batch runs) in phase 3.
 *
 * Naming follows `docs/domain-vocabulary.md`: provider type ids are
 * `<domain>` or `<domain>-<sub>`, lowercase hyphen-separated, singular.
 *
 * Skills without an `inputs` block fall back to the legacy single
 * textarea driven by `argumentHint` on the parent frontmatter.
 */
export const SkillInputStaticOption = z.object({
  value: z.string(),
  label: z.string().min(1),
  description: z.string().optional(),
})
export type SkillInputStaticOption = z.infer<typeof SkillInputStaticOption>

export const SkillInputStaticProvider = z.object({
  type: z.literal('static'),
  options: z.array(SkillInputStaticOption).min(1),
})
export type SkillInputStaticProvider = z.infer<typeof SkillInputStaticProvider>

/**
 * Dynamic provider: pulls graph nodes from the workspace, optionally
 * filtered by type / status / renderHint. Returns one option per node
 * with `value = node.id`. See `docs/domain-vocabulary.md` § Provider
 * Catalog for the naming rule (`<domain>-<sub>`).
 */
export const SkillInputGraphNodeProvider = z.object({
  type: z.literal('graph-node'),
  filter: z.object({
    types: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    /**
     * Filters by `NodeTypeDescriptor.renderHint`. `container: true`
     * picks node types whose ontology metadata flags them as a
     * top-level container (e.g. boundedContext in the DDD ontology).
     */
    renderHint: z.object({ container: z.boolean().optional() }).optional(),
  }).optional(),
})
export type SkillInputGraphNodeProvider = z.infer<typeof SkillInputGraphNodeProvider>

/**
 * Dynamic provider: enumerates items from every `role: 'intent'`
 * source declared in the workspace's PRODUCT.md. Items are individual
 * documents the loader has synced onto disk; the value is the
 * loader-relative path so the skill can quote it directly.
 */
export const SkillInputSourceIntentProvider = z.object({
  type: z.literal('source-intent'),
  filter: z.object({
    /** Restrict to sources whose loader.kind matches (e.g. `gdrive`). Omit to include all. */
    loaderKind: z.string().optional(),
  }).optional(),
})
export type SkillInputSourceIntentProvider = z.infer<typeof SkillInputSourceIntentProvider>

/**
 * Dynamic provider: clarify tickets in the workspace, filtered by
 * status. Defaults to all statuses if no filter is given.
 */
export const SkillInputClarifyProvider = z.object({
  type: z.literal('clarify'),
  filter: z.object({
    status: z.enum(['pending', 'answered', 'applied', 'skipped']).optional(),
  }).optional(),
})
export type SkillInputClarifyProvider = z.infer<typeof SkillInputClarifyProvider>

export const SkillInputProvider = z.discriminatedUnion('type', [
  SkillInputStaticProvider,
  SkillInputGraphNodeProvider,
  SkillInputSourceIntentProvider,
  SkillInputClarifyProvider,
])
export type SkillInputProvider = z.infer<typeof SkillInputProvider>

/**
 * What the form does when a dynamic provider returns zero options.
 *   text     - swap the picker for a free-text input
 *   disabled - render the picker disabled with a "no options" message
 *
 * Defaults to `text`. Skills that strictly need a server-side
 * selection (e.g. clarify ticket id) should set `disabled`.
 */
export const SkillInputFallback = z.enum(['text', 'disabled']).default('text')
export type SkillInputFallback = z.infer<typeof SkillInputFallback>

const SkillInputBaseShape = {
  /** Identifier the form binds to. Composed into the skill's $ARGUMENTS at run-time. */
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'Input name must be a lowerCamelCase identifier'),
  /** UI label shown above the control. */
  label: z.string().min(1),
  /** Optional helper text shown under the control. */
  description: z.string().optional(),
  /** When true, the input may be left empty and is not required to submit. Defaults to false (i.e. required). */
  optional: z.boolean().default(false),
  /** Optional default value pre-filled into the control. */
  default: z.string().optional(),
  /** Placeholder shown when empty. */
  placeholder: z.string().optional(),
}

export const SkillInputText = z.object({
  ...SkillInputBaseShape,
  kind: z.literal('text'),
  /** When true, renders as a multi-line textarea instead of single-line input. */
  multiline: z.boolean().default(false),
})
export type SkillInputText = z.infer<typeof SkillInputText>

export const SkillInputPick = z.object({
  ...SkillInputBaseShape,
  kind: z.literal('pick'),
  provider: SkillInputProvider,
  fallback: SkillInputFallback,
})
export type SkillInputPick = z.infer<typeof SkillInputPick>

export const SkillInputMultiPick = z.object({
  ...SkillInputBaseShape,
  kind: z.literal('multi-pick'),
  provider: SkillInputProvider,
  fallback: SkillInputFallback,
})
export type SkillInputMultiPick = z.infer<typeof SkillInputMultiPick>

export const SkillInputDescriptor = z.discriminatedUnion('kind', [SkillInputText, SkillInputPick, SkillInputMultiPick])
export type SkillInputDescriptor = z.infer<typeof SkillInputDescriptor>

/**
 * One option returned by the skill-input-options endpoint. Same shape
 * for all providers; the `value` field is what the form submits and
 * `label` / `description` are display only.
 */
export const SkillInputDynamicOption = z.object({
  value: z.string(),
  label: z.string().min(1),
  description: z.string().optional(),
})
export type SkillInputDynamicOption = z.infer<typeof SkillInputDynamicOption>

export const SkillInputOptionsResponse = z.object({
  items: z.array(SkillInputDynamicOption),
})
export type SkillInputOptionsResponse = z.infer<typeof SkillInputOptionsResponse>

/**
 * Braid-specific extension fields. Live under the `braid:` key of the YAML
 * frontmatter so they never collide with Claude Code's own fields, present
 * or future. Read by `SubprocessSkillRunner` for preflight validation
 * (env / path / MCP availability) before spawning.
 */
export const BraidSkillExtension = z.object({
  requiredEnv: z.array(z.string()).default([]),
  requiredMcpServers: z.array(McpServerId).default([]),
  category: SkillCategory.optional(),
  /**
   * Within the `build` category, the canonical step number (1, 2, 3, …).
   * Studio sorts build skills by this. Ignored for ask / generate where
   * inter-skill order is not semantically meaningful.
   */
  order: z.number().int().positive().optional(),
  /**
   * One-line tagline (≤ 80 chars) for narrow Studio surfaces (sidebars,
   * cards) where `description` is too long. When absent, Studio falls
   * back to the first sentence of `description`.
   *
   * Lives under `braid:` because Claude Code itself doesn't recognise
   * the field; keeping it out of the top-level frontmatter avoids
   * polluting the CLI's namespace.
   */
  summary: z.string().min(1).max(80).optional(),
  /**
   * Declarative form schema for the Studio Actions page. When omitted,
   * Studio falls back to the legacy single textarea driven by
   * `argumentHint`. See SkillInputDescriptor for the per-field shape and
   * `docs/domain-vocabulary.md` for the provider naming taxonomy.
   */
  inputs: z.array(SkillInputDescriptor).optional(),
})
export type BraidSkillExtension = z.infer<typeof BraidSkillExtension>

export const SkillFrontmatter = ClaudeCodeSkillFrontmatter.extend({
  braid: BraidSkillExtension.default({
    requiredEnv: [],
    requiredMcpServers: [],
  }),
})
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>

export const SkillManifest = z.object({
  id: SkillId,
  origin: SkillOrigin,
  path: AbsolutePath,
  frontmatter: SkillFrontmatter,
  extensionPath: AbsolutePath.optional(),
  /** Set when `origin === 'plugin'`: which plugin contributed this skill. */
  pluginId: PluginId.optional(),
})
export type SkillManifest = z.infer<typeof SkillManifest>

export const SkillEventStarted = z.object({
  type: z.literal('started'),
  runId: SkillRunId,
  skillId: SkillId,
  /** The user-supplied argument string for this run (shown in the transcript). */
  args: z.string(),
  /** True when this run resumed an existing claude session (follow-up turn). */
  resumed: z.boolean().default(false),
  at: Timestamp,
})

/**
 * Captured once claude reports its conversation session id. The frontend
 * keeps this and passes it back on the next run to continue the same
 * conversation via `claude --resume`.
 */
export const SkillEventSessionStarted = z.object({
  type: z.literal('session-started'),
  sessionId: z.string().min(1),
})

export const SkillEventMessage = z.object({
  type: z.literal('message'),
  text: z.string(),
})

export const SkillEventToolCall = z.object({
  type: z.literal('tool-call'),
  tool: z.string().min(1),
  args: z.unknown(),
  /** Stable id from the agent's stream, used to pair with a tool-result. */
  toolCallId: z.string().min(1).optional(),
})

export const SkillEventToolResult = z.object({
  type: z.literal('tool-result'),
  toolCallId: z.string().min(1),
  output: z.string(),
  isError: z.boolean(),
})

export const SkillArtifactKind = z.enum(['proposal', 'clarify', 'decision', 'view'])
export type SkillArtifactKind = z.infer<typeof SkillArtifactKind>

export const SkillEventArtifactWritten = z.object({
  type: z.literal('artifact-written'),
  artifactKind: SkillArtifactKind,
  artifactId: z.string().min(1),
  path: AbsolutePath,
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

export const SkillEvent = z.discriminatedUnion('type', [
  SkillEventStarted,
  SkillEventSessionStarted,
  SkillEventMessage,
  SkillEventToolCall,
  SkillEventToolResult,
  SkillEventArtifactWritten,
  SkillEventCompleted,
  SkillEventError,
])
export type SkillEvent = z.infer<typeof SkillEvent>

/**
 * Persisted summary of a single skill run, written to the workspace's
 * `artifacts/runs/index.jsonl` (append-only). The same runId can appear in
 * multiple lines as the run progresses (started, session-started, completed);
 * the reader keeps the last entry per runId.
 *
 * The full event stream for a run lives separately at
 * `artifacts/runs/<runId>.jsonl` (one SkillEvent per line).
 */
export const RunRecord = z.object({
  runId: SkillRunId,
  workspaceId: WorkspaceId,
  skillId: SkillId,
  args: z.string(),
  resumed: z.boolean().default(false),
  /** Set once claude reports its session id; absent for runs that errored before that point. */
  sessionId: z.string().min(1).optional(),
  startedAt: Timestamp,
  completedAt: Timestamp.optional(),
  exitCode: z.number().int().optional(),
})
export type RunRecord = z.infer<typeof RunRecord>

/**
 * Per-session user-facing metadata. Stored separately from `RunRecord`
 * because the lifecycle is owned by the reviewer (rename / future
 * pin / colour) rather than the run itself. Persists at
 * `artifacts/runs/sessions.jsonl` (append-only, last-wins per
 * `sessionId`).
 */
export const SessionMetadata = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).nullable(),
  updatedAt: Timestamp,
})
export type SessionMetadata = z.infer<typeof SessionMetadata>
