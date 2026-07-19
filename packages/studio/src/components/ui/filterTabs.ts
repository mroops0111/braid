/**
 * Shared className overrides for the in-surface status filter pattern
 * (Proposals `Pending | Applied | Rejected`, Clarification `Pending |
 * Answered | Applied | Skipped`). Renders as a segmented control: a
 * subtle outer container wraps the triggers so they read as "options
 * for ONE decision" rather than three independent nav items.
 *
 * Atom-level scale (h-7 base, text-xs, rounded-md) matches the
 * workspace surface dock in `WorkspaceHeader`; the visual difference
 * is composition (container vs no container), reflecting the
 * semantic difference (filter vs primary nav).
 */
export const FILTER_TABS_LIST
  = 'inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5'

export const FILTER_TAB_TRIGGER
  = 'h-6 rounded px-2 text-xs text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-transparent'
