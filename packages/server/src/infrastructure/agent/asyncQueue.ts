/**
 * Single-producer / single-consumer async queue backing an `AsyncIterable`.
 *
 * Used to bridge node `EventEmitter`-style callbacks (which fire whenever
 * subprocess stdout / stderr / close events arrive) into `for await … of`
 * consumers (Hono's SSE writer, vitest assertions) without buffering every
 * event until the producer is done.
 *
 * Contract:
 *   - `push(item)` enqueues an item and wakes a pending consumer.
 *   - `end()` signals that no more items are coming; the iterator finishes
 *     once it has drained the queue.
 *   - `iterate()` returns a single-use async generator. Calling it more than
 *     once is undefined.
 */
export interface AsyncQueue<T> {
  push: (item: T) => void
  end: () => void
  iterate: () => AsyncGenerator<T>
}

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const buffer: T[] = []
  let resolver: (() => void) | null = null
  let finished = false

  const wake = (): void => {
    if (resolver) {
      const r = resolver
      resolver = null
      r()
    }
  }

  return {
    push: (item) => {
      buffer.push(item)
      wake()
    },
    end: () => {
      finished = true
      wake()
    },
    iterate: async function* iterate() {
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift()!
          continue
        }
        if (finished)
          return
        // The double check inside the Promise constructor avoids a race
        // where `push` or `end` is called between the queue-length check
        // and the resolver assignment.
        await new Promise<void>((r) => {
          if (buffer.length > 0 || finished) {
            r()
            return
          }
          resolver = r
        })
      }
    },
  }
}
