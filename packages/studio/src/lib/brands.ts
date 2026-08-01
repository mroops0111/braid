import { AbsolutePath, EdgeId, LoaderKind, McpServerId, NodeId, OntologyId, SourceId, StorageKind } from '@braidhq/schema'

export const asSourceId = (s: string): SourceId => SourceId.parse(s)
export const asMcpServerId = (s: string): McpServerId => McpServerId.parse(s)
export const asLoaderKind = (s: string): LoaderKind => LoaderKind.parse(s)
export const asAbsolutePath = (s: string): AbsolutePath => AbsolutePath.parse(s)
export const asStorageKind = (s: string): StorageKind => StorageKind.parse(s)
export const asOntologyId = (s: string): OntologyId => OntologyId.parse(s)
export const asNodeId = (s: string): NodeId => NodeId.parse(s)
export const asEdgeId = (s: string): EdgeId => EdgeId.parse(s)
