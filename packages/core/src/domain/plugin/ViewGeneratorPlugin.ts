import type { BlockKind, ModelSnapshot, ViewArtifact, ViewFormDescriptor, ViewKind, ViewSubjects } from '@braidhq/schema'
import type { z } from 'zod'
import type { NodeTypeDescriptor } from './OntologyPlugin.js'
import type { Plugin } from './Plugin.js'

export interface RenderInput {
  readonly model: ModelSnapshot
  /**
   * The active ontology's node types,
   * carried so a generator lays a document out from `renderHint`,
   * rather than from type names it knows by heart.
   * A renderer that branched on the vocabulary would serve one ontology.
   */
  readonly nodeTypes: readonly NodeTypeDescriptor[]
  readonly config: unknown
}

/**
 * A block shape this plugin ships, and what it has to look like.
 *
 * Braid validates against the schema,
 * so a malformed block never reaches a stored document,
 * and draws none of them.
 * A plugin that wants its own shape drawn draws it in its own surface,
 * because using Braid's surface means accepting Braid's own vocabulary,
 * and the design that goes with it.
 */
export interface PluginBlockKind {
  readonly kind: BlockKind
  readonly schema: z.ZodTypeAny
}

/**
 * The two halves of a view, split along what each is good at.
 *
 * `render` is a function,
 * so what a document is about, which term sits under which,
 * and where each came from come out the same every run.
 * Those are facts about the graph rather than choices about wording,
 * and a function does not have to be asked to stay consistent.
 *
 * A form is a skill, and it is handed the material with no template.
 * A generator that dictates the shape of an explanation,
 * gets a document that obeys the shape and teaches nobody.
 */
export interface ViewGeneratorPlugin extends Plugin {
  readonly type: 'view-generator'
  readonly viewKind: ViewKind
  /**
   * Which nodes this kind can be written about.
   * Absent takes any node,
   * which is the honest answer for a kind with no opinion,
   * rather than a silent narrowing a reader cannot see.
   */
  readonly subjects?: ViewSubjects
  /** The ways this kind is written out, one skill each. */
  readonly forms: readonly ViewFormDescriptor[]
  /** Shapes only this plugin understands, for `showCustom`. */
  readonly blockKinds?: readonly PluginBlockKind[]
  render: (input: RenderInput) => Promise<ViewArtifact>
}
