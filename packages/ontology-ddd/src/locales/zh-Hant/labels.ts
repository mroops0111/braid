/**
 * Traditional Chinese labels for the DDD ontology vocabulary, keyed by id.
 * Node and edge types stay English, the DDD ubiquitous language.
 * Only source roles, shown in the source wizard, translate.
 * A missing id falls back to the English label.
 */
export const labels = {
  sourceRoles: {
    intent: '意圖',
    code: '程式碼',
  },
  // Node and edge types stay fully English, the DDD ubiquitous language.
  // One graph must not mix Chinese and English type badges.
  nodeTypes: {},
  edgeTypes: {},
} as const

export default labels
