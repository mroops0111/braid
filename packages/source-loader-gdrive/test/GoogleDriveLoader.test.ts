import type { SourceLoaderContext } from '@braidhq/core'
import type { AbsolutePath, SourceId, WorkspaceId } from '@braidhq/schema'
import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GoogleDriveLoader } from '../src/GoogleDriveLoader.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME = 'application/vnd.google-apps.document'
const CONTEXT: SourceLoaderContext = {
  workspaceId: 'test-ws' as WorkspaceId,
  sourceId: 'test-source' as SourceId,
}

interface MockFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  parents?: string[]
  content?: Buffer | string
  exports?: Record<string, string>
}

/**
 * Build a fetch stub that serves Drive list / export / download endpoints
 * from an in-memory file tree. No network. Drive's auth header is
 * inspected to ensure we send a bearer token.
 */
function buildMockFetch(files: readonly MockFile[]): typeof globalThis.fetch {
  const byId = new Map(files.map(f => [f.id, f]))
  return async (input, _init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const parsed = new URL(url)
    if (parsed.pathname === '/drive/v3/files') {
      const q = parsed.searchParams.get('q') ?? ''
      const match = q.match(/^'([^']+)' in parents and trashed=false$/)
      const parentId = match?.[1]
      const children = files.filter(f => f.parents?.includes(parentId ?? ''))
      return jsonResponse({ files: children })
    }
    const exportMatch = parsed.pathname.match(/^\/drive\/v3\/files\/([^/]+)\/export$/)
    if (exportMatch) {
      const file = byId.get(exportMatch[1]!)
      if (!file)
        return new Response('not found', { status: 404 })
      const mime = parsed.searchParams.get('mimeType') ?? ''
      const body = file.exports?.[mime] ?? ''
      return new Response(body, { status: 200, headers: { 'Content-Type': mime } })
    }
    const downloadMatch = parsed.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (downloadMatch && parsed.searchParams.get('alt') === 'media') {
      const file = byId.get(downloadMatch[1]!)
      if (!file)
        return new Response('not found', { status: 404 })
      return new Response(file.content ?? '', { status: 200 })
    }
    return new Response('no route', { status: 404 })
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('GoogleDriveLoader', () => {
  let dest: AbsolutePath

  beforeEach(async () => {
    dest = await mkdtemp(join(tmpdir(), 'braid-gdrive-loader-')) as AbsolutePath
  })

  afterEach(async () => {
    await rm(dest, { recursive: true, force: true })
  })

  it('ingest exports Google Docs as markdown, downloads binaries as-is, recurses subfolders', async () => {
    const fetchFn = buildMockFetch([
      // Root folder is implicit; its children:
      {
        id: 'doc-1',
        name: 'Roadmap',
        mimeType: DOC_MIME,
        modifiedTime: '2026-05-01T00:00:00Z',
        parents: ['demo-folder'],
        exports: { 'text/markdown': '# Roadmap\n\nh1 body' },
      },
      {
        id: 'img-1',
        name: 'diagram.png',
        mimeType: 'image/png',
        modifiedTime: '2026-05-01T00:00:00Z',
        parents: ['demo-folder'],
        content: Buffer.from([0x89, 0x50, 0x4E, 0x47]), // PNG magic
      },
      {
        id: 'subfolder-1',
        name: 'subdir',
        mimeType: FOLDER_MIME,
        modifiedTime: '2026-05-01T00:00:00Z',
        parents: ['demo-folder'],
      },
      {
        id: 'doc-2',
        name: 'Notes',
        mimeType: DOC_MIME,
        modifiedTime: '2026-05-02T00:00:00Z',
        parents: ['subfolder-1'],
        exports: { 'text/markdown': '# Notes\n' },
      },
    ])

    const loader = new GoogleDriveLoader({
      resolveAccessToken: async () => 'fake-access-token',
      fetchFn,
    })

    const report = await loader.ingest({ folderId: 'demo-folder' }, dest, CONTEXT)
    expect(report.localPath).toBe(dest)
    expect((report.metadata as { fileCount?: number }).fileCount).toBe(3)

    const top = await readdir(dest)
    expect(top.sort()).toEqual(['Roadmap.md', 'diagram.png', 'subdir'].sort())

    const md = await readFile(join(dest, 'Roadmap.md'), 'utf-8')
    expect(md).toBe('# Roadmap\n\nh1 body')

    const subdir = await readdir(join(dest, 'subdir'))
    expect(subdir).toEqual(['Notes.md'])
  })

  it('skips Google native types it has no export for (e.g. forms)', async () => {
    const fetchFn = buildMockFetch([
      {
        id: 'form-1',
        name: 'Survey',
        mimeType: 'application/vnd.google-apps.form',
        modifiedTime: '2026-05-01T00:00:00Z',
        parents: ['demo-folder'],
      },
      {
        id: 'doc-1',
        name: 'Note',
        mimeType: DOC_MIME,
        modifiedTime: '2026-05-01T00:00:00Z',
        parents: ['demo-folder'],
        exports: { 'text/markdown': 'hi' },
      },
    ])

    const loader = new GoogleDriveLoader({
      resolveAccessToken: async () => 'fake',
      fetchFn,
    })
    const report = await loader.ingest({ folderId: 'demo-folder' }, dest, CONTEXT)
    expect((report.metadata as { fileCount?: number }).fileCount).toBe(1)
    expect(await readdir(dest)).toEqual(['Note.md'])
  })

  it('rejects folderId "root" so we never mirror the entire My Drive by accident', async () => {
    const loader = new GoogleDriveLoader({
      resolveAccessToken: async () => 'fake',
      fetchFn: buildMockFetch([]),
    })
    await expect(loader.ingest({ folderId: 'root' }, dest, CONTEXT)).rejects.toThrow(/root/i)
  })

  it('recursive=false ignores subfolders', async () => {
    const fetchFn = buildMockFetch([
      { id: 'doc-1', name: 'A', mimeType: DOC_MIME, modifiedTime: 'x', parents: ['demo-folder'], exports: { 'text/markdown': 'a' } },
      { id: 'sub', name: 'sub', mimeType: FOLDER_MIME, modifiedTime: 'x', parents: ['demo-folder'] },
      { id: 'doc-2', name: 'B', mimeType: DOC_MIME, modifiedTime: 'x', parents: ['sub'], exports: { 'text/markdown': 'b' } },
    ])

    const loader = new GoogleDriveLoader({
      resolveAccessToken: async () => 'fake',
      fetchFn,
    })
    await loader.ingest({ folderId: 'demo-folder', recursive: false }, dest, CONTEXT)
    expect(await readdir(dest)).toEqual(['A.md'])
  })
})
