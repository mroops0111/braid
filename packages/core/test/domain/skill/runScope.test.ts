import { describe, expect, it } from 'vitest'
import { runScope, scopeCovers, uriWithinUnit } from '../../../src/index.js'

describe('runScope', () => {
  it('reads what a run works on when it differs from what it was told', () => {
    expect(runScope({ args: 'carry on', scope: 'unit/' })).toBe('unit/')
  })

  it('falls back to what it was told, which is how a fresh run is started', () => {
    expect(runScope({ args: 'unit/' })).toBe('unit/')
  })
})

describe('scopeCovers', () => {
  it('matches the unit a run was pointed at', () => {
    expect(scopeCovers('One Unit With Spaces/', 'One Unit With Spaces/')).toBe(true)
  })

  // A scope naming several joins them with a comma,
  // and a unit path may hold spaces, so the comma is the only separator.
  it('matches any of several the run was pointed at', () => {
    expect(scopeCovers('First Unit/,Second Unit/', 'Second Unit/')).toBe(true)
  })

  // One path can be contained in another.
  // Containment would have the shorter claim the longer's work as its own.
  it('does not let one unit claim another whose path contains it', () => {
    expect(scopeCovers('a/b/c/', 'a/b/')).toBe(false)
    expect(scopeCovers('a/b/', 'a/b/c/')).toBe(false)
  })

  it('matches nothing for a run that names no unit', () => {
    expect(scopeCovers('', 'unit/')).toBe(false)
    expect(scopeCovers('Run against the whole graph.', 'unit/')).toBe(false)
  })
})

describe('uriWithinUnit', () => {
  it('reads a file inside the unit as evidence of it', () => {
    expect(uriWithinUnit('source/root/A Unit/index.md', 'A Unit/')).toBe(true)
  })

  it('anchors on segment boundaries, so a prefix is not a unit', () => {
    expect(uriWithinUnit('source/root/bc/index.md', 'root/b')).toBe(false)
  })

  it('reads nothing for a unit with no path', () => {
    expect(uriWithinUnit('source/root/index.md', '')).toBe(false)
  })
})
