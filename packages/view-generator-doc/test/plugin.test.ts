import type { NodeTypeDescriptor } from '@braidhq/core'
import type { NodeId, NodeTypeId } from '@braidhq/schema'
import { NotFoundError } from '@braidhq/core'
import { makeNode } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { docViewGeneratorPlugin, VIEW_KIND } from '../src/index.js'

const NODE_TYPES: readonly NodeTypeDescriptor[] = [
  { id: 'boundedContext' as NodeTypeId, label: 'Bounded context', renderHint: { container: true } },
]

const MODEL = { nodes: [makeNode('ctx.checkout', { type: 'boundedContext' as NodeTypeId })], edges: [] }

describe('docViewGeneratorPlugin', () => {
  it('ships the reference and tutorial forms, and a skill for each', () => {
    expect(docViewGeneratorPlugin.forms.map(form => form.id)).toEqual(['reference', 'tutorial'])
    expect(docViewGeneratorPlugin.skills).toHaveLength(2)
    expect(docViewGeneratorPlugin.skillNamespace).toBe(VIEW_KIND)
  })

  it('declares what each form writes, rather than leaving it to a file name', () => {
    expect(docViewGeneratorPlugin.forms.every(form => form.format === 'blocks')).toBe(true)
  })

  it('asks a reader nothing for a reference, and how much they know for a tutorial', () => {
    const [reference, tutorial] = docViewGeneratorPlugin.forms
    expect(reference?.asks).toEqual([])
    expect(tutorial?.asks.map(ask => ask.id)).toEqual(['depth'])
  })

  it('projects a container into one material file named after it', async () => {
    const artifact = await docViewGeneratorPlugin.render({
      model: MODEL,
      nodeTypes: NODE_TYPES,
      config: { subject: 'ctx.checkout' as NodeId },
    })

    expect(artifact.kind).toBe(VIEW_KIND)
    expect(artifact.format).toBe('json')
    expect(artifact.files.map(file => file.path)).toEqual(['material/doc/ctx.checkout.json'])
  })

  it('escapes a separator in the subject, so the material stays one file', async () => {
    const artifact = await docViewGeneratorPlugin.render({
      model: { nodes: [makeNode('ctx/checkout', { type: 'boundedContext' as NodeTypeId })], edges: [] },
      nodeTypes: NODE_TYPES,
      config: { subject: 'ctx/checkout' as NodeId },
    })
    expect(artifact.files[0]?.path).toBe('material/doc/ctx%2Fcheckout.json')
  })

  it('refuses a subject this workspace does not hold, in terms a route can answer with', async () => {
    await expect(docViewGeneratorPlugin.render({
      model: MODEL,
      nodeTypes: NODE_TYPES,
      config: { subject: 'gone' as NodeId },
    })).rejects.toThrow(NotFoundError)
  })
})
