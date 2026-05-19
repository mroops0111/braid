import type { Workspace as WorkspaceData } from '@braidhq/schema'
import type { WorkspaceRegistryFile } from './WorkspaceRegistryFile.js'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { NotFoundError, ValidationError, Workspace, type WorkspaceRepository } from '@braidhq/core'
import { AbsolutePath, ProductManifest, WorkspaceId } from '@braidhq/schema'
import { parseMarkdownFrontmatter } from './frontmatter.js'
import { workspaceProductManifestPath } from './paths.js'

export interface FsWorkspaceRepositoryDeps {
  readonly registry: WorkspaceRegistryFile
}

export class FsWorkspaceRepository implements WorkspaceRepository {
  private readonly cache = new Map<AbsolutePath, Workspace>()

  constructor(private readonly deps: FsWorkspaceRepositoryDeps) {}

  async list(): Promise<Workspace[]> {
    const rootPaths = await this.deps.registry.list()
    const workspaces: Workspace[] = []
    for (const rootPath of rootPaths) {
      workspaces.push(await this.load(rootPath))
    }
    return workspaces
  }

  async load(rootPath: AbsolutePath): Promise<Workspace> {
    const cached = this.cache.get(rootPath)
    if (cached)
      return cached
    const workspace = await this.readFromDisk(rootPath)
    this.cache.set(rootPath, workspace)
    return workspace
  }

  async save(workspace: Workspace): Promise<void> {
    await this.deps.registry.add(workspace.rootPath)
    this.cache.set(workspace.rootPath, workspace)
  }

  async remove(rootPath: AbsolutePath): Promise<void> {
    await this.deps.registry.remove(rootPath)
    this.cache.delete(rootPath)
  }

  invalidate(rootPath: AbsolutePath): void {
    this.cache.delete(rootPath)
  }

  private async readFromDisk(rootPath: AbsolutePath): Promise<Workspace> {
    await this.assertDirectoryExists(rootPath)
    const manifestPath = workspaceProductManifestPath(rootPath)
    const raw = await this.readManifest(manifestPath)
    const { frontmatter } = parseMarkdownFrontmatter<unknown>(raw)
    const productManifest = this.parseManifest(frontmatter, manifestPath)
    const data: WorkspaceData = {
      id: WorkspaceId.parse(productManifest.name),
      rootPath: AbsolutePath.parse(resolve(rootPath)),
      productManifest,
    }
    return new Workspace(data)
  }

  private async assertDirectoryExists(rootPath: AbsolutePath): Promise<void> {
    try {
      const stats = await stat(rootPath)
      if (!stats.isDirectory()) {
        throw new ValidationError(`Workspace path "${rootPath}" is not a directory`)
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError(`Workspace directory "${rootPath}" not found`)
      }
      throw error
    }
  }

  private async readManifest(manifestPath: string): Promise<string> {
    try {
      return await readFile(manifestPath, 'utf-8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError(`PRODUCT.md not found at "${manifestPath}"`)
      }
      throw error
    }
  }

  private parseManifest(raw: unknown, manifestPath: string): ProductManifest {
    const parsed = ProductManifest.safeParse(raw)
    if (!parsed.success) {
      throw new ValidationError(`Invalid PRODUCT.md at "${manifestPath}": ${parsed.error.message}`)
    }
    return parsed.data
  }
}
