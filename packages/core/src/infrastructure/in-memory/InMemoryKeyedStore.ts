import { NotFoundError } from '../../domain/errors.js'

export class InMemoryKeyedStore<TId, T> {
  protected readonly entries = new Map<TId, T>()

  constructor(private readonly entityLabel: string) {}

  has(id: TId): boolean {
    return this.entries.has(id)
  }

  set(id: TId, entry: T): void {
    this.entries.set(id, entry)
  }

  get(id: TId): T {
    const entry = this.entries.get(id)
    if (!entry)
      throw new NotFoundError(`${this.entityLabel} "${String(id)}" not found`)
    return entry
  }

  find(id: TId): T | undefined {
    return this.entries.get(id)
  }

  remove(id: TId): void {
    if (!this.entries.delete(id)) {
      throw new NotFoundError(`${this.entityLabel} "${String(id)}" not found`)
    }
  }

  listAll(): T[] {
    return [...this.entries.values()]
  }
}
