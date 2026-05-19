/**
 * Type-asserted JSON parse for `Response`. `Response.json()` returns
 * `Promise<unknown>`; tests that touch fields immediately have to cast.
 * This helper consolidates the cast so call sites stay readable.
 */
export async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}
