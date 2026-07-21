import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentKind,
  LoaderKind,
  ModelSnapshot,
  OntologyId,
  PluginId,
  PluginType,
  StorageDescriptor,
  StorageKind,
  ViewArtifactFormat,
  ViewKind,
} from '@braidhq/schema'
import { T0 } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type AgentBinding,
  type AgentPlugin,
  ConflictError,
  type ModelRepository,
  NotFoundError,
  type OntologyPlugin,
  type Plugin,
  PluginRegistry,
  type ProvisionReport,
  type SourceLoaderPlugin,
  type StoragePlugin,
  type ViewGeneratorPlugin,
} from '../../../src/index.js'

function fakePlugin(id: string, type: PluginType): Plugin {
  return {
    id: id as PluginId,
    type,
    configSchema: { parse: (value: unknown) => value } as never,
  }
}

function fakeViewGenerator(id: string, viewKind: string): ViewGeneratorPlugin {
  return {
    ...fakePlugin(id, 'view-generator'),
    type: 'view-generator',
    viewKind: viewKind as ViewKind,
    render: async () => ({ kind: viewKind as ViewKind, format: 'markdown' as ViewArtifactFormat, files: [] }),
  }
}

function fakeOntology(id: string, ontologyId: string): OntologyPlugin {
  return {
    ...fakePlugin(id, 'ontology'),
    type: 'ontology',
    ontologyId: ontologyId as OntologyId,
    nodeTypes: [],
    edgeTypes: [],
    validators: [],
  }
}

function fakeAgentPlugin(id: string, kind: string): AgentPlugin {
  return {
    ...fakePlugin(id, 'agent'),
    type: 'agent',
    kind: kind as AgentKind,
    createBinding: (descriptor: AgentBindingDescriptor): AgentBinding => ({
      descriptor,
      resolveSpawn: async () => ({ bin: '/usr/bin/true', args: [], env: {} }),
      parseLine: () => [],
    }),
  }
}

function fakeSourceLoader(id: string, kind: string): SourceLoaderPlugin {
  return {
    ...fakePlugin(id, 'source-loader'),
    type: 'source-loader',
    kind: kind as LoaderKind,
    provision: async (): Promise<ProvisionReport> => ({
      localPath: '/abs/dest' as AbsolutePath,
      fetchedAt: T0,
    }),
  }
}

function fakeStoragePlugin(id: string, kind: string): StoragePlugin {
  const emptyRepository: ModelRepository = {
    load: async (): Promise<ModelSnapshot> => ({ nodes: [], edges: [] }),
    applyOperations: async () => {},
    listNodes: async () => [],
    getNode: async () => { throw new NotFoundError('not found') },
    scopeOf: async (): Promise<ModelSnapshot> => ({ nodes: [], edges: [] }),
    listEdges: async () => [],
  }
  return {
    ...fakePlugin(id, 'storage'),
    type: 'storage',
    kind: kind as StorageKind,
    createModelRepository: async (_descriptor: StorageDescriptor): Promise<ModelRepository> =>
      emptyRepository,
  }
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry

  beforeEach(() => {
    registry = new PluginRegistry()
  })

  it('register throws ConflictError on duplicate id', () => {
    registry.register(fakePlugin('a', 'ontology'))
    expect(() => registry.register(fakePlugin('a', 'ontology'))).toThrow(ConflictError)
  })

  it('has reflects registration state', () => {
    expect(registry.has('a' as PluginId)).toBe(false)
    registry.register(fakePlugin('a', 'ontology'))
    expect(registry.has('a' as PluginId)).toBe(true)
  })

  it('list / listByType', () => {
    registry.register(fakeOntology('a', 'a'))
    registry.register(fakeOntology('b', 'b'))
    registry.register(fakeViewGenerator('c', 'docs'))
    expect(registry.list()).toHaveLength(3)
    expect(registry.listByType('ontology')).toHaveLength(2)
    expect(registry.listByType('storage')).toHaveLength(0)
  })

  describe('pluginSkills', () => {
    function fakePluginWithSkills(id: string, skillIds: readonly string[]): Plugin {
      return {
        ...fakePlugin(id, 'ontology'),
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
      registry.register(fakePlugin('a', 'ontology'))
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

  describe('view-generator', () => {
    it('findViewGenerator returns generator when viewKind matches', () => {
      registry.register(fakeViewGenerator('gen-docs', 'docs'))
      expect(registry.findViewGenerator('docs' as ViewKind)?.id).toBe('gen-docs')
    })

    it('findViewGenerator returns undefined when no match', () => {
      expect(registry.findViewGenerator('docs' as ViewKind)).toBeUndefined()
    })

    it('requireViewGenerator returns the generator when viewKind matches', () => {
      registry.register(fakeViewGenerator('gen-docs', 'docs'))
      expect(registry.requireViewGenerator('docs' as ViewKind).id).toBe('gen-docs')
    })

    it('requireViewGenerator throws NotFoundError when no match', () => {
      expect(() => registry.requireViewGenerator('docs' as ViewKind)).toThrow(NotFoundError)
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

  describe('source-loader', () => {
    it('findSourceLoader / requireSourceLoader', () => {
      registry.register(fakeSourceLoader('sl-git', 'git'))
      expect(registry.findSourceLoader('git' as LoaderKind)?.id).toBe('sl-git')
      expect(registry.requireSourceLoader('git' as LoaderKind).id).toBe('sl-git')
    })

    it('requireSourceLoader throws when missing', () => {
      expect(() => registry.requireSourceLoader('gdrive' as LoaderKind)).toThrow(NotFoundError)
    })
  })

  describe('pluginReferenceDirs', () => {
    it('aggregates reference dirs across plugins and tags the contributor id', () => {
      registry.register({
        ...fakePlugin('p1', 'ontology'),
        referenceDirs: [{ name: 'ddd-concepts', directory: '/abs/ddd' }],
      })
      const dirs = registry.pluginReferenceDirs()
      expect(dirs).toHaveLength(1)
      expect(dirs[0]!.name).toBe('ddd-concepts')
      expect(dirs[0]!.contributedBy).toBe('p1')
    })

    it('returns an empty array when no plugin contributes reference dirs', () => {
      registry.register(fakePlugin('a', 'ontology'))
      expect(registry.pluginReferenceDirs()).toEqual([])
    })
  })
})
