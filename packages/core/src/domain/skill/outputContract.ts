import type { EmittedBlock, SkillOutputContract } from '@braidhq/schema'

/** One way a finished run fell short of what its skill declared it would render. */
export interface OutputViolation {
  readonly kind: 'missing-call' | 'missing-audience'
  /** The call name or audience the contract asked for. */
  readonly target: string
  /** What the run actually produced for it. */
  readonly found: number
  readonly required: number
}

/**
 * Checks a finished run's blocks against the contract its skill declared.
 *
 * Pure and total, so the retry decision stays testable without a subprocess.
 * A contract that asks for nothing yields no violations, which is what an
 * undeclared skill gets.
 */
export function validateOutput(
  contract: SkillOutputContract,
  blocks: readonly EmittedBlock[],
): readonly OutputViolation[] {
  const violations: OutputViolation[] = []

  for (const call of contract.requiredCalls) {
    const found = blocks.filter(entry => entry.block.call === call).length
    if (found === 0)
      violations.push({ kind: 'missing-call', target: call, found, required: 1 })
  }

  for (const [audience, required] of Object.entries(contract.minPerAudience)) {
    if (required === undefined)
      continue
    // `both` deliberately counts toward neither. A block addressed to everyone
    // does not show the split was considered, which is what this checks.
    const found = blocks.filter(entry => entry.block.audience === audience).length
    if (found < required)
      violations.push({ kind: 'missing-audience', target: audience, found, required })
  }

  return violations
}

/**
 * The correction handed back to the agent, phrased as the gap rather than as
 * a repeat of the original request, so the next turn adds instead of redoing.
 */
export function describeViolations(violations: readonly OutputViolation[]): string {
  const lines = violations.map((violation) => {
    if (violation.kind === 'missing-call')
      return `- You never called \`${violation.target}\`, which this skill's output contract requires.`
    return `- You rendered ${violation.found} block(s) for the \`${violation.target}\` audience, and the contract requires ${violation.required}.`
  })
  return [
    'Your run ended, but its output does not satisfy the contract this skill declares:',
    '',
    ...lines,
    '',
    'Emit only what is missing, using the render tools. Do not repeat what you',
    'already rendered, and do not restate the answer. If a gap genuinely has no',
    'content behind it, say so in one sentence rather than padding it.',
  ].join('\n')
}
