import type { AbsolutePath, CommitMessage, ProposalId, UserId } from '@braidhq/schema'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GitWorkspaceHistory } from '../../../src/infrastructure/history/GitWorkspaceHistory.js'
import { makeWorkspace } from '../../helpers/fakes.js'

async function makeRoot(): Promise<AbsolutePath> {
  return (await mkdtemp(join(tmpdir(), 'braid-git-history-'))) as AbsolutePath
}

function applyMessage(overrides: Partial<CommitMessage> = {}): CommitMessage {
  return {
    kind: 'proposal-apply',
    subject: 'Add Order aggregate',
    userId: 'studio-user' as UserId,
    proposalId: 'prop-2026-05-30-aaaa' as ProposalId,
    ...overrides,
  }
}

describe('GitWorkspaceHistory', () => {
  describe('ensureInitialised', () => {
    it('initialises a fresh workspace as a git repo with .gitignore + initial commit', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      await writeFile(join(root, 'PRODUCT.md'), '# product\n', 'utf-8')
      const history = new GitWorkspaceHistory()

      await history.ensureInitialised(workspace)

      expect(existsSync(join(root, '.git'))).toBe(true)
      expect(existsSync(join(root, '.gitignore'))).toBe(true)
      const gitignore = await readFile(join(root, '.gitignore'), 'utf-8')
      // `.braid/` holds the Kùzu DB (per @braidhq/storage-kuzu's
      // path layout) plus any other plugin-local caches.
      expect(gitignore).toContain('.braid/')
      expect(gitignore).toContain('artifacts/runs/')
      // Sources land at the role-derived paths and are re-fetchable.
      expect(gitignore).toContain('intents/')
      expect(gitignore).toContain('codebases/')
      const commits = await history.listCommits(workspace)
      expect(commits).toHaveLength(1)
      expect(commits[0]!.message.kind).toBe('initial')
    })

    it('is idempotent — re-running on an existing repo is a no-op', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      await writeFile(join(root, 'PRODUCT.md'), '# product\n', 'utf-8')
      const history = new GitWorkspaceHistory()

      await history.ensureInitialised(workspace)
      const firstHead = (await history.listCommits(workspace))[0]!.sha
      await history.ensureInitialised(workspace)

      const commits = await history.listCommits(workspace)
      expect(commits).toHaveLength(1)
      expect(commits[0]!.sha).toBe(firstHead)
    })

    it('handles an empty workspace by creating an empty initial commit', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()

      await history.ensureInitialised(workspace)

      const commits = await history.listCommits(workspace)
      expect(commits).toHaveLength(1)
      expect(commits[0]!.message.kind).toBe('initial')
    })
  })

  describe('commit', () => {
    it('round-trips structured message fields into the log', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)

      await writeFile(join(root, 'artifacts.json'), '{"v":1}', 'utf-8')
      const sha = await history.commit(workspace, applyMessage())

      const commit = await history.getCommit(workspace, sha)
      expect(commit).not.toBeNull()
      expect(commit!.message.kind).toBe('proposal-apply')
      expect(commit!.message.subject).toBe('Add Order aggregate')
      expect(commit!.message.proposalId).toBe('prop-2026-05-30-aaaa')
      expect(commit!.message.userId).toBe('studio-user')
    })

    it('returns the current HEAD without a new commit when there are no changes', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)
      const initialCommits = await history.listCommits(workspace)
      const initialHead = initialCommits[0]!.sha

      const result = await history.commit(workspace, applyMessage())

      expect(result).toBe(initialHead)
      expect(await history.listCommits(workspace)).toHaveLength(1)
    })

    it('lists commits newest-first', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)
      await writeFile(join(root, 'a.txt'), '1', 'utf-8')
      const first = await history.commit(workspace, applyMessage({ subject: 'first' }))
      await writeFile(join(root, 'a.txt'), '2', 'utf-8')
      const second = await history.commit(workspace, applyMessage({ subject: 'second' }))

      const commits = await history.listCommits(workspace)

      expect(commits.map(c => c.sha)).toEqual([second, first, commits[2]!.sha])
      expect(commits[0]!.message.subject).toBe('second')
    })
  })

  describe('getCommitDiff', () => {
    it('reports added / modified / removed files for a commit', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)

      await writeFile(join(root, 'model.json'), '{"v":1}', 'utf-8')
      await writeFile(join(root, 'PRODUCT.md'), '# product\n', 'utf-8')
      const sha = await history.commit(workspace, applyMessage())

      const diff = await history.getCommitDiff(workspace, sha)
      const paths = diff.map(d => d.path).sort()
      expect(paths).toContain('model.json')
      expect(paths).toContain('PRODUCT.md')
    })
  })

  describe('readGraphAtCommit', () => {
    it('returns the model.json contents committed at the given sha', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)

      const { mkdir, writeFile: write } = await import('node:fs/promises')
      await mkdir(join(root, 'artifacts'), { recursive: true })
      const v1 = { version: 1, nodes: [{ id: 'n-1', type: 'aggregate', name: 'Order', status: 'draft', metadata: { sourceReferences: [] } }], edges: [] }
      await write(join(root, 'artifacts', 'model.json'), `${JSON.stringify(v1)}\n`, 'utf-8')
      const sha = await history.commit(workspace, applyMessage({ subject: 'v1' }))

      const snapshot = await history.readGraphAtCommit(workspace, sha)
      expect(snapshot.nodes).toHaveLength(1)
      expect(snapshot.nodes[0]!.id).toBe('n-1')
      expect(snapshot.edges).toHaveLength(0)
    })

    it('returns an empty snapshot for commits that pre-date model.json', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)

      const initialSha = (await history.listCommits(workspace))[0]!.sha
      const snapshot = await history.readGraphAtCommit(workspace, initialSha)

      expect(snapshot.nodes).toHaveLength(0)
      expect(snapshot.edges).toHaveLength(0)
    })
  })

  describe('restore', () => {
    it('produces a forward-only commit that brings the working tree back', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)

      await writeFile(join(root, 'model.json'), '{"v":1}', 'utf-8')
      const v1 = await history.commit(workspace, applyMessage({ subject: 'v1' }))
      await writeFile(join(root, 'model.json'), '{"v":2}', 'utf-8')
      await history.commit(workspace, applyMessage({ subject: 'v2' }))

      const restored = await history.restore(workspace, v1, applyMessage({ subject: 'roll back to v1' }))

      const commits = await history.listCommits(workspace)
      expect(commits[0]!.sha).toBe(restored)
      expect(commits[0]!.message.kind).toBe('restore')
      expect(commits[0]!.message.revertedTo).toBe(v1)
      // Working tree reflects v1's content again.
      const onDisk = await readFile(join(root, 'model.json'), 'utf-8')
      expect(onDisk).toBe('{"v":1}')
    })

    it('is idempotent when already at the target sha', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)
      const head = (await history.listCommits(workspace))[0]!.sha

      const result = await history.restore(workspace, head, applyMessage())

      expect(result).toBe(head)
      expect(await history.listCommits(workspace)).toHaveLength(1)
    })
  })

  describe('tags', () => {
    it('creates and lists an annotated tag', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)
      const head = (await history.listCommits(workspace))[0]!.sha

      const tag = await history.tag(workspace, head, 'pre-refactor', 'baseline before rebuilding orders')

      expect(tag.name).toBe('pre-refactor')
      expect(tag.sha).toBe(head)
      expect(tag.note).toBe('baseline before rebuilding orders')
      const tags = await history.listTags(workspace)
      expect(tags.map(t => t.name)).toContain('pre-refactor')
    })

    it('deleteTag removes the pointer but leaves the commit reachable', async () => {
      const root = await makeRoot()
      const workspace = makeWorkspace({ rootPath: root })
      const history = new GitWorkspaceHistory()
      await history.ensureInitialised(workspace)
      const head = (await history.listCommits(workspace))[0]!.sha
      await history.tag(workspace, head, 'pre-refactor')

      await history.deleteTag(workspace, 'pre-refactor')

      const tags = await history.listTags(workspace)
      expect(tags.find(t => t.name === 'pre-refactor')).toBeUndefined()
      expect(await history.getCommit(workspace, head)).not.toBeNull()
    })
  })
})
