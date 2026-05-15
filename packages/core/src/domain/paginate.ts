export function paginate<T>(items: readonly T[], limit?: number, offset?: number): T[] {
  const start = offset ?? 0
  const end = limit !== undefined ? start + limit : undefined
  return items.slice(start, end)
}
