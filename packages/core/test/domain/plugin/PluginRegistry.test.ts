import type {
  AgentBindingDescriptor,
  AgentKind,
  ChannelDescriptor,
  ChannelKind,
  OntologyId,
  PluginId,
  PluginType,
  StorageDescriptor,
  StorageKind,
  ViewKind,
} from '@telos/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type AgentBinding,
  type AgentPlugin,
  type ChannelHandle,
  type ChannelPlugin,
  ConflictError,
  type Generator,
  NotFoundError,
  type Ontology,
  type Plugin,
  PluginRegistry,
  type StorageBackend,
  type StoragePlugin,
} from '../../../src/index.js'

function fakePlugin(id: string, type: PluginType): Plugin {
  return {
    id: id as PluginId,
    type,
    configSchema: { parse: (value: unknown) => value } as never,
  }
}

function fakeGenerator(id: string, viewKind: string): Generator {
  return {
    ...fakePlugin(id, 'generator'),
    type: 'generator',
    viewKind: viewKind as ViewKind,
    render: async () => ({ kind: viewKind as ViewKind, format: 'markdown' as never, files: [] }),
  }
}

function fakeOntology(id: string, ontologyId: string): Ontology {
  return {
    ...fakePlugin(id, 'ontology'),
    type: 'ontology',
    ontologyId: ontologyId as OntologyId,
    nodeTypes: [],
    edgeTypes: [],
  }
}

function fakeAgentPlugin(id: string, kind: string): AgentPlugin {
  return {
    ...fakePlugin(id, 'agent'),
    type: 'agent',
    kind: kind as AgentKind,
    createBinding: (descriptor: AgentBindingDescriptor): AgentBinding => ({
      descriptor,
      resolveSpawn: () => ({ bin: '/usr/bin/true', args: [], env: {} }),
    }),
  }
}

function fakeStoragePlugin(id: string, kind: string): StoragePlugin {
  return {
    ...fakePlugin(id, 'storage'),
    type: 'storage',
    kind: kind as StorageKind,
    createBackend: async (_descriptor: StorageDescriptor): Promise<StorageBackend> =>
      ({} as StorageBackend),
  }
}

function fakeChannelPlugin(id: string, kind: string): ChannelPlugin {
  return {
    ...fakePlugin(id, 'channel'),
    type: 'channel',
    kind: kind as ChannelKind,
    start: async (_descriptor: ChannelDescriptor): Promise<ChannelHandle> => ({
      stop: async () => {},
    }),
  }
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry

  beforeEach(() => {
    registry = new PluginRegistry()
  })

  it('register throws ConflictError on duplicate id', () => {
    registry.register(fakePlugin('a', 'validator'))
    expect(() => registry.register(fakePlugin('a', 'validator'))).toThrow(ConflictError)
  })

  it('has reflects registration state', () => {
    expect(registry.has('a' as PluginId)).toBe(false)
    registry.register(fakePlugin('a', 'validator'))
    expect(registry.has('a' as PluginId)).toBe(true)
  })

  it('list / listByType', () => {
    registry.register(fakePlugin('a', 'validator'))
    registry.register(fakePlugin('b', 'validator'))
    registry.register(fakePlugin('c', 'generator'))
    expect(registry.list()).toHaveLength(3)
    expect(registry.listByType('validator')).toHaveLength(2)
    expect(registry.listByType('storage')).toHaveLength(0)
  })

  describe('pluginSkills', () => {
    function fakePluginWithSkills(id: string, skillIds: readonly string[]): Plugin {
      return {
        ...fakePlugin(id, 'validator'),
        skills: skillIds.map(s => ({ id: s as never, directory: `/abs/${s}` })),
      }
    }

    it('aggregates skills across plugins and tags them with the contributor id', () => {
      registry.register(fakePluginWithSkills('p1', ['extract-foo']))
      registry.register(fakePluginWithSkills('p2', ['extract-bar', 'fix-baz']))
      const skills = registry.pluginSkills()
      expect(skills.map(s => s.id)).toEqual(['extract-foo', 'extract-bar', 'fix-baz'])
      expect(skills.find(s => s.id === 'fix-baz' as never)?.contributedBy).toBe('p2')
    })

    it('throws ConflictError when two plugins declare the same skill id', () => {
      registry.register(fakePluginWithSkills('p1', ['shared-skill']))
      expect(() => registry.register(fakePluginWithSkills('p2', ['shared-skill']))).toThrow(ConflictError)
    })

    it('returns an empty array when no plugin contributes skills', () => {
      registry.register(fakePlugin('a', 'validator'))
      expect(registry.pluginSkills()).toEqual([])
    })
  })

  describe('ontology', () => {
    it('findOntology / requireOntology', () => {
      registry.register(fakeOntology('p-ddd', 'ddd'))
      expect(registry.findOntology('ddd' as OntologyId)?.id).toBe('p-ddd')
      expect(registry.requireOntology('ddd' as OntologyId).id).toBe('p-ddd')
    })

    it('requireOntology throws NotFoundError when missing', () => {
      expect(() => registry.requireOntology('missing' as OntologyId)).toThrow(NotFoundError)
    })
  })

  describe('generator', () => {
    it('findGenerator returns generator when viewKind matches', () => {
      registry.register(fakeGenerator('gen-docs', 'docs'))
      expect(registry.findGenerator('docs' as ViewKind)?.id).toBe('gen-docs')
    })

    it('findGenerator returns undefined when no match', () => {
      expect(registry.findGenerator('docs' as ViewKind)).toBeUndefined()
    })

    it('requireGenerator throws NotFoundError when no match', () => {
      expect(() => registry.requireGenerator('docs' as ViewKind)).toThrow(NotFoundError)
    })
  })

  describe('agent', () => {
    it('findAgentPlugin / requireAgentPlugin', () => {
      registry.register(fakeAgentPlugin('a-cc', 'claude-code'))
      expect(registry.findAgentPlugin('claude-code' as AgentKind)?.id).toBe('a-cc')
      expect(registry.requireAgentPlugin('claude-code' as AgentKind).id).toBe('a-cc')
    })

    it('requireAgentPlugin throws when missing', () => {
      expect(() => registry.requireAgentPlugin('missing' as AgentKind)).toThrow(NotFoundError)
    })
  })

  describe('storage', () => {
    it('findStoragePlugin / requireStoragePlugin', () => {
      registry.register(fakeStoragePlugin('s-neo4j', 'neo4j'))
      expect(registry.findStoragePlugin('neo4j' as StorageKind)?.id).toBe('s-neo4j')
      expect(registry.requireStoragePlugin('neo4j' as StorageKind).id).toBe('s-neo4j')
    })

    it('requireStoragePlugin throws when missing', () => {
      expect(() => registry.requireStoragePlugin('memgraph' as StorageKind)).toThrow(NotFoundError)
    })
  })

  describe('channel', () => {
    it('findChannelPlugin / requireChannelPlugin', () => {
      registry.register(fakeChannelPlugin('c-http', 'http'))
      expect(registry.findChannelPlugin('http' as ChannelKind)?.id).toBe('c-http')
      expect(registry.requireChannelPlugin('http' as ChannelKind).id).toBe('c-http')
    })

    it('requireChannelPlugin throws when missing', () => {
      expect(() => registry.requireChannelPlugin('mcp' as ChannelKind)).toThrow(NotFoundError)
    })
  })
})
