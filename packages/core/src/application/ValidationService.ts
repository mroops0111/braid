import type { GraphOperation, ModelSnapshot, ValidationCode, ValidationIssue, ValidationResult } from '@braidhq/schema'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import { Model } from '../domain/model/Model.js'
import { EvidenceValidator } from '../infrastructure/validation/EvidenceValidator.js'
import { OrphanEdgeValidator } from '../infrastructure/validation/OrphanEdgeValidator.js'

export interface ValidationServiceDeps {
  pluginRegistry: PluginRegistry
}

/**
 * Orchestrates two layers of validation against a `ModelSnapshot`:
 *
 *  1. **Framework invariants** (`EvidenceValidator`, `OrphanEdgeValidator`) —
 *     hard-coded here because they're structural to Braid's HITL trust model
 *     (every node has evidence; every edge has endpoints). Not user-replaceable.
 *
 *  2. **Active ontology's validators** — each `OntologyPlugin` ships its own
 *     `validators[]` (auto-bound type + structural engines from
 *     `defineOntology()`; ontology authors may add more). Looked up by
 *     `workspace.productManifest.ontologyId` at validate-time, so switching
 *     a workspace's ontology immediately changes which rules apply.
 *
 * There is no separate `Validator` plugin axis. If user code needs to add
 * cross-cutting rules in the future, it adds them as a domain service that
 * `HITLService` calls before / after this one — not as a plugin.
 */
export class ValidationService {
  private readonly evidence = new EvidenceValidator()
  private readonly orphanEdge = new OrphanEdgeValidator()

  constructor(private readonly deps: ValidationServiceDeps) {}

  async validate(snapshot: ModelSnapshot, workspace: Workspace): Promise<ValidationResult> {
    const issues: ValidationIssue[] = []
    issues.push(...await this.evidence.validate(snapshot))
    issues.push(...await this.orphanEdge.validate(snapshot))

    const ontology = this.deps.pluginRegistry.findOntology(workspace.productManifest.ontologyId)
    if (ontology) {
      for (const validator of ontology.validators) {
        issues.push(...await validator.validate(snapshot))
      }
    }

    return { ok: issues.every(issue => issue.severity !== 'error'), issues }
  }

  /**
   * Pre-apply check used by `GET /proposals/:id/validate`. Runs the ops
   * through `Model.preview` to get the projected next snapshot, then
   * delegates to `validate`. If preview itself rejects (e.g. removeNode
   * of a non-existent node), we convert that into a structural
   * validation issue rather than letting the route 404 — the UI needs
   * a single shape it can render, and a structural mismatch is what
   * the user wants to see anyway.
   */
  async validateOperations(
    snapshot: ModelSnapshot,
    operations: readonly GraphOperation[],
    workspace: Workspace,
  ): Promise<ValidationResult> {
    let next: ModelSnapshot
    try {
      next = Model.preview(snapshot, operations)
    }
    catch (error) {
      return {
        ok: false,
        issues: [{
          code: 'structural.preview-failed' as ValidationCode,
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
        }],
      }
    }
    return this.validate(next, workspace)
  }
}
