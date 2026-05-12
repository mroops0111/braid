import type { AbsolutePath, SkillFrontmatter, SkillId } from '@telos/schema'
import { Buffer } from 'node:buffer'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { NotFoundError, SkillManifest, type SkillRegistry, type Workspace } from '@telos/core'
import { AbsolutePath as AbsolutePathSchema, SkillFrontmatter as SkillFrontmatterSchema, SkillId as SkillIdSchema } from '@telos/schema'
import { parseMarkdownFrontmatter } from './frontmatter.js'
import { workspaceSkillExtensionsDir, workspaceSkillsDir } from './paths.js'

interface DirentLike {
  readonly name: string
  isDirectory: () => boolean
}

export interface FsSkillRegistryOptions {
  readonly builtinSkillsRoot: AbsolutePath
}

export class FsSkillRegistry implements SkillRegistry {
  constructor(private readonly options: FsSkillRegistryOptions) {}

  async list(workspace: Workspace): Promise<readonly SkillManifest[]> {
    const builtins = await this.scanSkillsRoot(this.options.builtinSkillsRoot, 'builtin')
    const workspaceSkills = await this.scanSkillsRoot(
      AbsolutePathSchema.parse(workspaceSkillsDir(workspace.rootPath)),
      'workspace',
    )
    const extensions = await this.scanExtensionRoot(
      AbsolutePathSchema.parse(workspaceSkillExtensionsDir(workspace.rootPath)),
    )

    const manifests = new Map<SkillId, SkillManifest>()
    for (const manifest of builtins) manifests.set(manifest.id, manifest)
    for (const { id, path } of extensions) {
      const existing = manifests.get(id)
      if (existing) {
        const data = existing.toData()
        manifests.set(id, new SkillManifest({ ...data, extensionPath: path }))
      }
    }
    for (const manifest of workspaceSkills) manifests.set(manifest.id, manifest)
    return [...manifests.values()]
  }

  async find(workspace: Workspace, skillId: SkillId): Promise<SkillManifest | undefined> {
    const all = await this.list(workspace)
    return all.find(manifest => manifest.id === skillId)
  }

  async get(workspace: Workspace, skillId: SkillId): Promise<SkillManifest> {
    const manifest = await this.find(workspace, skillId)
    if (!manifest)
      throw new NotFoundError(`Skill "${skillId}" not found for workspace "${workspace.id}"`)
    return manifest
  }

  private async scanSkillsRoot(root: AbsolutePath, origin: 'builtin' | 'workspace'): Promise<SkillManifest[]> {
    const entries = await this.readDirSafe(root)
    const manifests: SkillManifest[] = []
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue
      const skillFile = AbsolutePathSchema.parse(join(root, entry.name, 'SKILL.md'))
      const frontmatter = await this.readSkillFrontmatter(skillFile)
      if (!frontmatter)
        continue
      manifests.push(new SkillManifest({
        id: SkillIdSchema.parse(entry.name),
        origin,
        path: skillFile,
        frontmatter,
      }))
    }
    return manifests
  }

  private async scanExtensionRoot(root: AbsolutePath): Promise<Array<{ id: SkillId, path: AbsolutePath }>> {
    const entries = await this.readDirSafe(root)
    const results: Array<{ id: SkillId, path: AbsolutePath }> = []
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue
      const extendPath = AbsolutePathSchema.parse(join(root, entry.name, 'EXTEND.md'))
      try {
        await stat(extendPath)
        const skillId = SkillIdSchema.parse(entry.name.replace(/^telos-/, ''))
        results.push({ id: skillId, path: extendPath })
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error
      }
    }
    return results
  }

  private async readSkillFrontmatter(skillFile: AbsolutePath): Promise<SkillFrontmatter | undefined> {
    let content: string
    try {
      content = await readFile(skillFile, 'utf-8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return undefined
      throw error
    }
    const { frontmatter } = parseMarkdownFrontmatter<unknown>(content)
    return SkillFrontmatterSchema.parse(frontmatter)
  }

  private async readDirSafe(directory: string): Promise<DirentLike[]> {
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      return entries.map(entry => ({
        name: typeof entry.name === 'string' ? entry.name : Buffer.from(entry.name).toString('utf8'),
        isDirectory: (): boolean => entry.isDirectory(),
      }))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return []
      throw error
    }
  }
}
