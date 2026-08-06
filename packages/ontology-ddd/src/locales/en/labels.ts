/**
 * English labels for the DDD ontology vocabulary, keyed by id.
 * The base locale. zh-Hant lives alongside in ../zh-Hant/labels.
 * Descriptions carry academic citations and stay in DDDOntologyPlugin.
 */
export const labels = {
  sourceRoles: {
    intent: 'Intent',
    code: 'Code',
  },
  nodeTypes: {
    boundedContext: 'Bounded Context',
    aggregate: 'Aggregate',
    command: 'Command',
    query: 'Query',
    event: 'Domain Event',
    rule: 'Business Rule',
    actor: 'Actor',
    policy: 'Policy',
  },
  edgeTypes: {
    contains: 'contains',
    accepts: 'accepts',
    emits: 'emits',
    triggers: 'triggers',
    enacts: 'enacts',
    constrainedBy: 'constrained by',
    dependsOn: 'depends on',
    performedBy: 'performed by',
    partnership: 'partnership',
    customerSupplier: 'customer-supplier',
    conformist: 'conformist',
    sharedKernel: 'shared kernel',
    anticorruptionLayer: 'anticorruption layer',
    openHostService: 'open host service',
    publishedLanguage: 'published language',
  },
} as const

export default labels
