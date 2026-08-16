import type { OntologyPlugin, SourceRoleDescriptor } from '@braidhq/server'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { defaultOntologyPlugins } from '@braidhq/server'
import pc from 'picocolors'

export interface InitCommandInput {
  readonly dir: string
  readonly ontologyId: string
  readonly name?: string
  readonly force?: boolean
}

/**
 * Scaffold a new workspace at `dir`.
 * Writes PRODUCT.md, .gitignore, and one directory per declared source role,
 * so layout and manifest both come from the ontology, not a fixed worldview.
 * Does not register with a running server (registration is a Studio Wizard flow),
 * so this is mostly useful for inspecting the template.
 */
export async function initCommand(input: InitCommandInput): Promise<void> {
  const ontology = defaultOntologyPlugins().find(plugin => plugin.ontologyId === input.ontologyId)
  if (!ontology) {
    const known = defaultOntologyPlugins().map(plugin => plugin.ontologyId).join(', ')
    throw new Error(`Unknown ontology "${input.ontologyId}". Available: ${known}.`)
  }

  const absoluteDir = resolve(process.cwd(), input.dir)
  const workspaceName = input.name ?? basename(absoluteDir)

  await mkdir(absoluteDir, { recursive: true })

  const productPath = `${absoluteDir}/PRODUCT.md`
  if (!input.force && await fileExists(productPath))
    throw new Error(`${productPath} already exists. Pass --force to overwrite.`)

  // One directory per declared role, keyed by its pathSegment.
  // Studio provisions sources into the same segments,
  // so a CLI-created workspace and a Studio-created one share one layout.
  for (const role of ontology.sourceRoles) {
    const segment = segmentOf(role)
    await mkdir(`${absoluteDir}/${segment}`, { recursive: true })
    await writeFile(`${absoluteDir}/${segment}/.gitkeep`, '', 'utf-8')
  }

  await writeFile(productPath, renderProductManifest({ name: workspaceName, ontology }), 'utf-8')
  await writeFile(`${absoluteDir}/.gitignore`, renderGitignore(), 'utf-8')

  process.stdout.write(`${pc.green('✓')} Created Braid workspace template at ${pc.cyan(absoluteDir)}\n`)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

// The workspace subfolder a role's sources provision into.
// Falls back to the role id when the ontology declares no explicit segment.
function segmentOf(role: SourceRoleDescriptor): string {
  return role.pathSegment ?? role.id
}

/**
 * Workspace template, parametrised on the ontology's declared roles.
 * The frontmatter seeds one source entry per required role.
 * Every role gets a directory, optional ones for the user to fill in later.
 */
function renderProductManifest({ name, ontology }: { name: string, ontology: OntologyPlugin }): string {
  const requiredRoles = ontology.sourceRoles.filter(role => role.required)
  const sources = requiredRoles.length > 0
    ? requiredRoles.map(role => `  - kind: filesystem
    id: src-${role.id}
    role: ${role.id}
    name: ${role.id}
    path: ./${segmentOf(role)}`).join('\n')
    : '  []'

  const roleLines = ontology.sourceRoles
    .map(role => `- \`${role.id}\` (${role.required ? 'required' : 'optional'}): \`./${segmentOf(role)}/\``)
    .join('\n')

  return `---
name: ${name}
version: 0.1.0
description: ${name} workspace. Edit sources below to point at your real content.
ontologyId: ${ontology.ontologyId}

sources:
${sources}

mcpServers: []

storage:
  kind: kuzu
  config: {}

channels:
  - kind: http
    config:
      port: 4321
---

# ${name}

A Braid workspace. The frontmatter above is the source of truth for
this workspace's configuration: sources, ontology, storage, channels.

## Sources

The \`${ontology.ontologyId}\` ontology declares these source roles, each with a
directory below. Point the frontmatter \`sources\` at your real content, and add
a source entry for any optional role once you have material for it:

${roleLines}

## Next

Open Studio and create a workspace via the Wizard.
`
}

function renderGitignore(): string {
  return `artifacts/
.env
.braid/
.braid-sessions/
`
}
