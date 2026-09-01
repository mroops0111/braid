/**
 * Turns text into vectors.
 *
 * One call takes a batch, because every backend is far cheaper per text that
 * way, and a caller embedding a whole graph would otherwise pay the per-call
 * cost a thousand times.
 */
export interface Embedder {
  /**
   * Names the model that produced a vector, stored alongside it.
   * Vectors from two models share no space, so this is what tells a rebuild
   * that the existing corpus is no longer comparable.
   */
  readonly modelId: string
  embed: (texts: readonly string[]) => Promise<number[][]>
}
