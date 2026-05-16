import type { ModelSnapshot, ValidationIssue } from '@braidhq/schema'
import type { Plugin } from './Plugin.js'

export interface Validator extends Plugin {
  readonly type: 'validator'
  validate: (snapshot: ModelSnapshot) => Promise<readonly ValidationIssue[]>
}
