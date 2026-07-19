import type { CommitMessage } from '@braidhq/schema'
import {
  ClarificationId,
  CommitKind,
  CommitSha,
  ProposalId,
  SourceId,
  UserId,
} from '@braidhq/schema'

// Trailer keys recognised by `git interpret-trailers`,
// so future tooling can lean on the same parser.
const TRAILER_KEY_PATTERN = /^[a-z][a-z-]*$/i

export function serializeCommitMessage(message: CommitMessage): string {
  const trailers: string[] = [
    `Kind: ${message.kind}`,
    `Author: ${message.userId}`,
  ]
  if (message.proposalId)
    trailers.push(`Proposal-Id: ${message.proposalId}`)
  if (message.clarificationId)
    trailers.push(`Clarification-Ticket-Id: ${message.clarificationId}`)
  if (message.sourceId)
    trailers.push(`Source-Id: ${message.sourceId}`)
  if (message.revertedFrom)
    trailers.push(`Reverted-From: ${message.revertedFrom}`)
  if (message.revertedTo)
    trailers.push(`Reverted-To: ${message.revertedTo}`)
  return `${message.kind}: ${message.subject}\n\n${trailers.join('\n')}\n`
}

export function parseCommitMessage(raw: string): CommitMessage {
  const lines = raw.split('\n')
  const subjectLine = lines[0] ?? ''
  const colonIdx = subjectLine.indexOf(':')
  const subject = colonIdx >= 0 ? subjectLine.slice(colonIdx + 1).trim() : subjectLine.trim()

  const trailers = extractTrailers(lines)
  const kindRaw = trailers.Kind ?? subjectLine.slice(0, colonIdx).trim()
  // Fall back to `snapshot` on unknown kinds,
  // so a manual `git commit` from the CLI still renders in the timeline.
  const kind = CommitKind.safeParse(kindRaw).data ?? 'snapshot'
  const userId = UserId.parse(trailers.Author ?? 'unknown')

  const out: CommitMessage = {
    kind,
    subject: subject || `(unsubject ${kind})`,
    userId,
  }
  if (trailers['Proposal-Id'])
    Object.assign(out, { proposalId: ProposalId.parse(trailers['Proposal-Id']) })
  if (trailers['Clarification-Ticket-Id'])
    Object.assign(out, { clarificationId: ClarificationId.parse(trailers['Clarification-Ticket-Id']) })
  if (trailers['Source-Id'])
    Object.assign(out, { sourceId: SourceId.parse(trailers['Source-Id']) })
  if (trailers['Reverted-From'])
    Object.assign(out, { revertedFrom: CommitSha.parse(trailers['Reverted-From']) })
  if (trailers['Reverted-To'])
    Object.assign(out, { revertedTo: CommitSha.parse(trailers['Reverted-To']) })
  return out
}

// indexOf-based scan instead of a single regex,
// to avoid polynomial backtracking against adversarial commit bodies.
function extractTrailers(lines: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (line.trim().length === 0) {
      if (Object.keys(out).length > 0)
        return out
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 1)
      return out
    const key = line.slice(0, colon)
    if (!TRAILER_KEY_PATTERN.test(key))
      return out
    out[key] = line.slice(colon + 1).trim()
  }
  return out
}
