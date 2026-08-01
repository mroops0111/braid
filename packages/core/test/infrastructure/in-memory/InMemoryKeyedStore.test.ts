import { describe, expect, it } from 'vitest'
import { InMemoryKeyedStore } from '../../../src/in-memory.js'
import { NotFoundError } from '../../../src/index.js'

function store() {
  return new InMemoryKeyedStore<string, { v: number }>('Widget')
}

describe('InMemoryKeyedStore', () => {
  it('sets and gets an entry', () => {
    const s = store()
    s.set('a', { v: 1 })
    expect(s.get('a')).toEqual({ v: 1 })
    expect(s.has('a')).toBe(true)
  })

  it('has returns false for an absent key', () => {
    expect(store().has('missing')).toBe(false)
  })

  it('find returns undefined for an absent key', () => {
    expect(store().find('missing')).toBeUndefined()
  })

  it('get throws NotFoundError naming the entity for an absent key', () => {
    expect(() => store().get('ghost')).toThrow(NotFoundError)
    expect(() => store().get('ghost')).toThrow(/Widget "ghost"/)
  })

  it('remove deletes an entry', () => {
    const s = store()
    s.set('a', { v: 1 })
    s.remove('a')
    expect(s.has('a')).toBe(false)
  })

  it('remove throws NotFoundError for an absent key', () => {
    expect(() => store().remove('ghost')).toThrow(NotFoundError)
  })

  it('listAll returns every stored value', () => {
    const s = store()
    s.set('a', { v: 1 })
    s.set('b', { v: 2 })
    expect(s.listAll()).toHaveLength(2)
  })
})
