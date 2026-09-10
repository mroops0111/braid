import { scopeCovers } from '../skill/runScope.js'
/** A unit on disk, as the lister reports it. Narrowed to what matching needs. */
export interface ListedUnit {
  readonly sourceId: string
  readonly value: string
}

/**
 * Which source units a run was pointed at.
 *
 * The arguments a run was started with are a fact the server holds, so which
 * document it read never has to be reported by the agent. Asking would be
 * asking a model to restate its own scope, which it can get wrong and which
 * nothing downstream would catch.
 *
 * Matched by a unit's path appearing in the arguments, because a per-unit
 * skill is started with that path as its scope. A run naming no unit yields
 * nothing, which is right for a step that works on the graph as a whole.
 *
 * The version each unit is at is deliberately not read here. What a document
 * hashes to is the digest's to answer and changes between calls, while which
 * documents were named does not.
 */
export function sourceUnitsForRun<T extends ListedUnit>(args: string, units: readonly T[]): T[] {
  if (args.length === 0)
    return []
  return units.filter(unit => unit.value.length > 0 && scopeCovers(args, unit.value))
}
