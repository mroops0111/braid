import type { EdgeTypeId, ModelSnapshot, NodeStatus, NodeTypeId, OntologyId, PlanUnit, SkillId, ValidationIssue } from '@braidhq/schema'
import type { Plugin } from './Plugin.js'

export interface NodeTypeDescriptor {
  readonly id: NodeTypeId
  readonly label: string
  readonly description?: string
  readonly allowedStatuses?: readonly NodeStatus[]
  /**
   * Optional UI accent colour. Any CSS colour string the browser
   * accepts (`oklch(...)`, `#7c3aed`, `rgb(...)`). Studio uses it for
   * node-card type badges and edge strokes; if omitted, Studio falls
   * back to a deterministic hash-of-id colour so an ontology without
   * authored colours still renders distinguishable types.
   */
  readonly color?: string
  /**
   * Whether this type is shown by default when the user first opens the
   * graph. When any descriptor sets this, Studio initialises the type
   * filter to only those types (typically the high-level structural
   * types like boundedContext / aggregate). User can clear the filter
   * to reveal the rest. If no descriptor sets it, all types show.
   */
  readonly defaultVisible?: boolean
  /**
   * Hints for ontology-agnostic renderers (e.g. `braid-generate-doc`)
   * to lay nodes out in a document tree without hard-coding ontology
   * vocabulary. `container: true` marks a type as a top-level
   * grouping (one rendered file per node). `expandedUnder` names
   * the type whose nodes act as parents in the rendered tree —
   * children of nodes of that type appear nested under them.
   * `section` is the human-facing heading text the renderer uses
   * when grouping flat lists of this type. All fields are optional;
   * a descriptor with no hint is rendered as a footnote / leaf.
   */
  readonly renderHint?: {
    readonly container?: boolean
    readonly expandedUnder?: NodeTypeId
    readonly section?: string
  }
}

export interface EdgeTypeDescriptor {
  readonly id: EdgeTypeId
  readonly label?: string
  /**
   * Short prose explaining what this edge means and when to emit it.
   * Surfaced to LLMs through the `/ontology` API and to reviewers
   * through the Studio palette / legend tooltip. Same role as
   * `NodeTypeDescriptor.description`.
   */
  readonly description?: string
  readonly fromTypes: readonly NodeTypeId[]
  readonly toTypes: readonly NodeTypeId[]
  readonly cardinality?: '1:1' | '1:N' | 'N:1' | 'N:N'
  /** Optional UI accent colour. Same semantics as `NodeTypeDescriptor.color`. */
  readonly color?: string
}

/**
 * Validator bundled with an ontology. The ontology brings its own
 * enforcement (type check, structural rules, future ontology-specific
 * invariants) instead of those being separate plugins that have to
 * cross-reference the ontology at runtime.
 *
 * `defineOntology()` auto-binds the framework's two generic engines
 * (`OntologyTypeValidator` + `StructuralValidator`); ontology authors
 * pass `extraValidators` for anything beyond declarative checks.
 */
export interface OntologyValidator {
  validate: (snapshot: ModelSnapshot) => Promise<readonly ValidationIssue[]>
}

/** Skill dispatched against one intent unit, plus its UI label and arg builder. */
export interface OntologyPerUnitBinding {
  readonly skillId: SkillId
  /** UI badge text per unit row. Falls back to `skillId` when omitted. */
  readonly label?: string
  /** Defaults to `unit.scopeHint ?? unit.name`. */
  readonly argsFor?: (unit: PlanUnit) => string
}

/** Cross-unit hook fired between unit runs. Omit for a pure per-unit batch. */
export interface OntologyCheckpointBinding {
  readonly skillId: SkillId
  /** UI badge text per checkpoint row. Falls back to `skillId` when omitted. */
  readonly label?: string
  /** Fire after every N successful per-unit runs. */
  readonly chunkSize: number
  /** Run an extra checkpoint at the end of the loop even when units divide evenly. */
  readonly runAtEnd: boolean
  /** Env vars the checkpoint skill reads (e.g. DDD's `BRAID_CHANGED_UNITS`). */
  readonly extraEnv?: (units: readonly PlanUnit[]) => Record<string, string>
}

/** Discovery skill that produces a unit list when the workspace has no intent source. */
export interface OntologyDeriveUnitsBinding {
  readonly skillId: SkillId
}

/**
 * Ontology's contract with framework-level batch / reactor processes.
 * Framework owns "what to dispatch and when"; ontology owns skill IDs
 * and env contracts. Optional fields let an ontology opt out of phases.
 */
export interface OntologyBatchBinding {
  readonly perUnit: OntologyPerUnitBinding
  readonly checkpoint?: OntologyCheckpointBinding
  readonly deriveUnits?: OntologyDeriveUnitsBinding
}

export interface OntologyPlugin extends Plugin {
  readonly type: 'ontology'
  readonly ontologyId: OntologyId
  readonly nodeTypes: readonly NodeTypeDescriptor[]
  readonly edgeTypes: readonly EdgeTypeDescriptor[]
  /**
   * Validators that run against the model whenever the workspace is
   * configured to use this ontology. Populated by `defineOntology()`.
   */
  readonly validators: readonly OntologyValidator[]
  /**
   * Wiring for batch / reactor orchestration. Required for any
   * ontology that wants to participate in batches; framework refuses
   * to start a batch if this is absent on the workspace's ontology.
   */
  readonly batch?: OntologyBatchBinding
  /**
   * Source roles that MUST be present in the workspace for this
   * ontology to function. The scaffold endpoint validates the
   * manifest against this list; a workspace that omits any required
   * role is rejected with 422 so the wizard can prompt for it. The
   * DDD ontology declares `['intent', 'code']` because Braid's core
   * value prop is intent⊕code convergence — pure-intent or pure-code
   * workspaces produce a polluted ubiquitous language. Generative
   * ontologies that have no code dimension (e.g. the everstory `story`
   * ontology) declare only `['intent']`.
   */
  readonly requiredSourceRoles?: readonly ('code' | 'intent')[]
}
