import { describe, expect, it } from 'vitest'
import { sourceUnitsForRun } from '../../../src/index.js'

function listed(value: string, sourceId = 'source-a') {
  return { sourceId, value, label: value, sourceName: 'spec' }
}

describe('sourceUnitsForRun', () => {
  const units = [listed('Unit One With Spaces/'), listed('Unit Two With Spaces/')]

  it('names the unit the run was pointed at', () => {
    expect(sourceUnitsForRun('Unit One With Spaces/', units).map(unit => unit.value))
      .toEqual(['Unit One With Spaces/'])
  })

  it('names every unit a run covering several was pointed at', () => {
    const both = sourceUnitsForRun('Unit One With Spaces/,Unit Two With Spaces/', units)
    expect(both.map(unit => unit.value)).toEqual(['Unit One With Spaces/', 'Unit Two With Spaces/'])
  })

  // A step working on the graph as a whole names no document, and crediting it
  // with one would give it coverage it never earned.
  it('names nothing for a run that was given no unit', () => {
    expect(sourceUnitsForRun('', units)).toEqual([])
    expect(sourceUnitsForRun('mode=full', units)).toEqual([])
  })

  it('names nothing for a document the workspace does not hold', () => {
    expect(sourceUnitsForRun('Something Nobody Has/', units)).toEqual([])
  })

  it('carries the source through, so two sources cannot be confused', () => {
    const across = [listed('Shared Name/', 'source-a'), listed('Shared Name/', 'source-b')]
    expect(sourceUnitsForRun('Shared Name/', across).map(unit => unit.sourceId))
      .toEqual(['source-a', 'source-b'])
  })
})
