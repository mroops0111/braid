import { describe, expect, it } from 'vitest'
import { TaskCoalescer } from '../../src/application/TaskCoalescer.js'

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void, reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('TaskCoalescer', () => {
  it('runs the task once and hands every joined caller the same result', async () => {
    const coalescer = new TaskCoalescer()
    const gate = deferred<string>()
    let starts = 0
    const start = (): Promise<string> => coalescer.run('k', () => {
      starts++
      return gate.promise
    })

    const [first, second, third] = [start(), start(), start()]
    gate.resolve('done')

    expect(await Promise.all([first, second, third])).toEqual(['done', 'done', 'done'])
    expect(starts).toBe(1)
  })

  it('keeps distinct keys independent', async () => {
    const coalescer = new TaskCoalescer()
    let starts = 0
    const run = (key: string): Promise<number> => coalescer.run(key, async () => ++starts)
    await Promise.all([run('a'), run('b')])
    expect(starts).toBe(2)
  })

  it('releases the key so a later caller starts a fresh pass', async () => {
    const coalescer = new TaskCoalescer()
    let starts = 0
    const run = (): Promise<number> => coalescer.run('k', async () => ++starts)
    await run()
    await run()
    expect(starts).toBe(2)
  })

  it('propagates a rejection to every joined caller and still releases the key', async () => {
    const coalescer = new TaskCoalescer()
    const gate = deferred<string>()
    let starts = 0
    const start = (): Promise<string> => coalescer.run('k', () => {
      starts++
      return gate.promise
    })

    const [first, second] = [start(), start()]
    gate.reject(new Error('remote unreachable'))

    await expect(first).rejects.toThrow('remote unreachable')
    await expect(second).rejects.toThrow('remote unreachable')
    expect(starts).toBe(1)

    await expect(coalescer.run('k', async () => 'recovered')).resolves.toBe('recovered')
  })

  it('turns a synchronous throw into a rejection, and still frees the key', async () => {
    const coalescer = new TaskCoalescer()
    await expect(coalescer.run('k', () => {
      throw new Error('bad config')
    })).rejects.toThrow('bad config')

    await expect(coalescer.run('k', async () => 'recovered')).resolves.toBe('recovered')
  })
})
