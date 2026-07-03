import type {
  AgentBindingDescriptor,
  AgentId,
  AgentKind,
  AgentRoutingConfig,
  ProductManifest,
  ProductManifestCreate,
  StorageDescriptor,
  StorageKind,
} from '@braidhq/schema'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OntologyId, ProductManifest as ProductManifestSchema } from '@braidhq/schema'
import { stringify as stringifyYaml } from 'yaml'
import { parseMarkdownFrontmatter } from './frontmatter.js'

const FRONTMATTER_DELIMITER = '---'

const DEFAULT_AGENT_BINDING: AgentBindingDescriptor = {
  id: 'claude-default' as AgentId,
  kind: 'claude-code' as AgentKind,
  model: 'opus',
  effort: 'high',
  extraArgs: [],
  env: {},
}

const DEFAULT_AGENTS: AgentRoutingConfig = {
  default: 'claude-default',
  tasks: {},
}

const DEFAULT_STORAGE: StorageDescriptor = {
  kind: 'kuzu' as StorageKind,
  config: {},
}

/**
 * Take a user-provided `ProductManifestCreate` and fill in the structural
 * blocks (agent / storage) so the result is a valid, complete
 * `ProductManifest` Zod will accept. Throws if the user's input itself is
 * inconsistent.
 */
export function fillManifestDefaults(draft: ProductManifestCreate): ProductManifest {
  const manifest = {
    name: draft.name,
    version: draft.version ?? '0.1.0',
    ...(draft.description ? { description: draft.description } : {}),
    ontologyId: draft.ontologyId ?? OntologyId.parse('ddd'),
    sources: draft.sources,
    mcpServers: draft.mcpServers,
    agents: draft.agents ?? DEFAULT_AGENTS,
    agentBindings: draft.agentBindings ?? [DEFAULT_AGENT_BINDING],
    storage: draft.storage ?? DEFAULT_STORAGE,
  }
  return ProductManifestSchema.parse(manifest)
}

/**
 * Render a `ProductManifest` as YAML-frontmatter markdown and write it
 * to `<workspaceRoot>/PRODUCT.md`. The parent directory is created if
 * missing; an existing PRODUCT.md is overwritten.
 */
export async function writeProductManifest(workspaceRoot: string, manifest: ProductManifest, bodyTitle?: string): Promise<string> {
  await mkdir(workspaceRoot, { recursive: true })
  const yaml = stringifyYaml(manifest, { sortMapEntries: false }).trimEnd()
  const heading = bodyTitle ?? manifest.name
  const body = `\n# ${heading}\n`
  const content = `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n${body}`
  const path = join(workspaceRoot, 'PRODUCT.md')
  await writeFile(path, content, 'utf-8')
  return path
}

/**
 * Replace the YAML frontmatter of an existing PRODUCT.md while preserving the
 * markdown body underneath. Used by workspace mutation endpoints so user-written
 * prose (e.g. project notes added below the frontmatter) survives a manifest
 * update. The file must exist; throws otherwise.
 */
export async function updateProductManifest(workspaceRoot: string, manifest: ProductManifest): Promise<string> {
  const path = join(workspaceRoot, 'PRODUCT.md')
  const existing = await readFile(path, 'utf-8')
  const { body } = parseMarkdownFrontmatter<unknown>(existing)
  const yaml = stringifyYaml(manifest, { sortMapEntries: false }).trimEnd()
  const content = `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n${body}`
  await writeFile(path, content, 'utf-8')
  return path
}
