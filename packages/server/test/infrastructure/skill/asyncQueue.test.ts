import { describe, expect, it } from 'vitest'
import { createAsyncQueue } from '../../../src/infrastructure/skill/asyncQueue.js'

describe('createAsyncQueue', () => {
  it('yields items in push order then completes on end()', async () => {
    const q = createAsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.end()

    const out: number[] = []
    for await (const v of q.iterate()) out.push(v)
    expect(out).toEqual([1, 2])
  })

  it('blocks consumer until producer pushes, then resumes', async () => {
    const q = createAsyncQueue<string>()
    const collected: string[] = []
    const consumer = (async () => {
      for await (const v of q.iterate()) collected.push(v)
    })()

    // Producer fires asynchronously.
    queueMicrotask(() => q.push('a'))
    setTimeout(() => q.push('b'), 5)
    setTimeout(() => q.end(), 10)

    await consumer
    expect(collected).toEqual(['a', 'b'])
  })

  it('handles end() called before any push (empty stream)', async () => {
    const q = createAsyncQueue<number>()
    q.end()
    const out: number[] = []
    for await (const v of q.iterate()) out.push(v)
    expect(out).toEqual([])
  })

  it('handles push() arriving during the resolver-set race window', async () => {
    const q = createAsyncQueue<number>()
    const consumer = (async () => {
      const acc: number[] = []
      for await (const v of q.iterate()) acc.push(v)
      return acc
    })()

    // Tight burst: end before consumer has a chance to install a resolver.
    q.push(7)
    q.end()
    expect(await consumer).toEqual([7])
  })
})
