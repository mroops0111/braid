import type { SkillFrontmatter, SkillInputDescriptor } from '@braidhq/schema'
import { makeSkillManifestData } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { validateSkillFile } from '../../../src/domain/skill/validateSkillFile.js'

const ALL_SECTIONS = [
  'Role',
  'Design Principles',
  'Initialization',
  'Procedure',
  'Output',
  'Completion Checklist',
  'Reference Documents',
]

function body(sections: readonly string[]): string {
  return sections.map(s => `## ${s}\n\nBody for ${s}.\n`).join('\n')
}

function frontmatter(category?: SkillFrontmatter['braid']['category']): SkillFrontmatter {
  return makeSkillManifestData(category ? { category } : {}).frontmatter
}

/** A `build` skill declaring exactly these inputs, the one shape every inputs[] test needs. */
function frontmatterWithInputs(inputs: readonly SkillInputDescriptor[]): SkillFrontmatter {
  return { ...frontmatter('build'), braid: { ...frontmatter('build').braid, inputs: [...inputs] } }
}

describe('validateSkillFile', () => {
  it('accepts a well-formed ask skill with every common section', () => {
    const result = validateSkillFile({
      body: body(ALL_SECTIONS),
      frontmatter: frontmatter('ask'),
    })
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('flags a missing common section', () => {
    const without = ALL_SECTIONS.filter(s => s !== 'Reference Documents')
    const result = validateSkillFile({
      body: body(without),
      frontmatter: frontmatter('ask'),
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'missing-section', target: 'Reference Documents' }),
    ])
  })

  it('requires Output Files for category: generate', () => {
    const result = validateSkillFile({
      body: body(ALL_SECTIONS),
      frontmatter: frontmatter('generate'),
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'missing-section', target: 'Output Files' }),
    ])
  })

  it('passes category: generate once Output Files is present', () => {
    const result = validateSkillFile({
      body: body([...ALL_SECTIONS, 'Output Files']),
      frontmatter: frontmatter('generate'),
    })
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('does not require Output Files for category: build', () => {
    const result = validateSkillFile({
      body: body(ALL_SECTIONS),
      frontmatter: frontmatter('build'),
    })
    expect(result.ok).toBe(true)
  })

  it('skips category-specific checks when no category is set (Custom bucket)', () => {
    const result = validateSkillFile({
      body: body(ALL_SECTIONS),
      frontmatter: frontmatter(),
    })
    expect(result.ok).toBe(true)
  })

  it('ignores H2-like text inside fenced code blocks', () => {
    // The fenced block contains a literal `## Role` line,
    // which must not count as a real section.
    // The skill is missing the actual Role section,
    // so we expect the validator to still complain.
    const without = ALL_SECTIONS.filter(s => s !== 'Role')
    const text = `\`\`\`md\n## Role\nfaux heading\n\`\`\`\n\n${body(without)}`
    const result = validateSkillFile({
      body: text,
      frontmatter: frontmatter('ask'),
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'missing-section', target: 'Role' }),
    ])
  })

  it('flags duplicate input names', () => {
    const result = validateSkillFile({
      body: body(ALL_SECTIONS),
      frontmatter: frontmatterWithInputs([
        { name: 'mode', label: 'Mode', kind: 'text', multiline: false, optional: false },
        { name: 'mode', label: 'Mode 2', kind: 'text', multiline: false, optional: false },
      ]),
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'duplicate-input-name', target: 'mode' }),
    ])
  })

  it('accepts well-formed inputs[] with unique names', () => {
    const result = validateSkillFile({
      body: body(ALL_SECTIONS),
      frontmatter: frontmatterWithInputs([
        { name: 'mode', label: 'Mode', kind: 'text', multiline: false, optional: false },
        { name: 'scope', label: 'Scope', kind: 'text', multiline: false, optional: true },
      ]),
    })
    expect(result.ok).toBe(true)
  })

  it('flags a pick default naming no option its static provider lists', () => {
    const result = validateSkillFile({
      body: body(ALL_SECTIONS),
      frontmatter: frontmatterWithInputs([
        {
          name: 'mode',
          label: 'Mode',
          kind: 'pick',
          optional: false,
          default: 'reconcile',
          fallback: 'text',
          provider: {
            kind: 'static',
            options: [
              { value: 'build', label: 'Build' },
              { value: 'validate', label: 'Validate' },
            ],
          },
        },
      ]),
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'unlisted-default', target: 'mode' }),
    ])
  })

  it('accepts a pick default naming an empty-value option, and one that matches', () => {
    const result = validateSkillFile({
      body: body(ALL_SECTIONS),
      frontmatter: frontmatterWithInputs([
        {
          name: 'mode',
          label: 'Mode',
          kind: 'pick',
          optional: false,
          default: '',
          fallback: 'text',
          provider: {
            kind: 'static',
            options: [
              { value: '', label: 'Build + Validate' },
              { value: 'validate', label: 'Validate' },
            ],
          },
        },
        {
          name: 'scope',
          label: 'Scope',
          kind: 'pick',
          optional: false,
          default: 'checkout',
          fallback: 'text',
          provider: {
            kind: 'static',
            options: [{ value: 'checkout', label: 'Checkout' }],
          },
        },
      ]),
    })
    expect(result.ok).toBe(true)
  })

  it('does not check a default against a dynamic provider, resolved per workspace', () => {
    const result = validateSkillFile({
      body: body(ALL_SECTIONS),
      frontmatter: frontmatterWithInputs([
        {
          name: 'unit',
          label: 'Unit',
          kind: 'pick',
          optional: false,
          default: 'anything',
          fallback: 'text',
          provider: { kind: 'graph-node' },
        },
      ]),
    })
    expect(result.ok).toBe(true)
  })

  it('ignores H3 headings, anchors, and trailing whitespace', () => {
    const allSectionsWithAnchor = ALL_SECTIONS.map((s, i) => i === 0 ? `Role {#role}  ` : s)
    const text = `${allSectionsWithAnchor.map(s => `## ${s}\n`).join('\n')}\n### Sub-section\nBody.\n`
    const result = validateSkillFile({
      body: text,
      frontmatter: frontmatter('ask'),
    })
    expect(result.ok).toBe(true)
  })
  it('rejects a reference document named by a relative path', () => {
    const text = `${body(ALL_SECTIONS.filter(s => s !== 'Reference Documents'))}
## Reference Documents

| File | When to Read | Why |
|---|---|---|
| \`.claude/skills/shared/drift-detection.md\` | Step 5 | Drift. |
`
    const result = validateSkillFile({ body: text, frontmatter: frontmatter('ask') })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'unreachable-reference-document' }),
    ])
  })

  it('accepts a reference document reached through a mounted reference path', () => {
    const text = `${body(ALL_SECTIONS.filter(s => s !== 'Reference Documents'))}
## Reference Documents

| File | When to Read | Why |
|---|---|---|
| \`$BRAID_SHARED_REFERENCE/drift-detection.md\` | Step 5 | Drift. |
| \`$BRAID_ONTOLOGY_REFERENCE/concept.md\` § Drift Dimensions | Step 5 | Dimensions. |
`
    const result = validateSkillFile({ body: text, frontmatter: frontmatter('ask') })
    expect(result.ok).toBe(true)
  })
})
