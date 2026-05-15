import { AbsolutePath, LoaderKind, McpServerId, OntologyId, SourceId, StorageKind } from '@telos/schema'

export const asSourceId = (s: string): SourceId => SourceId.parse(s)
export const asMcpServerId = (s: string): McpServerId => McpServerId.parse(s)
export const asLoaderKind = (s: string): LoaderKind => LoaderKind.parse(s)
export const asAbsolutePath = (s: string): AbsolutePath => AbsolutePath.parse(s)
export const asStorageKind = (s: string): StorageKind => StorageKind.parse(s)
export const asOntologyId = (s: string): OntologyId => OntologyId.parse(s)
