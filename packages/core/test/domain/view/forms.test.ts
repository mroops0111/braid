import type { ViewFormId } from '@braidhq/schema'
import { makeViewForm } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { argumentsFor, askedOf, formOfId, unsetRequirements } from '../../../src/domain/view/forms.js'

const asking = makeViewForm({
  id: 'asking',
  asks: [{
    id: 'depth',
    label: 'Depth',
    fallback: 'standard',
    choices: [
      { id: 'plain', label: 'Plain', why: 'Assume nothing' },
      { id: 'standard', label: 'Standard', why: 'Assume the neighbourhood' },
    ],
  }],
})

const requiring = makeViewForm({
  id: 'requiring',
  requires: ['FORM_ROOT', 'FORM_THEME'],
})

describe('formOfId', () => {
  it('finds a form by id and nothing for one nobody ships', () => {
    expect(formOfId([asking], 'asking' as ViewFormId)).toBe(asking)
    expect(formOfId([asking], 'absent' as ViewFormId)).toBeUndefined()
  })
})

describe('askedOf', () => {
  it('keeps an answer the form offers', () => {
    expect(askedOf(asking, { depth: 'plain' })).toEqual({ depth: 'plain' })
  })

  it('writes the fallback where the reader said nothing', () => {
    expect(askedOf(asking, {})).toEqual({ depth: 'standard' })
  })

  it('drops an answer outside the form\'s vocabulary', () => {
    expect(askedOf(asking, { depth: 'diagonal' })).toEqual({ depth: 'standard' })
  })

  it('ignores a key the form never asked about', () => {
    expect(askedOf(asking, { length: 'quick' })).toEqual({ depth: 'standard' })
  })
})

describe('argumentsFor', () => {
  it('keeps the material and the request apart in one argument', () => {
    expect(argumentsFor('artifacts/material/doc/ctx.json', { depth: 'plain' }))
      .toBe('artifacts/material/doc/ctx.json depth=plain')
  })

  it('is the material alone when the form asks nothing', () => {
    expect(argumentsFor('m.json', {})).toBe('m.json')
  })
})

describe('unsetRequirements', () => {
  it('names what the deployment left unset, counting empty as unset', () => {
    expect(unsetRequirements(requiring, { FORM_ROOT: '/root', FORM_THEME: '' }))
      .toEqual(['FORM_THEME'])
  })

  it('says nothing for a form that requires nothing', () => {
    expect(unsetRequirements(asking, {})).toEqual([])
  })
})
