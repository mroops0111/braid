import type { NodeId } from '@braidhq/schema'
import { FIXTURE_FORM, FIXTURE_FORMAT, FIXTURE_KIND } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { viewPathOf, viewPathParts } from '../../../src/domain/view/viewPath.js'

const parts = {
  kind: FIXTURE_KIND,
  form: FIXTURE_FORM,
  subject: 'ctx.checkout' as NodeId,
  format: FIXTURE_FORMAT,
}

const under = `${FIXTURE_KIND}/${FIXTURE_FORM}`

describe('viewPathOf', () => {
  it('names a view by its kind, form, and subject', () => {
    expect(viewPathOf(parts)).toBe(`${under}/ctx.checkout.${FIXTURE_FORMAT}`)
  })

  it('escapes a separator in the subject rather than flattening it', () => {
    const path = viewPathOf({ ...parts, subject: 'ctx/checkout' as NodeId })
    expect(path).toBe(`${under}/ctx%2Fcheckout.${FIXTURE_FORMAT}`)
    expect(viewPathParts(path)?.subject).toBe('ctx/checkout')
  })
})

describe('viewPathParts', () => {
  it('reads back exactly what was written, hyphens and dots included', () => {
    for (const subject of ['ctx.checkout', 'ctx-checkout', 'a.b-c.d']) {
      const read = viewPathParts(viewPathOf({ ...parts, subject: subject as NodeId }))
      expect(read?.subject).toBe(subject)
      expect(read?.format).toBe(FIXTURE_FORMAT)
    }
  })

  it('refuses anything that does not name a view this wrote', () => {
    const refused = [under, `${under}/a/b.${FIXTURE_FORMAT}`, `${under}/.${FIXTURE_FORMAT}`, `${under}/noext`]
    for (const path of refused) {
      expect(viewPathParts(path)).toBeUndefined()
    }
  })

  it('refuses a name that cannot be unescaped', () => {
    expect(viewPathParts(`${under}/%E0%A4%A.${FIXTURE_FORMAT}`)).toBeUndefined()
  })
})
