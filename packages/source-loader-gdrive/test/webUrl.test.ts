import type { AbsolutePath, SourceLocation } from '@braidhq/schema'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeManifest } from '../src/Manifest.js'
import { driveWebUrl } from '../src/webUrl.js'

const FILE_ID = '1AbCdEf'

describe('driveWebUrl', () => {
  let destination: AbsolutePath

  beforeEach(async () => {
    destination = await mkdtemp(join(tmpdir(), 'braid-gdrive-weburl-')) as AbsolutePath
  })

  afterEach(async () => {
    await rm(destination, { recursive: true, force: true })
  })

  async function mirror(localDir: string): Promise<void> {
    await writeManifest(destination, {
      folderId: 'folder-1',
      include: undefined,
      exclude: undefined,
      files: { [FILE_ID]: { localDir, modifiedTime: '2026-01-01T00:00:00.000Z', title: 'Spec' } },
    })
  }

  function input(unitPath: string, location: SourceLocation = { uri: 'x' }) {
    return { config: {}, unitPath, location, destination }
  }

  it('addresses the document on Drive, not the export on disk', async () => {
    await mirror('Spec Unit')
    expect(await driveWebUrl(input('Spec Unit/index.md')))
      .toBe(`https://docs.google.com/document/d/${FILE_ID}/edit`)
  })

  // Line numbers describe the local export, so only an anchor survives,
  // and Drive resolves the heading fragment itself.
  it('carries an anchor across as a heading fragment', async () => {
    await mirror('Spec Unit')
    const url = await driveWebUrl(input('Spec Unit/index.md', { uri: 'x', anchor: '2.4 一個章節標題', startLine: 10 }))
    expect(url).toBe(`https://docs.google.com/document/d/${FILE_ID}/edit#heading=${encodeURIComponent('2.4 一個章節標題')}`)
  })

  it('reads the unit off the first path segment, however the path is written', async () => {
    await mirror('Spec Unit')
    expect(await driveWebUrl(input('/Spec Unit/nested/page.md')))
      .toBe(`https://docs.google.com/document/d/${FILE_ID}/edit`)
  })

  it('gives no address for a unit the mirror does not hold', async () => {
    await mirror('Spec Unit')
    expect(await driveWebUrl(input('Something_Else/index.md'))).toBeNull()
  })

  it('gives no address for an empty path, which names no unit', async () => {
    await mirror('Spec Unit')
    expect(await driveWebUrl(input('/'))).toBeNull()
  })

  // A destination with no manifest was never synced by this loader,
  // so there is nothing to map the local copy back to.
  it('gives no address when the mirror has no manifest', async () => {
    expect(await driveWebUrl(input('Spec Unit/index.md'))).toBeNull()
  })
})
