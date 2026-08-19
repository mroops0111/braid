import type {
  ProductManifest,
  ProductManifestCreate,
  StorageDescriptor,
  StorageKind,
} from '@braidhq/schema'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OntologyId, ProductManifest as ProductManifestSchema } from '@braidhq/schema'
import { stringify as stringifyYaml } from 'yaml'
import { parseMarkdownFrontmatter } from '../_shared/frontmatter.js'

const FRONTMATTER_DELIMITER = '---'

const DEFAULT_STORAGE: StorageDescriptor = {
  kind: 'kuzu' as StorageKind,
  config: {},
}

/**
 * Take a user-provided `ProductManifestCreate` and fill in the structure,
 * such as the storage block, so the result is a complete `ProductManifest`,
 * that Zod will accept.
 * `defaultOntologyId` comes from the composition, the sole registered
 * ontology in a single-ontology build, and only a build that registers
 * none at all falls back to the coding preset's `ddd`.
 * Throws if the user's own input is inconsistent.
 */
export function fillManifestDefaults(draft: ProductManifestCreate, defaultOntologyId?: OntologyId): ProductManifest {
  const manifest = {
    name: draft.name,
    version: draft.version ?? '0.1.0',
    ...(draft.description ? { description: draft.description } : {}),
    ontologyId: draft.ontologyId ?? defaultOntologyId ?? OntologyId.parse('ddd'),
    sources: draft.sources,
    mcpServers: draft.mcpServers,
    storage: draft.storage ?? DEFAULT_STORAGE,
  }
  return ProductManifestSchema.parse(manifest)
}

/**
 * Render a `ProductManifest` as YAML-frontmatter markdown,
 * then write it to `<workspaceRoot>/PRODUCT.md`.
 * A missing parent directory is created first,
 * and an existing PRODUCT.md is overwritten.
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
 * Replace the YAML frontmatter of an existing PRODUCT.md,
 * preserving the markdown body underneath.
 * Workspace mutation endpoints call this,
 * so user prose below the frontmatter survives an update.
 * The file must exist, otherwise this throws.
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
