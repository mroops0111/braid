import type { RenderCallName, SkillCategory } from '@braidhq/schema'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  readonly name: string
  readonly origin: string
  readonly category: SkillCategory | undefined
  readonly declaredCalls: readonly RenderCallName[] | undefined
  readonly requiredCalls: readonly RenderCallName[]
  readonly forms: readonly string[]
  readonly body: string
}

async function readShippedSkills(): Promise<ShippedSkill[]> {
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

// A framework skill runs against every ontology, so a role, a reader, or a
// type it names by hand answers correctly for one workspace by accident.
const ONTOLOGY_VOCABULARY = [
  /\bbusiness reader\b/i,
  /\ban engineer\b/i,
  /\bspec and the code\b/i,
  /\bboundedContext\b/,
  /\baggregate\b/i,
]

describe('every shipped skill', () => {
  // The kind of run is a ceiling. A skill naming a call outside it wrote an
  // instruction its run can never carry out, which is how `ddd:extract` came
  // to tell a build run to call `show_evidence` when no build run had it.
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
      const named = ONTOLOGY_VOCABULARY.filter(pattern => pattern.test(skill.body)).map(String)
      expect({ skill: skill.name, named }).toEqual({ skill: skill.name, named: [] })
    }
  })
})

describe('every skill that can write instead of render', () => {
  // A checklist item naming a render call cannot be met by a run that was
  // handed none, so what each form owes lives with that form's contract.
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
      const routes = skill.body.includes('output-forms.md')
      expect({ skill: skill.name, routes }).toEqual({ skill: skill.name, routes: skill.forms.length > 1 })
    }
  })
})
