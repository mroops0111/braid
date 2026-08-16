export * from './app.js'
export * from './composeApp.js'
export * from './composeFsApp.js'
export * from './defaultOntologyPlugins.js'
export * from './middleware/error.js'
export * from './startServer.js'

// Re-exported so `braid init` can type against the ontology contract,
// without a direct dependency on @braidhq/core or @braidhq/schema.
export type { OntologyPlugin } from '@braidhq/core'
export type { SourceRoleDescriptor } from '@braidhq/schema'
