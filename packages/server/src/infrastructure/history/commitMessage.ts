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
    trailers.push(`Clarification-Id: ${message.clarificationId}`)
  if (message.sourceId)
    trailers.push(`Source-Id: ${message.sourceId}`)
  if (message.revertedFrom)
    trailers.push(`Reverted-From: ${message.revertedFrom}`)
  if (message.revertedTo)
    trailers.push(`Reverted-To: ${message.revertedTo}`)
  // Subjects can span lines, reject/skip reasons and answer notes are free text.
  // First line stays the git subject, the rest becomes the commit body,
  // so `parseCommitMessage` can rebuild the whole subject with nothing dropped.
  const [firstLine = '', ...bodyLines] = message.subject.split('\n')
  const body = bodyLines.join('\n').trim()
  const header = body
    ? `${message.kind}: ${firstLine}\n\n${body}`
    : `${message.kind}: ${firstLine}`
  return `${header}\n\n${trailers.join('\n')}\n`
}

export function parseCommitMessage(raw: string): CommitMessage {
  const lines = raw.split('\n')
  const subjectLine = lines[0] ?? ''
  const colonIdx = subjectLine.indexOf(':')
  const firstLine = colonIdx >= 0 ? subjectLine.slice(colonIdx + 1).trim() : subjectLine.trim()

  // Split off the free-text body the serializer stored below the subject,
  // so a multi-line reason or note survives the round-trip intact.
  const { body, trailers } = splitBodyAndTrailers(lines)
  const subject = body ? `${firstLine}\n${body}` : firstLine
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
  if (trailers['Clarification-Id'])
    Object.assign(out, { clarificationId: ClarificationId.parse(trailers['Clarification-Id']) })
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
function splitBodyAndTrailers(lines: readonly string[]): { body: string, trailers: Record<string, string> } {
  const trailers: Record<string, string> = {}
  let bodyEnd = 1
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (line.trim().length === 0) {
      // Blank line fencing the trailer block, the body ends here.
      if (Object.keys(trailers).length > 0) {
        bodyEnd = i
        break
      }
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 1) {
      bodyEnd = i + 1
      break
    }
    const key = line.slice(0, colon)
    if (!TRAILER_KEY_PATTERN.test(key)) {
      bodyEnd = i + 1
      break
    }
    trailers[key] = line.slice(colon + 1).trim()
  }
  return { body: lines.slice(1, bodyEnd).join('\n').trim(), trailers }
}
