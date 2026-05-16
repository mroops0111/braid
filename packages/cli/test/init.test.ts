import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initCommand } from '../src/commands/init.js'

describe('initCommand', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'braid-cli-init-'))
    // initCommand writes stdout; silence it so test output stays clean.
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates PRODUCT.md, .gitignore, and intent/ at the target directory', async () => {
    const target = join(workDir, 'my-product')
    await initCommand({ dir: target, ontologyId: 'ddd' })

    const product = await readFile(join(target, 'PRODUCT.md'), 'utf-8')
    expect(product).toContain('name: my-product')
    expect(product).toContain('ontologyId: ddd')
    expect(product).toContain('# my-product')

    const gitignore = await readFile(join(target, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.braid/')
    expect(gitignore).toContain('artifacts/')

    const gitkeep = await readFile(join(target, 'intent', '.gitkeep'), 'utf-8')
    expect(gitkeep).toBe('')
  })

  it('uses --name override when provided', async () => {
    const target = join(workDir, 'somefolder')
    await initCommand({ dir: target, ontologyId: 'ddd', name: 'override-name' })

    const product = await readFile(join(target, 'PRODUCT.md'), 'utf-8')
    expect(product).toContain('name: override-name')
    expect(product).not.toContain('name: somefolder')
  })

  it('respects --ontology flag', async () => {
    const target = join(workDir, 'redoc-ws')
    await initCommand({ dir: target, ontologyId: 'redoc' })

    const product = await readFile(join(target, 'PRODUCT.md'), 'utf-8')
    expect(product).toContain('ontologyId: redoc')
  })

  it('refuses to overwrite an existing PRODUCT.md without --force', async () => {
    const target = join(workDir, 'existing')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'PRODUCT.md'), '---\nname: existing\n---\n', 'utf-8')

    await expect(initCommand({ dir: target, ontologyId: 'ddd' }))
      .rejects
      .toThrow(/already exists/)
  })

  it('overwrites when --force is set', async () => {
    const target = join(workDir, 'forced')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'PRODUCT.md'), 'old content', 'utf-8')

    await initCommand({ dir: target, ontologyId: 'ddd', force: true })

    const product = await readFile(join(target, 'PRODUCT.md'), 'utf-8')
    expect(product).toContain('name: forced')
    expect(product).not.toBe('old content')
  })
})
