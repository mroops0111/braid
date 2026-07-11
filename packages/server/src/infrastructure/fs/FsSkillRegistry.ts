import type { AbsolutePath, SkillFrontmatter, SkillId, SkillOrigin } from '@braidhq/schema'
import { Buffer } from 'node:buffer'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NotFoundError, type PluginRegistry, SkillManifest, type SkillRegistry, validateSkillStructure, type Workspace } from '@braidhq/core'
import { AbsolutePath as AbsolutePathSchema, SkillFrontmatter as SkillFrontmatterSchema, SkillId as SkillIdSchema } from '@braidhq/schema'
import { parseMarkdownFrontmatter } from './frontmatter.js'
import { workspaceSkillExtensionsDir, workspaceSkillsDir } from './paths.js'

interface DirentLike {
  readonly name: string
  isDirectory: () => boolean
}

export interface FsSkillRegistryOptions {
  readonly builtinSkillsRoot: AbsolutePath
  /**
   * Optional plugin registry. When provided, skills declared by
   * registered plugins are mounted under the `plugin` origin between
   * builtins and workspace skills. Without it (e.g. in unit tests
   * that don't compose a registry) only builtin / workspace /
   * extension origins are discovered.
   */
  readonly pluginRegistry?: PluginRegistry
}

export class FsSkillRegistry implements SkillRegistry {
  constructor(private readonly options: FsSkillRegistryOptions) {}

  async list(workspace: Workspace): Promise<readonly SkillManifest[]> {
    const builtins = await this.scanSkillsRoot(this.options.builtinSkillsRoot, 'builtin')
    const pluginSkills = await this.scanPluginSkills()
    const workspaceSkills = await this.scanSkillsRoot(
      AbsolutePathSchema.parse(workspaceSkillsDir(workspace.rootPath)),
      'workspace',
    )
    const extensions = await this.scanExtensionRoot(
      AbsolutePathSchema.parse(workspaceSkillExtensionsDir(workspace.rootPath)),
    )

    // Precedence (later wins): builtin < plugin < workspace.
    // Extensions don't override. They attach an EXTEND.md path to the
    // resolved skill so the agent binding points claude at it at run time.
    const manifests = new Map<SkillId, SkillManifest>()
    for (const manifest of builtins) manifests.set(manifest.id, manifest)
    for (const manifest of pluginSkills) manifests.set(manifest.id, manifest)
    for (const manifest of workspaceSkills) manifests.set(manifest.id, manifest)
    for (const { id, path } of extensions) {
      const existing = manifests.get(id)
      if (existing) {
        const data = existing.toData()
        manifests.set(id, new SkillManifest({ ...data, extensionPath: path }))
      }
    }
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

  /**
   * Resolve every PluginSkillRef in the registry to a parsed
   * SkillManifest. Each ref's `directory` is converted to an absolute
   * fs path (URL via fileURLToPath), then `SKILL.md` is read and
   * parsed. Missing files at a plugin-declared path are an error,
   * not a silent skip: a plugin that ships a broken ref deserves a
   * loud startup failure, not a mysteriously-absent skill.
   */
  private async scanPluginSkills(): Promise<readonly SkillManifest[]> {
    const registry = this.options.pluginRegistry
    if (!registry)
      return []
    const refs = registry.pluginSkills()
    const manifests: SkillManifest[] = []
    for (const ref of refs) {
      const dir = typeof ref.directory === 'string' ? ref.directory : fileURLToPath(ref.directory)
      const skillFile = AbsolutePathSchema.parse(join(dir, 'SKILL.md'))
      const frontmatter = await this.readSkillFrontmatter(skillFile)
      if (!frontmatter)
        throw new Error(`Plugin "${ref.contributedBy}" declared skill "${ref.id}" at ${dir} but SKILL.md is missing`)
      manifests.push(new SkillManifest({
        id: ref.id,
        origin: 'plugin' as SkillOrigin,
        path: skillFile,
        frontmatter,
        pluginId: ref.contributedBy,
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
        const skillId = SkillIdSchema.parse(entry.name.replace(/^braid-/, ''))
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
    const { frontmatter: raw, body } = parseMarkdownFrontmatter<unknown>(content)
    const frontmatter = SkillFrontmatterSchema.parse(raw)

    // Structural contract: SKILL.md must declare the required H2 sections
    // per its `braid.category`. The validator is hard-fail so a broken
    // skill never silently appears in the workspace's skill list — a
    // skill missing `## Procedure` would burn an entire run before the
    // agent notices the gap.
    const validation = validateSkillStructure({ body, frontmatter })
    if (!validation.ok) {
      const issues = validation.issues.map(issue => `- ${issue.message}`).join('\n')
      throw new Error(`SKILL.md at ${skillFile} fails the structure contract:\n${issues}`)
    }

    return frontmatter
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
