import { describe, expect, it } from 'vitest'
import { Neo4jStorageConfig, StorageDescriptor, StorageKind } from '../src/index.js'

describe('storageKind (open brand)', () => {
  it('accepts neo4j', () => {
    expect(StorageKind.parse('neo4j')).toBe('neo4j')
  })
  it('accepts future kinds like memgraph', () => {
    expect(StorageKind.parse('memgraph')).toBe('memgraph')
  })
  it('rejects empty', () => {
    expect(StorageKind.safeParse('').success).toBe(false)
  })
})

describe('storageDescriptor', () => {
  it('parses a Neo4j descriptor', () => {
    const desc = StorageDescriptor.parse({
      kind: 'neo4j',
      config: { uri: 'bolt://localhost:7687', user: 'neo4j' },
    })
    expect(desc.kind).toBe('neo4j')
  })

  it('parses a third-party descriptor with pluginId', () => {
    const desc = StorageDescriptor.parse({
      kind: 'memgraph',
      pluginId: 'storage-memgraph',
      config: {},
    })
    expect(desc.pluginId).toBe('storage-memgraph')
  })
})

describe('neo4jStorageConfig', () => {
  it('parses with sensible defaults', () => {
    const config = Neo4jStorageConfig.parse({
      uri: 'bolt://localhost:7687',
      user: 'neo4j',
    })
    expect(config.database).toBe('neo4j')
  })

  it('accepts custom database', () => {
    const config = Neo4jStorageConfig.parse({
      uri: 'bolt://localhost:7687',
      user: 'neo4j',
      database: 'braid',
    })
    expect(config.database).toBe('braid')
  })
})
