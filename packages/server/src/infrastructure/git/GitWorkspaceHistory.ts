import type { ListCommitsOptions, Workspace, WorkspaceHistory } from '@braidhq/core'
import type {
  CommitMessage,
  CommitMeta,
  FileDiff,
  TagMeta,
  UserId,
} from '@braidhq/schema'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CommitSha, Timestamp, WorkspaceId } from '@braidhq/schema'
import { simpleGit, type SimpleGit } from 'simple-git'
import { parseCommitMessage, serializeCommitMessage } from './commitMessage.js'

// ASCII control chars never appear in commit subjects / refnames.
const LOG_FIELD_SEPARATOR = ''
const LOG_RECORD_SEPARATOR = ''
const GIT_LOG_FORMAT_ARG = `--pretty=tformat:%H${LOG_FIELD_SEPARATOR}%an${LOG_FIELD_SEPARATOR}%ae${LOG_FIELD_SEPARATOR}%aI${LOG_FIELD_SEPARATOR}%P${LOG_FIELD_SEPARATOR}%B${LOG_RECORD_SEPARATOR}`

const TAG_RECORD_SEPARATOR = ''
const TAG_FIELD_SEPARATOR = ''
// `%(*objectname)` dereferences annotated tags to the underlying commit.
const TAG_FORMAT = [
  '%(refname:short)',
  '%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)',
  '%(taggerdate:iso-strict)',
  '%(creatordate:iso-strict)',
  '%(taggername)',
  '%(taggeremail)',
  '%(contents:subject)',
].join(TAG_FIELD_SEPARATOR) + TAG_RECORD_SEPARATOR

// Source content (intents/ + codebases/) lives at fixed locations
// by `sourceDraft.rolePathSegment`. Both are re-fetchable from their
// origin (gdrive / upstream git) so the workspace repo doesn't need
// to mirror them; tracking would nest a `codebases/<name>/.git/`
// inside the workspace repo and bloat history with intent binaries.
const DEFAULT_GITIGNORE = `# Braid auto-generated.

.braid/
.braid-sessions/
.braid-mcp-*.json
artifacts/runs/
intents/
codebases/
.DS_Store
`

// Swapped for the calling user's identity once Theme 13 lands.
const BOOTSTRAP_USER_ID = 'braid-bootstrap' as UserId

// `core.quotePath=false` keeps non-ASCII paths (Chinese / Japanese
// / emoji) intact in `git log` and `--name-status` output.
function openGit(baseDir: string): SimpleGit {
  return simpleGit({
    baseDir,
    config: ['core.quotePath=false', 'i18n.logoutputencoding=utf-8'],
  })
}

export class GitWorkspaceHistory implements WorkspaceHistory {
  async ensureInitialised(workspace: Workspace): Promise<void> {
    const root = workspace.rootPath
    if (existsSync(join(root, '.git'))) {
      return
    }
    const git = openGit(root)
    await git.init()

    const gitignorePath = join(root, '.gitignore')
    if (!existsSync(gitignorePath))
      await writeFile(gitignorePath, DEFAULT_GITIGNORE, 'utf-8')

    // Idempotency guard above means this only runs once per workspace.
    await git.add(['-A'])
    const status = await git.status()
    if (status.staged.length === 0 && status.created.length === 0 && status.not_added.length === 0) {
      // Empty initial so HEAD exists for later commits to parent on.
      await this.commitWithMeta(git, {
        kind: 'initial',
        subject: 'workspace registered',
        userId: BOOTSTRAP_USER_ID,
      }, { allowEmpty: true })
      return
    }
    await this.commitWithMeta(git, {
      kind: 'initial',
      subject: 'workspace registered',
      userId: BOOTSTRAP_USER_ID,
    }, { allowEmpty: false })
  }

  async commit(workspace: Workspace, message: CommitMessage): Promise<CommitSha> {
    const git = openGit(workspace.rootPath)
    await git.add(['-A'])
    const status = await git.status()
    // No staged changes? Return the current HEAD so callers can treat
    // a redundant commit attempt as a no-op without raising. This
    // makes "reject a proposal but the artifact write was already
    // persisted by an earlier path" safe to call.
    if (!status.staged.length && !status.created.length && !status.deleted.length && !status.modified.length && !status.renamed.length) {
      const head = await git.revparse(['HEAD'])
      return CommitSha.parse(head.trim())
    }
    return this.commitWithMeta(git, message, { allowEmpty: false })
  }

  async listCommits(
    workspace: Workspace,
    options?: ListCommitsOptions,
  ): Promise<readonly CommitMeta[]> {
    const git = openGit(workspace.rootPath)
    const limit = options?.limit ?? 50
    const args = ['log', `--max-count=${limit}`, GIT_LOG_FORMAT_ARG]
    if (options?.since)
      args.splice(1, 0, `${options.since}^`)
    const raw = await git.raw(args).catch((err: unknown) => {
      // Fresh repo with no commits: `git log` exits non-zero. Treat
      // as empty rather than propagating noise.
      if (looksLikeNoCommits(err))
        return ''
      throw err
    })
    if (!raw.trim())
      return []
    return splitLogRecords(raw).map(rec => parseLogRecord(rec, workspace.id))
  }

  async getCommit(workspace: Workspace, sha: CommitSha): Promise<CommitMeta | null> {
    const git = openGit(workspace.rootPath)
    try {
      const raw = await git.raw(['show', '--no-patch', GIT_LOG_FORMAT_ARG, sha])
      if (!raw.trim())
        return null
      return parseLogRecord(raw.trim(), workspace.id)
    }
    catch (err) {
      if (looksLikeUnknownRevision(err))
        return null
      throw err
    }
  }

  async getCommitDiff(workspace: Workspace, sha: CommitSha): Promise<readonly FileDiff[]> {
    const git = openGit(workspace.rootPath)
    // `--root` makes the root commit (no parent) still diff against
    // the empty tree, giving "everything added" instead of an error.
    const raw = await git.raw(['show', '--name-status', '--root', '--format=', sha]).catch((err: unknown) => {
      if (looksLikeUnknownRevision(err))
        return ''
      throw err
    })
    return parseNameStatus(raw)
  }

  async restore(
    workspace: Workspace,
    targetSha: CommitSha,
    message: CommitMessage,
  ): Promise<CommitSha> {
    const git = openGit(workspace.rootPath)
    const headRaw = await git.revparse(['HEAD'])
    const head = CommitSha.parse(headRaw.trim())
    if (head === targetSha)
      return head
    // Plain `checkout <sha> -- .` only restores files present in <sha>;
    // we want the working tree to match <sha> EXACTLY, so files added
    // after <sha> must be removed too.
    await git.raw(['read-tree', targetSha])
    await git.raw(['checkout-index', '--force', '--all'])
    await git.raw(['clean', '-fd'])
    await git.add(['-A'])
    return this.commitWithMeta(git, {
      ...message,
      kind: 'restore',
      revertedFrom: head,
      revertedTo: targetSha,
    }, { allowEmpty: false })
  }

  async tag(
    workspace: Workspace,
    sha: CommitSha,
    name: string,
    note?: string,
  ): Promise<TagMeta> {
    const git = openGit(workspace.rootPath)
    if (note) {
      // Annotated tags create a tag object that needs a committer
      // identity; pin it inline so CI runners without global git
      // config don't fail.
      await git.raw([
        '-c',
        `user.name=${BOOTSTRAP_USER_ID}`,
        '-c',
        `user.email=${BOOTSTRAP_USER_ID}@braid.local`,
        'tag',
        '-a',
        name,
        sha,
        '-m',
        note,
      ])
    }
    else {
      await git.raw(['tag', name, sha])
    }
    return readTagByName(git, name)
  }

  async listTags(workspace: Workspace): Promise<readonly TagMeta[]> {
    const git = openGit(workspace.rootPath)
    const raw = await git.raw(['tag', '-l', `--format=${TAG_FORMAT}`]).catch(() => '')
    if (!raw.trim())
      return []
    return raw.split(TAG_RECORD_SEPARATOR)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(parseTagRecord)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async deleteTag(workspace: Workspace, name: string): Promise<void> {
    const git = openGit(workspace.rootPath)
    await git.raw(['tag', '-d', name])
  }

  // Internal — share the commit-with-author dance between
  // `ensureInitialised`, `commit`, and `restore` so the author /
  // empty-commit policy stays in one place.
  private async commitWithMeta(
    git: SimpleGit,
    message: CommitMessage,
    options: { allowEmpty: boolean },
  ): Promise<CommitSha> {
    const body = serializeCommitMessage(message)
    const args = ['commit', '-m', body]
    if (options.allowEmpty)
      args.push('--allow-empty')
    const author = `${message.userId} <${message.userId}@braid.local>`
    args.push(`--author=${author}`)
    await git.raw(['-c', `user.name=${message.userId}`, '-c', `user.email=${message.userId}@braid.local`, ...args])
    const head = await git.revparse(['HEAD'])
    return CommitSha.parse(head.trim())
  }
}

// Trailing-separator strip uses a loop, not regex, to dodge backtracking.
function parseLogRecord(record: string, workspaceId: string): CommitMeta {
  const [shaLine, authorName, authorEmail, committedAt, parents, ...bodyLines] = record.split(LOG_FIELD_SEPARATOR)
  let body = bodyLines.join(LOG_FIELD_SEPARATOR)
  while (body.endsWith(LOG_RECORD_SEPARATOR))
    body = body.slice(0, -LOG_RECORD_SEPARATOR.length)
  body = body.trim()
  return {
    sha: CommitSha.parse(shaLine!.trim()),
    workspaceId: WorkspaceId.parse(workspaceId),
    message: parseCommitMessage(body),
    author: { name: authorName!.trim(), email: authorEmail!.trim() },
    committedAt: Timestamp.parse(committedAt!.trim()),
    parents: parents!.trim()
      ? parents!.trim().split(' ').map(s => CommitSha.parse(s.trim()))
      : [],
    // Stats are computed lazily via `getCommitDiff`. Embedding them
    // here would mean N extra diff calls per list page.
    stats: null,
  }
}

async function readTagByName(git: SimpleGit, name: string): Promise<TagMeta> {
  const raw = await git.raw(['tag', '-l', `--format=${TAG_FORMAT}`, name])
  const record = raw.split(TAG_RECORD_SEPARATOR).map(s => s.trim()).find(s => s.length > 0)
  if (!record)
    throw new Error(`Tag "${name}" not found immediately after creation`)
  return parseTagRecord(record)
}

function parseTagRecord(record: string): TagMeta {
  const parts = record.split(TAG_FIELD_SEPARATOR)
  const [name, sha, taggerDate, creatorDate, taggerName, taggerEmail, note] = parts
  const createdRaw = (taggerDate ?? '').trim() || (creatorDate ?? '').trim()
  return {
    name: (name ?? '').trim(),
    sha: CommitSha.parse((sha ?? '').trim()),
    createdAt: Timestamp.parse(createdRaw),
    ...(note && note.trim() ? { note: note.trim() } : {}),
    ...((taggerName?.trim() && taggerEmail?.trim())
      ? {
          taggedBy: {
            name: taggerName.trim(),
            email: taggerEmail.trim().replace(/^<|>$/g, ''),
          },
        }
      : {}),
  }
}

function parseNameStatus(raw: string): FileDiff[] {
  const out: FileDiff[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim())
      continue
    const cols = line.split('\t')
    const code = cols[0]?.trim() ?? ''
    if (code.startsWith('R') && cols.length >= 3) {
      out.push({ path: cols[2]!.trim(), status: 'renamed', previousPath: cols[1]!.trim() })
      continue
    }
    const path = cols[1]?.trim()
    if (!path)
      continue
    out.push({ path, status: statusFromCode(code[0]) })
  }
  return out
}

function splitLogRecords(raw: string): string[] {
  return raw.split(LOG_RECORD_SEPARATOR).map(s => s.trim()).filter(s => s.length > 0)
}

// Unknown status letters fall back to `modified` so the row still surfaces.
function statusFromCode(code: string | undefined): 'added' | 'modified' | 'removed' {
  switch (code) {
    case 'A':
    case 'C':
      return 'added'
    case 'D':
      return 'removed'
    case 'M':
      return 'modified'
    default:
      return 'modified'
  }
}

function looksLikeNoCommits(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /does not have any commits yet|bad default revision/i.test(msg)
}

function looksLikeUnknownRevision(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /unknown revision|bad revision|ambiguous argument/i.test(msg)
}
