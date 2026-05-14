import type {
  AgentBindingDescriptor,
  AgentId,
  AgentKind,
  AgentRoutingConfig,
  ChannelDescriptor,
  ProductManifest,
  ProductManifestDraft,
  StorageDescriptor,
  StorageKind,
} from '@telos/schema'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProductManifest as ProductManifestSchema } from '@telos/schema'
import { stringify as stringifyYaml } from 'yaml'

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

const DEFAULT_CHANNELS: readonly ChannelDescriptor[] = []

/**
 * Take a user-provided `ProductManifestDraft` and fill in the structural
 * blocks (agent / storage / channels) so the result is a valid, complete
 * `ProductManifest` Zod will accept. Throws if the user's input itself is
 * inconsistent.
 */
export function fillManifestDefaults(draft: ProductManifestDraft): ProductManifest {
  const manifest = {
    name: draft.name,
    version: draft.version ?? '0.1.0',
    ...(draft.description ? { description: draft.description } : {}),
    ontologyId: draft.ontologyId ?? ('ddd' as never),
    sources: draft.sources,
    mcpServers: draft.mcpServers,
    agents: draft.agents ?? DEFAULT_AGENTS,
    agentBindings: draft.agentBindings ?? [DEFAULT_AGENT_BINDING],
    storage: draft.storage ?? DEFAULT_STORAGE,
    channels: draft.channels ?? [...DEFAULT_CHANNELS],
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
