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
 * Braid-specific extension fields. Live under the `braid:` key of the YAML
 * frontmatter so they never collide with Claude Code's own fields, present
 * or future. Read by `SubprocessSkillRunner` for preflight validation
 * (env / path / MCP availability) before spawning.
 */
export const BraidSkillExtension = z.object({
  requiredEnv: z.array(z.string()).default([]),
  requiredPaths: z.array(z.string()).default([]),
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
})
export type BraidSkillExtension = z.infer<typeof BraidSkillExtension>

export const SkillFrontmatter = ClaudeCodeSkillFrontmatter.extend({
  braid: BraidSkillExtension.default({
    requiredEnv: [],
    requiredPaths: [],
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
