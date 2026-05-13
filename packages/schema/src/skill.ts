import { z } from 'zod'
import { AbsolutePath, SkillId, SkillRunId, Timestamp, UserId } from './common.js'
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

export const SkillOrigin = z.enum(['builtin', 'workspace', 'extension'])
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
 * Telos-specific extension fields. Live under the `telos:` key of the YAML
 * frontmatter so they never collide with Claude Code's own fields, present
 * or future. Read by `SubprocessSkillRunner` for preflight validation
 * (env / path / MCP availability) before spawning.
 */
export const TelosSkillExtension = z.object({
  requiredEnv: z.array(z.string()).default([]),
  requiredPaths: z.array(z.string()).default([]),
  requiredMcpServers: z.array(McpServerId).default([]),
})
export type TelosSkillExtension = z.infer<typeof TelosSkillExtension>

export const SkillFrontmatter = ClaudeCodeSkillFrontmatter.extend({
  telos: TelosSkillExtension.default({
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
})
export type SkillManifest = z.infer<typeof SkillManifest>

export const SkillEventStarted = z.object({
  type: z.literal('started'),
  runId: SkillRunId,
  skillId: SkillId,
  at: Timestamp,
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
  SkillEventMessage,
  SkillEventToolCall,
  SkillEventToolResult,
  SkillEventArtifactWritten,
  SkillEventCompleted,
  SkillEventError,
])
export type SkillEvent = z.infer<typeof SkillEvent>
