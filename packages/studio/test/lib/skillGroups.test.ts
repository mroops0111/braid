import type { AbsolutePath, PluginId, SkillId, SkillManifest } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { bucketByGroup } from '../../src/lib/skillGroups'

function skill(opts: {
  id: string
  category?: 'ask' | 'build' | 'generate'
  order?: number
  origin?: 'builtin' | 'plugin' | 'workspace' | 'extension'
  pluginId?: string
}): SkillManifest {
  return {
    id: opts.id as SkillId,
    origin: opts.origin ?? 'builtin',
    path: '/abs/SKILL.md' as AbsolutePath,
    frontmatter: {
      name: opts.id,
      description: 'desc',
      disableModelInvocation: true,
      braid: {
        requiredEnv: [],
        requiredMcpServers: [],
        allowedRoles: ['owner', 'maintainer'],
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.order !== undefined ? { order: opts.order } : {}),
      },
    },
    ...(opts.pluginId ? { pluginId: opts.pluginId as PluginId } : {}),
  } as SkillManifest
}

describe('bucketByGroup', () => {
  it('places each skill in the group derived from its category', () => {
    const buckets = bucketByGroup([
      skill({ id: 'extract', category: 'build', order: 100 }),
      skill({ id: 'doc', category: 'generate' }),
      skill({ id: 'standalone' }),
    ])
    expect(buckets.build.map(s => s.id)).toEqual(['extract'])
    expect(buckets.generate.map(s => s.id)).toEqual(['doc'])
    expect(buckets.custom.map(s => s.id)).toEqual(['standalone'])
  })

  // Ask has its own surface, so listing it here offers the same run twice,
  // and this is the poorer of the two.
  it('leaves an ask skill out, since the Ask surface owns it', () => {
    const buckets = bucketByGroup([
      skill({ id: 'ask-1', category: 'ask' }),
      skill({ id: 'extract', category: 'build', order: 100 }),
    ])
    expect(buckets.ask).toEqual([])
    expect(buckets.build.map(s => s.id)).toEqual(['extract'])
  })

  it('sorts the build group by numeric order so step ranks line up with the workflow', () => {
    const buckets = bucketByGroup([
      // Deliberately out of order, bucketByGroup must re-sort by `order`.
      skill({ id: 'reconcile', category: 'build', order: 300 }),
      skill({ id: 'extract', category: 'build', order: 100 }),
      skill({ id: 'clarify', category: 'build', order: 200 }),
    ])
    expect(buckets.build.map(s => s.id)).toEqual(['extract', 'clarify', 'reconcile'])
  })

  it('puts build skills without an order at the end so a plugin missing order is recoverable', () => {
    const buckets = bucketByGroup([
      skill({ id: 'extract', category: 'build', order: 100 }),
      skill({ id: 'mystery', category: 'build' }), // no order
      skill({ id: 'clarify', category: 'build', order: 200 }),
    ])
    expect(buckets.build.map(s => s.id)).toEqual(['extract', 'clarify', 'mystery'])
  })

  it('treats sparse order numbering correctly so plugins can slot between built-ins', () => {
    const buckets = bucketByGroup([
      skill({ id: 'extract', category: 'build', order: 100 }),
      skill({ id: 'clarify', category: 'build', order: 200 }),
      skill({ id: 'reconcile', category: 'build', order: 300 }),
      skill({ id: 'plugin-pre-extract', category: 'build', order: 50 }),
      skill({ id: 'plugin-mid', category: 'build', order: 150 }),
    ])
    expect(buckets.build.map(s => s.id)).toEqual([
      'plugin-pre-extract',
      'extract',
      'plugin-mid',
      'clarify',
      'reconcile',
    ])
  })
})
