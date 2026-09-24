import type { SkillId } from '@braidhq/schema'
import { makeSkillManifestData } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../../src/domain/errors.js'
import { assertSkillCanStart } from '../../../src/domain/skill/assertSkillCanStart.js'

const skillId = 'braid:ask' as SkillId

function frontmatterNeeding(requiredEnv: readonly string[]) {
  return makeSkillManifestData({ requiredEnv }).frontmatter
}

describe('assertSkillCanStart', () => {
  it('passes when the assembled environment carries every declared variable', () => {
    expect(() => assertSkillCanStart({
      skillId,
      frontmatter: frontmatterNeeding(['BRAID_RUN_ID', 'NOTION_TOKEN']),
      env: { BRAID_RUN_ID: 'run-1', NOTION_TOKEN: 'secret' },
    })).not.toThrow()
  })

  it('passes a skill that declares nothing', () => {
    expect(() => assertSkillCanStart({ skillId, frontmatter: frontmatterNeeding([]), env: {} })).not.toThrow()
  })

  it('names every missing variable at once, rather than the first', () => {
    expect(() => assertSkillCanStart({
      skillId,
      frontmatter: frontmatterNeeding(['NOTION_TOKEN', 'JIRA_TOKEN']),
      env: { BRAID_RUN_ID: 'run-1' },
    })).toThrow(/"NOTION_TOKEN", "JIRA_TOKEN"/)
  })

  it('refuses the run rather than reporting, since the work is about to begin', () => {
    expect(() => assertSkillCanStart({
      skillId,
      frontmatter: frontmatterNeeding(['NOTION_TOKEN']),
      env: {},
    })).toThrow(ValidationError)
  })

  it('treats an empty value as absent, since a blank token authenticates nothing', () => {
    expect(() => assertSkillCanStart({
      skillId,
      frontmatter: frontmatterNeeding(['NOTION_TOKEN']),
      env: { NOTION_TOKEN: '' },
    })).toThrow(ValidationError)
  })
})
