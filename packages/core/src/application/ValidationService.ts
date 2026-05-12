import type { GraphOperation, ModelSnapshot, ValidationIssue, ValidationResult } from '@telos/schema'
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

  async validateOperations(snapshot: ModelSnapshot, operations: readonly GraphOperation[]): Promise<ValidationResult> {
    const next = Model.preview(snapshot, operations)
    return this.validate(next)
  }
}
