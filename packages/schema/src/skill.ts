import { z } from 'zod'
import { AbsolutePath, PluginId, SkillId, SkillRunId, SourceId, Timestamp, UserId, WorkspaceId } from './common.js'
import { McpServerId } from './mcp.js'
import { WorkspaceRole } from './workspace.js'

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

// Frontmatter the Claude Code CLI reads to register the slash command and invocation rules.
// camelCase in TS, emitted as kebab-case in YAML.
export const ClaudeCodeSkillFrontmatter = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  argumentHint: z.string().optional(),
  disableModelInvocation: z.boolean().default(false),
  allowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
})
export type ClaudeCodeSkillFrontmatter = z.infer<typeof ClaudeCodeSkillFrontmatter>

// Studio sidebar section, mapped 1:1.
// ask: read-only Q&A. build: mutate the graph. generate: produce artifacts.
export const SkillCategory = z.enum(['ask', 'build', 'generate'])
export type SkillCategory = z.infer<typeof SkillCategory>

// Declarative form schema rendered by Studio's Actions page.
// Skills without an inputs block fall back to the legacy argumentHint textarea.
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

// Pulls graph nodes, optionally filtered by type / status / renderHint. value = node.id.
export const SkillInputGraphNodeProvider = z.object({
  type: z.literal('graph-node'),
  filter: z.object({
    types: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    // container: true picks node types flagged as top-level containers (e.g. boundedContext).
    renderHint: z.object({ container: z.boolean().optional() }).optional(),
  }).optional(),
})
export type SkillInputGraphNodeProvider = z.infer<typeof SkillInputGraphNodeProvider>

// Enumerates items from every role:intent source. value is the loader-relative path.
export const SkillInputSourceIntentProvider = z.object({
  type: z.literal('source-intent'),
  filter: z.object({
    // Restrict to sources whose loader.kind matches. Omit to include all.
    loaderKind: z.string().optional(),
  }).optional(),
})
export type SkillInputSourceIntentProvider = z.infer<typeof SkillInputSourceIntentProvider>

// Clarify tickets, filtered by status. Defaults to all statuses.
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

// What the form does on zero options.
// text: swap to free-text (default). disabled: for server-required selections.
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

// One options-endpoint option. value is submitted, label/description are display only.
export const SkillInputDynamicOption = z.object({
  value: z.string(),
  label: z.string().min(1),
  description: z.string().optional(),
  // Set by the source-intent provider so a run can report which source unit it processed.
  // Empty for providers that don't speak in source units (graph-node, clarify).
  sourceId: SourceId.optional(),
})
export type SkillInputDynamicOption = z.infer<typeof SkillInputDynamicOption>

export const SkillInputOptionsResponse = z.object({
  items: z.array(SkillInputDynamicOption),
})
export type SkillInputOptionsResponse = z.infer<typeof SkillInputOptionsResponse>

// Braid-specific fields under the braid: key so they never collide with Claude Code's own.
// Read by SubprocessSkillRunner for preflight (env / path / MCP) before spawning.
export const BraidSkillExtension = z.object({
  requiredEnv: z.array(z.string()).default([]),
  requiredMcpServers: z.array(McpServerId).default([]),
  category: SkillCategory.optional(),
  // Step number within build, Studio sorts by it. Ignored for ask / generate.
  order: z.number().int().positive().optional(),
  // One-line tagline for narrow Studio surfaces, else description's first sentence.
  summary: z.string().min(1).max(80).optional(),
  // Declarative form for the Actions page. Omitted falls back to the argumentHint textarea.
  inputs: z.array(SkillInputDescriptor).optional(),
  // Server-side orchestration only, hidden from Studio's Actions list.
  hidden: z.boolean().optional(),
  // Roles allowed to run this by default (owner implicit). Defaults to owner + maintainer.
  // Add guest for read-only skills. Per-member skillOverrides take precedence.
  allowedRoles: z.array(WorkspaceRole).min(1).default(['owner', 'maintainer']),
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
  at: Timestamp,
})

// The claude session id, passed back on the next run to continue via claude --resume.
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
  // Stable id from the agent's stream, pairs with a tool-result.
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

// Append-only run summary in artifacts/runs/index.jsonl, reader keeps the last line per runId.
// The full event stream lives at artifacts/runs/<runId>.jsonl.
export const RunRecord = z.object({
  runId: SkillRunId,
  workspaceId: WorkspaceId,
  skillId: SkillId,
  args: z.string(),
  resumed: z.boolean().default(false),
  // Set once claude reports its session id, absent if the run errored first.
  sessionId: z.string().min(1).optional(),
  startedAt: Timestamp,
  completedAt: Timestamp.optional(),
  exitCode: z.number().int().optional(),
})
export type RunRecord = z.infer<typeof RunRecord>

// Per-session user metadata, separate from RunRecord since the reviewer owns it (rename).
// Append-only at artifacts/runs/sessions.jsonl, last-wins per sessionId.
export const SessionMetadata = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).nullable(),
  updatedAt: Timestamp,
})
export type SessionMetadata = z.infer<typeof SessionMetadata>
