import type { GraphOperation, ModelSnapshot, ValidationCode, ValidationIssue, ValidationResult } from '@braidhq/schema'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import { Model } from '../domain/model/Model.js'

export interface ValidationServiceDeps {
  pluginRegistry: PluginRegistry
}

export class ValidationService {
  constructor(private readonly deps: ValidationServiceDeps) {}

  async validate(snapshot: ModelSnapshot): Promise<ValidationResult> {
    const validators = this.deps.pluginRegistry.validators()
    const perValidator = await Promise.all(validators.map(validator => validator.validate(snapshot)))
    const issues: ValidationIssue[] = perValidator.flatMap(batch => [...batch])
    const ok = issues.every(issue => issue.severity !== 'error')
    return { ok, issues }
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
  async validateOperations(snapshot: ModelSnapshot, operations: readonly GraphOperation[]): Promise<ValidationResult> {
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
    return this.validate(next)
  }
}
