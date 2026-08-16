import type { OntologyPlugin } from '@braidhq/core'
import { dddOntology } from '@braidhq/ontology-ddd'

/**
 * The ontology plugins a default Braid build ships with.
 * This is the single composition point where a concrete ontology is named,
 * so swapping or adding one touches only this file.
 * composeFsApp registers these, and `braid init` reads their sourceRoles.
 */
export function defaultOntologyPlugins(): readonly OntologyPlugin[] {
  return [dddOntology]
}
