import type { CommitMessage } from '@braidhq/schema'
import {
  ClarifyTicketId,
  CommitKind,
  CommitSha,
  ProposalId,
  SourceId,
  UserId,
} from '@braidhq/schema'

/**
 * Render a structured `CommitMessage` as the raw text that goes into
 * `git commit -m`. Layout:
 *
 *     <kind>: <subject>
 *
 *     Kind: <kind>
 *     Author: <userId>
 *     Proposal-Id: <id>?
 *     Clarify-Ticket-Id: <id>?
 *     Source-Id: <id>?
 *     Reverted-From: <sha>?
 *     Reverted-To: <sha>?
 *
 * The blank line + trailer block is the git-native convention
 * `git interpret-trailers` understands, so future tooling can lean on
 * it without re-parsing.
 */
export function serializeCommitMessage(message: CommitMessage): string {
  const trailers: string[] = [
    `Kind: ${message.kind}`,
    `Author: ${message.userId}`,
  ]
  if (message.proposalId)
    trailers.push(`Proposal-Id: ${message.proposalId}`)
  if (message.clarifyTicketId)
    trailers.push(`Clarify-Ticket-Id: ${message.clarifyTicketId}`)
  if (message.sourceId)
    trailers.push(`Source-Id: ${message.sourceId}`)
  if (message.revertedFrom)
    trailers.push(`Reverted-From: ${message.revertedFrom}`)
  if (message.revertedTo)
    trailers.push(`Reverted-To: ${message.revertedTo}`)

  return `${message.kind}: ${message.subject}\n\n${trailers.join('\n')}\n`
}

/**
 * Parse a git commit message body back into a `CommitMessage`. Falls
 * back to a synthetic `snapshot` kind when the body is missing the
 * `Kind:` trailer — covers manual `git commit` use from the CLI
 * outside the Studio path, so the timeline still renders without
 * crashing.
 */
export function parseCommitMessage(raw: string): CommitMessage {
  const lines = raw.split('\n')
  const subjectLine = lines[0] ?? ''
  const colonIdx = subjectLine.indexOf(':')
  const subject = colonIdx >= 0
    ? subjectLine.slice(colonIdx + 1).trim()
    : subjectLine.trim()

  const trailers = extractTrailers(lines)
  const kindRaw = trailers.Kind ?? subjectLine.slice(0, colonIdx).trim()
  const kind = CommitKind.safeParse(kindRaw).data ?? 'snapshot'
  const userId = UserId.parse(trailers.Author ?? 'unknown')

  const out: CommitMessage = {
    kind,
    subject: subject || `(unsubject ${kind})`,
    userId,
  }
  if (trailers['Proposal-Id'])
    Object.assign(out, { proposalId: ProposalId.parse(trailers['Proposal-Id']) })
  if (trailers['Clarify-Ticket-Id'])
    Object.assign(out, { clarifyTicketId: ClarifyTicketId.parse(trailers['Clarify-Ticket-Id']) })
  if (trailers['Source-Id'])
    Object.assign(out, { sourceId: SourceId.parse(trailers['Source-Id']) })
  if (trailers['Reverted-From'])
    Object.assign(out, { revertedFrom: CommitSha.parse(trailers['Reverted-From']) })
  if (trailers['Reverted-To'])
    Object.assign(out, { revertedTo: CommitSha.parse(trailers['Reverted-To']) })
  return out
}

/**
 * Extract `Key: Value` trailers from the LAST contiguous block of
 * `Key: Value` lines in the message. Mirrors git's own trailer
 * parsing rules: only the trailing block counts, intermediate
 * `Key: Value` text in the body is ignored.
 */
/**
 * Key syntax for a trailer line. Walked over with two indexOf-based
 * checks instead of a single regex with overlapping quantifiers so
 * the parser is immune to polynomial backtracking on adversarial
 * commit bodies.
 */
const TRAILER_KEY_PATTERN = /^[a-z][a-z-]*$/i

function extractTrailers(lines: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  // Walk backwards: collect contiguous `Key: Value` lines until we
  // hit a blank line or a non-trailer line.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (line.trim().length === 0) {
      if (Object.keys(out).length > 0)
        return out
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 1) {
      // Non-trailer line ends the block.
      return out
    }
    const key = line.slice(0, colon)
    if (!TRAILER_KEY_PATTERN.test(key)) {
      return out
    }
    out[key] = line.slice(colon + 1).trim()
  }
  return out
}
