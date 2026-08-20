/**
 * Whether this Studio is running inside the desktop shell.
 *
 * A desktop install is the user's own client that may hold a list of servers,
 * and it sits beside its own embedded one.
 * A served page is that server's own surface and speaks only to that server,
 * the way any self-hosted web UI does.
 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
