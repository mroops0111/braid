import type { GeneratedView, ViewFormId, ViewKind, ViewKindDescriptor } from '@braidhq/schema'
import { FIXTURE_FORM, FIXTURE_KIND, makeGeneratedView, makeViewForm, makeViewKind } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { documentsFrom, formOf, formsOf, matchesQuery, shelvesOf } from '@/lib/views'

const OTHER_FORM = 'form-b' as ViewFormId

function view(overrides: Parameters<typeof makeGeneratedView>[0] = {}): GeneratedView {
  return makeGeneratedView({ subject: 'ctx', ...overrides })
}

const KINDS: readonly ViewKindDescriptor[] = [
  makeViewKind({
    subjects: [{ by: 'container' }],
    forms: [makeViewForm({ label: 'Form A' })],
  }),
]

describe('documentsFrom', () => {
  it('gathers every form of one subject under it', () => {
    const groups = documentsFrom([
      view(),
      view({ form: OTHER_FORM }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.views.map(one => one.form)).toEqual([FIXTURE_FORM, OTHER_FORM])
  })

  it('calls a subject stale when any form of it is', () => {
    const groups = documentsFrom([
      view(),
      view({ form: OTHER_FORM, stale: true }),
    ])
    expect(groups[0]?.stale).toBe(true)
  })

  it('leads with what the reader just wrote', () => {
    const groups = documentsFrom([
      view({ subject: 'old' }),
      view({ subject: 'new', writtenAt: '2026-06-01T00:00:00.000Z' }),
    ])
    expect(groups.map(group => group.subject)).toEqual(['new', 'old'])
  })

  it('answers an empty list where nothing has been written', () => {
    expect(documentsFrom([])).toEqual([])
  })
})

describe('formsOf and formOf', () => {
  it('finds the forms a kind is written in', () => {
    expect(formsOf(KINDS, FIXTURE_KIND).map(form => form.id)).toEqual([FIXTURE_FORM])
    expect(formsOf(KINDS, 'absent' as ViewKind)).toEqual([])
  })

  it('finds the form that wrote one document, and nothing for one nobody ships', () => {
    expect(formOf(KINDS, view())?.label).toBe('Form A')
    expect(formOf(KINDS, view({ form: 'absent' }))).toBeUndefined()
  })
})

describe('shelvesOf', () => {
  const groups = documentsFrom([
    view({ subject: 'ctx.a' }),
    view({ subject: 'agg.b' }),
  ])

  it('shelves each document by what kind of thing it is about', () => {
    const shelves = shelvesOf(groups, subject =>
      subject.startsWith('ctx') ? { id: 'boundedContext', label: 'Bounded context' } : { id: 'aggregate', label: 'Aggregate' })
    expect(shelves.map(shelf => shelf.label)).toEqual(['Aggregate', 'Bounded context'])
    expect(shelves[0]?.groups.map(group => group.subject)).toEqual(['agg.b'])
  })

  it('answers one shelf where every subject is the same kind', () => {
    const shelves = shelvesOf(groups, () => ({ id: 'boundedContext', label: 'Bounded context' }))
    expect(shelves).toHaveLength(1)
    expect(shelves[0]?.groups).toHaveLength(2)
  })

  it('still shelves a subject whose kind the graph no longer holds', () => {
    const shelves = shelvesOf(groups, () => undefined)
    expect(shelves).toHaveLength(1)
    expect(shelves[0]?.label).toBe('')
  })
})

describe('matchesQuery', () => {
  const [group] = documentsFrom([view()])

  it('keeps everything while nothing is typed', () => {
    expect(matchesQuery(group!, 'Checkout', '  ')).toBe(true)
  })

  it('matches the name a reader would think of it by, ignoring case', () => {
    expect(matchesQuery(group!, 'Checkout', 'check')).toBe(true)
    expect(matchesQuery(group!, 'Checkout', 'CHECK')).toBe(true)
  })

  it('matches the id a reader would paste', () => {
    expect(matchesQuery(group!, 'Checkout', 'ctx')).toBe(true)
  })

  it('drops what neither the name nor the id carries', () => {
    expect(matchesQuery(group!, 'Checkout', 'billing')).toBe(false)
  })
})
