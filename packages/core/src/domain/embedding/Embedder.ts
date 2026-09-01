/**
 * Turns text into vectors.
 *
 * One call takes a batch,
 * because every backend is far cheaper per text that way,
 * and a caller embedding a whole graph would otherwise pay that cost,
 * a thousand times over.
 */
export interface Embedder {
  /**
   * Names the model that produced a vector, stored alongside it.
   * Vectors from two models share no space,
   * so this is what tells a rebuild,
   * that the existing corpus cannot be compared with a new one.
   */
  readonly modelId: string
  embed: (texts: readonly string[]) => Promise<number[][]>
}
