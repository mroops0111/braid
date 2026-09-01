/**
 * Cosine similarity between two vectors of equal length.
 * Returns 0 for a zero vector rather than dividing by zero,
 * since a vector with no magnitude has no direction to compare.
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0)
    return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

/**
 * Smoothing constant for reciprocal rank fusion.
 * 60 is the value the original paper settled on and the one every
 * hybrid-search implementation since has used, so it stays a constant
 * rather than a knob nobody would know how to turn.
 */
const RRF_SMOOTHING = 60

/**
 * Merge ranked lists by reciprocal rank fusion.
 *
 * Fusion reads ranks rather than scores, so a lexical hit count and a cosine
 * distance combine without either being rescaled into the other's units.
 * A result found by both lists outranks one found by a single list,
 * which is the whole reason to run two retrievers.
 */
export function fuseByRank<T>(lists: ReadonlyArray<readonly T[]>, identify: (item: T) => string): T[] {
  const scores = new Map<string, number>()
  const items = new Map<string, T>()
  for (const list of lists) {
    list.forEach((item, index) => {
      const key = identify(item)
      items.set(key, item)
      scores.set(key, (scores.get(key) ?? 0) + 1 / (RRF_SMOOTHING + index + 1))
    })
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => items.get(key)!)
}
