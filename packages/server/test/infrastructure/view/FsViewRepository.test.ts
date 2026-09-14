import type { AbsolutePath, EmittedBlock } from '@braidhq/schema'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeWorkspace } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { FsViewRepository } from '../../../src/infrastructure/view/FsViewRepository.js'

let root: string
let workspace: ReturnType<typeof makeWorkspace>
const repository = new FsViewRepository()

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'braid-views-'))
  workspace = makeWorkspace({ rootPath: root as AbsolutePath })
})

const BLOCK: EmittedBlock = {
  id: 'b-1' as EmittedBlock['id'],
  block: { call: 'showAnswer', markdown: 'the opening passage', audiences: [] },
}

async function seed(path: string, text: string): Promise<void> {
  const full = join(root, 'artifacts', 'views', path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, text, 'utf-8')
}

describe('FsViewRepository.list', () => {
  it('finds every file however deeply it is nested, named from the views root', async () => {
    await seed('doc/reference/ctx.html', '[]')
    await seed('doc/tutorial/ctx.html', '[]')

    expect((await repository.list(workspace)).map(view => view.path))
      .toEqual(['doc/reference/ctx.html', 'doc/tutorial/ctx.html'])
  })

  it('passes over a name the operating system left behind', async () => {
    await seed('doc/reference/.DS_Store', 'junk')
    expect(await repository.list(workspace)).toEqual([])
  })

  it('answers an empty list where nothing has been written', async () => {
    expect(await repository.list(workspace)).toEqual([])
  })
})

describe('FsViewRepository read and write', () => {
  it('reads back exactly the blocks it was given', async () => {
    await repository.write(workspace, 'doc/reference/ctx.html', [BLOCK])
    expect(await repository.read(workspace, 'doc/reference/ctx.html')).toEqual([BLOCK])
  })

  it('replaces what was there rather than adding beside it', async () => {
    await repository.write(workspace, 'doc/reference/ctx.html', [BLOCK])
    await repository.write(workspace, 'doc/reference/ctx.html', [])
    expect(await repository.read(workspace, 'doc/reference/ctx.html')).toEqual([])
  })

  it('answers nothing rather than reading a file the path climbed out to', async () => {
    await writeFile(join(root, 'secret'), 'no', 'utf-8')
    expect(await repository.read(workspace, '../../secret')).toBeUndefined()
  })

  it('refuses to write outside the views directory', async () => {
    await expect(repository.write(workspace, '../../escaped.json', [BLOCK]))
      .rejects
      .toThrow(/outside the views directory/)
  })

  it('answers nothing for a view nobody wrote', async () => {
    expect(await repository.read(workspace, 'doc/reference/gone.html')).toBeUndefined()
  })

  it('answers nothing for a file it can no longer parse', async () => {
    await seed('doc/reference/broken.html', 'not json')
    expect(await repository.read(workspace, 'doc/reference/broken.html')).toBeUndefined()
  })
})

describe('FsViewRepository material', () => {
  it('writes a projection and answers with a path the skill can resolve', async () => {
    const [path] = await repository.writeMaterial(workspace, [
      { path: 'material/doc/ctx.json', text: '{}' },
    ])

    expect(path).toBe('artifacts/material/doc/ctx.json')
    expect(await readFile(join(root, 'artifacts', 'material', 'doc', 'ctx.json'), 'utf-8')).toBe('{}')
    expect(await repository.readMaterial(workspace, 'material/doc/ctx.json')).toBe('{}')
  })

  it('refuses a generator that would write outside the workspace', async () => {
    await expect(repository.writeMaterial(workspace, [{ path: '../../escaped.json', text: '{}' }]))
      .rejects
      .toThrow(/outside the workspace/)
  })

  it('answers nothing for material that was never kept', async () => {
    expect(await repository.readMaterial(workspace, 'material/doc/gone.json')).toBeUndefined()
  })
})
