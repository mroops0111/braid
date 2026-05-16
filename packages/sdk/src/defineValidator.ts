import type { Validator } from '@telos/core'
import type { ModelSnapshot, PluginId, ValidationIssue } from '@telos/schema'
import type { PluginSkillRef } from './types.js'
import { z } from 'zod'
import { assertNonEmpty } from './validation.js'

export interface DefineValidatorInput {
  readonly id: string
  /**
   * Validate the given snapshot. Return `[]` to mean "no findings".
   * Each issue's `code` should carry a namespace prefix (e.g.
   * `structural.dangling-edge`, `evidence.no-source`) so the UI can
   * group by category and link to docs.
   */
  readonly validate: (snapshot: ModelSnapshot) => Promise<readonly ValidationIssue[]>
  /** Skills this validator ships (e.g. a "diagnose & fix" companion). */
  readonly skills?: readonly PluginSkillRef[]
}

export function defineValidator(input: DefineValidatorInput): Validator {
  assertNonEmpty('validator id', input.id)

  return Object.freeze({
    id: input.id as PluginId,
    type: 'validator' as const,
    configSchema: z.object({}),
    skills: input.skills ?? [],
    validate: input.validate,
  } as Validator & { readonly skills: readonly PluginSkillRef[] })
}
