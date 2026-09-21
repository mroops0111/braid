import type { RenderCallName, SkillCategory } from '@braidhq/schema'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dddOntology } from '@braidhq/ontology-ddd'
import { renderCallsFor, SkillFrontmatter } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { parseMarkdownFrontmatter } from '../../../src/infrastructure/_shared/frontmatter.js'

const PACKAGES = fileURLToPath(new URL('../../../../', import.meta.url))

const SKILL_ROOTS = [
  'core/skills',
  'ontology-ddd/skills',
  'view-generator-doc/skills',
]

interface ShippedSkill {
  readonly requiredEnv: readonly string[]
  /** Shared docs the prompt tells itself to read, by path. */
  readonly reads: readonly string[]
  readonly name: string
  readonly origin: string
  readonly category: SkillCategory | undefined
  readonly declaredCalls: readonly RenderCallName[] | undefined
  readonly requiredCalls: readonly RenderCallName[]
  readonly forms: readonly string[]
  readonly body: string
}

/**
 * Read once and kept.
 * Every check below reads the same files,
 * and the shipped set does not change while the suite runs.
 */
let shipped: Promise<ShippedSkill[]> | undefined

function readShippedSkills(): Promise<ShippedSkill[]> {
  shipped ??= scanShippedSkills()
  return shipped
}

async function scanShippedSkills(): Promise<ShippedSkill[]> {
  const skills: ShippedSkill[] = []
  for (const root of SKILL_ROOTS) {
    const dir = join(PACKAGES, root)
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory())
        continue
      let raw: string
      try {
        raw = await readFile(join(dir, entry.name, 'SKILL.md'), 'utf-8')
      }
      catch {
        continue
      }
      const { frontmatter, body } = parseMarkdownFrontmatter<unknown>(raw)
      const parsed = SkillFrontmatter.parse(frontmatter)
      skills.push({
        requiredEnv: parsed.braid.requiredEnv,
        reads: [...raw.matchAll(/\$BRAID_SHARED_REFERENCE\/([\w./<>-]+\.md)/g)].map(match => match[1]!),
        name: entry.name,
        origin: root.split('/')[0]!,
        forms: parsed.braid.output?.forms ?? ['blocks'],
        category: parsed.braid.category,
        declaredCalls: parsed.braid.output?.calls,
        requiredCalls: parsed.braid.output?.requiredCalls ?? [],
        body,
      })
    }
  }
  return skills
}

/**
 * Ids one ontology declares that could not be ordinary prose.
 *
 * A framework skill runs against every ontology.
 * A type, a role, or a reader named by hand fits one workspace by accident,
 * and misdescribes every other.
 * Read from the plugin rather than listed here,
 * so an id added later is checked without anyone remembering to add it.
 *
 * Only the compound ids, since most of this ontology's are ordinary words.
 * A prompt saying `query` or `rule` is almost always writing English,
 * and failing on that would teach the next author to skip the check.
 */
function declaredIdsOf(ontology: typeof dddOntology): readonly string[] {
  return [
    ...ontology.nodeTypes.map(type => String(type.id)),
    ...ontology.sourceRoles.map(role => String(role.id)),
    ...(ontology.audiences ?? []).map(audience => String(audience.id)),
  ].filter(id => /[a-z][A-Z]/.test(id))
}

/**
 * Prose that names one ontology's world without quoting an id.
 *
 * A sample rather than a proof.
 * The leaks this caught were sentences rather than identifiers,
 * and no list finds every sentence somebody might write.
 * It holds the ones already found, so they cannot come back.
 */
const ONTOLOGY_PROSE = [
  /\bbusiness reader\b/i,
  /\ban engineer\b/i,
  /\bspec and the code\b/i,
]

describe('every shipped skill', () => {
  // The kind of run is a ceiling.
  // A skill naming a call outside it wrote an instruction nothing can carry out.
  // That is how extract came to instruct a call no build run has ever had.
  it('declares only calls its kind can be offered', async () => {
    for (const skill of await readShippedSkills()) {
      if (!skill.declaredCalls || !skill.category)
        continue
      const ceiling = renderCallsFor(skill.category)
      const beyond = skill.declaredCalls.filter(call => !ceiling.includes(call))
      expect({ skill: skill.name, beyond }).toEqual({ skill: skill.name, beyond: [] })
    }
  })

  it('owes only calls it declared', async () => {
    for (const skill of await readShippedSkills()) {
      if (!skill.declaredCalls)
        continue
      const undeclared = skill.requiredCalls.filter(call => !skill.declaredCalls!.includes(call))
      expect({ skill: skill.name, undeclared }).toEqual({ skill: skill.name, undeclared: [] })
    }
  })

  // A prompt naming a call the run was never handed reads as a missing tool,
  // and the run spends turns looking for it before giving up.
  it('names no render call in its body that it did not declare', async () => {
    for (const skill of await readShippedSkills()) {
      if (!skill.declaredCalls)
        continue
      const allowed = new Set(skill.declaredCalls.map(call => call.replace(/(?<!^)(?=[A-Z])/, '_').toLowerCase()))
      const named = new Set(skill.body.match(/\bshow_[a-z]+\b/g) ?? [])
      const strays = [...named].filter(call => !allowed.has(call))
      expect({ skill: skill.name, strays }).toEqual({ skill: skill.name, strays: [] })
    }
  })
})

describe('every framework skill', () => {
  // `packages/core/skills` runs whatever ontology a workspace declares.
  // An ontology package's own skills may name their own vocabulary freely.
  it('names no vocabulary only one ontology would have', async () => {
    const skills = (await readShippedSkills()).filter(skill => skill.origin === 'core')
    expect(skills.length).toBeGreaterThan(0)
    for (const skill of skills) {
      const named = [
        ...declaredIdsOf(dddOntology).filter(id => new RegExp(`\\b${id}\\b`).test(skill.body)),
        ...ONTOLOGY_PROSE.filter(pattern => pattern.test(skill.body)).map(String),
      ]
      expect({ skill: skill.name, named }).toEqual({ skill: skill.name, named: [] })
    }
  })
})

describe('every skill that can write instead of render', () => {
  // A checklist item naming a render call cannot be met,
  // by a run that was handed none,
  // so what each form owes lives with that form's contract.
  it('keeps render calls out of its own checklist', async () => {
    for (const skill of await readShippedSkills()) {
      const checklist = skill.body.match(/## Completion Checklist\n([\s\S]*?)(?=\n## )/)?.[1] ?? ''
      const named = [...new Set(checklist.match(/\bshow_[a-z]+\b/g) ?? [])]
      expect({ skill: skill.name, named }).toEqual({ skill: skill.name, named: [] })
    }
  })

  // The branch is only reachable where a skill has more than one form.
  it('points at the writing contract when it declares more than one form', async () => {
    for (const skill of await readShippedSkills()) {
      const routes = skill.body.includes('prose-protocol.md')
      expect({ skill: skill.name, routes }).toEqual({ skill: skill.name, routes: skill.forms.length > 1 })
    }
  })
})

// The glossary names every variable in order to explain it,
// so reading it is not a dependency on any one of them.
const GLOSSARY = 'run-environment.md'

function variablesIn(text: string): Set<string> {
  return new Set([...text.matchAll(/\$(BRAID_[A-Z_]+)/g)].map(match => match[1]!))
}

describe('every shipped skill declares the environment it reads', () => {
  async function readWith(skill: ShippedSkill): Promise<Set<string>> {
    const shared = join(PACKAGES, 'core/skills/shared')
    const used = variablesIn(skill.body)
    for (const rel of new Set(skill.reads)) {
      if (rel === GLOSSARY)
        continue
      // One row stands for every call file, so widen it to the folder.
      const paths = rel.includes('<')
        ? (await readdir(join(shared, 'calls'))).map(file => join('calls', file))
        : [rel]
      for (const path of paths) {
        try {
          for (const name of variablesIn(await readFile(join(shared, path), 'utf-8')))
            used.add(name)
        }
        catch { /* a row naming no file is the structure validator's business */ }
      }
    }
    return used
  }

  // A prompt reading a variable nobody set fails halfway through,
  // which is the failure a declaration exists to turn into a refusal.
  it('declares every variable it or the docs it reads will use', async () => {
    for (const skill of await readShippedSkills()) {
      const used = [...await readWith(skill)].sort()
      const undeclared = used.filter(name => !skill.requiredEnv.includes(name))
      expect({ skill: skill.name, undeclared }).toEqual({ skill: skill.name, undeclared: [] })
    }
  })

  // A declaration nothing reads is a claim no run can justify,
  // and it outlives whatever once made it true.
  it('declares nothing it never reads', async () => {
    for (const skill of await readShippedSkills()) {
      const used = await readWith(skill)
      const unused = skill.requiredEnv.filter(name => !used.has(name)).sort()
      expect({ skill: skill.name, unused }).toEqual({ skill: skill.name, unused: [] })
    }
  })
})
