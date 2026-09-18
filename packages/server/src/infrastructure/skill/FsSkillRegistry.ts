import type { AbsolutePath, SkillFrontmatter, SkillId, SkillLoadIssue, SkillOrigin, UnloadableSkill } from '@braidhq/schema'
import { Buffer } from 'node:buffer'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NotFoundError, type PluginRegistry, SkillManifest, type SkillRegistry, validateSkillFile, type Workspace } from '@braidhq/core'
import { AbsolutePath as AbsolutePathSchema, SkillFrontmatter as SkillFrontmatterSchema, SkillId as SkillIdSchema, splitSkillId } from '@braidhq/schema'
import { parseMarkdownFrontmatter } from '../_shared/frontmatter.js'
import { workspaceSkillExtensionsDir, workspaceSkillsDir } from '../_shared/paths.js'

/**
 * Namespace for skills and reference docs shipped by the framework itself.
 * Builtin skills invoke as `braid:<verb>`,
 * and core's shared reference docs mount under the same namespace.
 */
export const BUILTIN_SKILL_NAMESPACE = 'braid'

/** Namespace a workspace's own skill files compose under. */
const WORKSPACE_SKILL_NAMESPACE = 'workspace'

interface DirentLike {
  readonly name: string
  isDirectory: () => boolean
}

/** What reading one SKILL.md produced. */
type SkillFileRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'loaded', readonly frontmatter: SkillFrontmatter }
  | { readonly kind: 'rejected', readonly issues: readonly SkillLoadIssue[] }

interface ScanResult {
  readonly manifests: readonly SkillManifest[]
  readonly unloadable: readonly UnloadableSkill[]
}

export interface FsSkillRegistryOptions {
  readonly builtinSkillsRoot: AbsolutePath
  /**
   * Optional plugin registry. When provided, plugin-declared skills mount,
   * between builtins and workspace skills, under the `plugin` origin.
   * Without it, as in unit tests that compose no registry, only builtin,
   * workspace, and extension origins are discovered.
   */
  readonly pluginRegistry?: PluginRegistry
}

export class FsSkillRegistry implements SkillRegistry {
  constructor(private readonly options: FsSkillRegistryOptions) {}

  async list(workspace: Workspace): Promise<readonly SkillManifest[]> {
    return (await this.scan(workspace)).manifests
  }

  async listUnloadable(workspace: Workspace): Promise<readonly UnloadableSkill[]> {
    return (await this.scan(workspace)).unloadable
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

  /**
   * Every origin in one pass, so what loaded and what did not stay in step.
   *
   * Each origin owns its own namespace, so no id can be claimed twice
   * and the map is an index rather than a precedence chain.
   * Extensions attach an EXTEND.md path to a skill that is already there.
   * They never override it, and the agent binding points claude at that file.
   */
  private async scan(workspace: Workspace): Promise<ScanResult> {
    const unloadable: UnloadableSkill[] = []
    const builtins = await this.scanSkillsRoot(this.options.builtinSkillsRoot, 'builtin', unloadable)
    const pluginSkills = await this.scanPluginSkills()
    const workspaceSkills = await this.scanSkillsRoot(
      AbsolutePathSchema.parse(workspaceSkillsDir(workspace.rootPath)),
      'workspace',
      unloadable,
    )

    const manifests = new Map<SkillId, SkillManifest>()
    for (const manifest of [...builtins, ...pluginSkills, ...workspaceSkills])
      manifests.set(manifest.id, manifest)

    const extensionsRoot = AbsolutePathSchema.parse(workspaceSkillExtensionsDir(workspace.rootPath))
    for (const entry of await this.readDirSafe(extensionsRoot)) {
      if (!entry.isDirectory())
        continue
      const extendPath = AbsolutePathSchema.parse(join(extensionsRoot, entry.name, 'EXTEND.md'))
      if (!await this.exists(extendPath))
        continue
      const targetId = extensionTargetId(entry.name)
      const target = targetId ? manifests.get(targetId) : undefined
      if (!target) {
        unloadable.push({
          origin: 'extension',
          path: extendPath,
          ...(targetId ? { id: targetId } : {}),
          issues: [targetId
            ? {
                kind: 'missing-extension-target',
                message: `This extension targets skill "${targetId}", which this workspace does not have.`,
                target: targetId,
              }
            : {
                kind: 'unparsable-extension-name',
                message: `Directory "${entry.name}" does not name a skill. An extension directory is <namespace>-<verb>, such as "braid-ask".`,
                target: entry.name,
              }],
        })
        continue
      }
      manifests.set(target.id, new SkillManifest({ ...target.toData(), extensionPath: extendPath }))
    }

    return { manifests: [...manifests.values()], unloadable }
  }

  /**
   * Read one root of skill directories.
   *
   * A builtin that will not load throws, since nobody but the publisher
   * can fix it and a half-loaded framework is worse than a stopped one.
   * A workspace skill is the work of whoever owns the workspace,
   * so it is set aside with its reasons and the rest of the list survives.
   */
  private async scanSkillsRoot(
    root: AbsolutePath,
    origin: 'builtin' | 'workspace',
    unloadable: UnloadableSkill[],
  ): Promise<SkillManifest[]> {
    const entries = await this.readDirSafe(root)
    const manifests: SkillManifest[] = []
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue
      const skillFile = AbsolutePathSchema.parse(join(root, entry.name, 'SKILL.md'))
      const read = await this.readSkillFile(skillFile)
      if (read.kind === 'absent')
        continue
      // The directory is the bare verb. Namespace it by origin,
      // builtins under `braid`, workspace skills under `workspace`,
      // so the id matches the plugin the agent binding stages it as.
      const namespace = origin === 'builtin' ? BUILTIN_SKILL_NAMESPACE : WORKSPACE_SKILL_NAMESPACE
      const id = SkillIdSchema.parse(`${namespace}:${entry.name}`)
      if (read.kind === 'rejected') {
        if (origin === 'builtin')
          throw new Error(describeRejection(skillFile, read.issues))
        unloadable.push({ id, origin, path: skillFile, issues: [...read.issues] })
        continue
      }
      manifests.push(new SkillManifest({
        id,
        origin,
        path: skillFile,
        frontmatter: read.frontmatter,
      }))
    }
    return manifests
  }

  // Resolve every PluginSkillRef in the registry to a parsed SkillManifest.
  // Each ref's `directory` is resolved to an absolute path via fileURLToPath,
  // then its `SKILL.md` is read and parsed.
  // A file missing at such a path,
  // counts as an error, never a silent skip.
  // A plugin shipping a broken ref,
  // earns a loud startup failure, not a mysteriously absent skill.
  private async scanPluginSkills(): Promise<readonly SkillManifest[]> {
    const registry = this.options.pluginRegistry
    if (!registry)
      return []
    const refs = registry.pluginSkills()
    const manifests: SkillManifest[] = []
    for (const ref of refs) {
      const dir = typeof ref.directory === 'string' ? ref.directory : fileURLToPath(ref.directory)
      const skillFile = AbsolutePathSchema.parse(join(dir, 'SKILL.md'))
      const read = await this.readSkillFile(skillFile)
      if (read.kind === 'absent')
        throw new Error(`Plugin "${ref.contributedBy}" declared skill "${ref.id}" at ${dir} but SKILL.md is missing`)
      if (read.kind === 'rejected')
        throw new Error(describeRejection(skillFile, read.issues))
      manifests.push(new SkillManifest({
        id: ref.id,
        origin: 'plugin' as SkillOrigin,
        path: skillFile,
        frontmatter: read.frontmatter,
        pluginId: ref.contributedBy,
      }))
    }
    return manifests
  }

  /**
   * Parse one SKILL.md and hold it to the load-time checks.
   *
   * Frontmatter that will not parse and a body missing a required section
   * are the same class of fault to a caller, so both come back as `rejected`
   * carrying what was wrong rather than as an exception the caller must catch.
   */
  private async readSkillFile(skillFile: AbsolutePath): Promise<SkillFileRead> {
    let content: string
    try {
      content = await readFile(skillFile, 'utf-8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { kind: 'absent' }
      throw error
    }

    let raw: unknown
    let body: string
    try {
      const parsed = parseMarkdownFrontmatter<unknown>(content)
      raw = parsed.frontmatter
      body = parsed.body
    }
    catch (error) {
      return { kind: 'rejected', issues: [frontmatterIssue((error as Error).message)] }
    }

    const frontmatter = SkillFrontmatterSchema.safeParse(raw)
    if (!frontmatter.success) {
      return {
        kind: 'rejected',
        issues: frontmatter.error.issues.map(issue =>
          frontmatterIssue(`${issue.path.join('.') || 'frontmatter'}: ${issue.message}`),
        ),
      }
    }

    // Were `## Procedure` absent, the skill would burn an entire run
    // before the agent ever noticed the missing section.
    const validation = validateSkillFile({ body, frontmatter: frontmatter.data })
    if (!validation.ok)
      return { kind: 'rejected', issues: validation.issues }
    return { kind: 'loaded', frontmatter: frontmatter.data }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return false
      throw error
    }
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

/**
 * The skill an extension directory targets, or undefined when it names none.
 *
 * The directory is `<namespace>-<verb>`, filesystem-safe, and its first
 * hyphen maps back to the id's `:` separator, so `ddd-extract` targets
 * `ddd:extract`. `SkillId` itself is any non-empty string, so the grammar
 * is checked by the one function that defines it.
 */
function extensionTargetId(directoryName: string): SkillId | undefined {
  const candidate = SkillIdSchema.parse(directoryName.replace('-', ':'))
  try {
    splitSkillId(candidate)
    return candidate
  }
  catch {
    return undefined
  }
}

function frontmatterIssue(message: string): SkillLoadIssue {
  return { kind: 'unparsable-frontmatter', message }
}

function describeRejection(skillFile: AbsolutePath, issues: readonly SkillLoadIssue[]): string {
  const lines = issues.map(issue => `- ${issue.message}`).join('\n')
  return `SKILL.md at ${skillFile} is not a usable skill:\n${lines}`
}
