import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

interface PageActionsContextValue {
  host: HTMLElement | null
  setHost: (el: HTMLElement | null) => void
}

const PageActionsContext = createContext<PageActionsContextValue | null>(null)

/**
 * Provider for the page-actions portal. Owns the registered host
 * element and notifies consumers via context when it mounts. Lives
 * once near the app root.
 *
 * Memoising the value with a stable `setHost` keeps consumer
 * re-renders pegged to the actual host DOM ref change rather than to
 * provider re-renders.
 */
export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const stableSetHost = useCallback((el: HTMLElement | null) => setHost(el), [])
  const value = useMemo<PageActionsContextValue>(() => ({ host, setHost: stableSetHost }), [host, stableSetHost])
  return (
    <PageActionsContext.Provider value={value}>
      {children}
    </PageActionsContext.Provider>
  )
}

/**
 * Marker element pages portal their toolbar content into. Render once
 * at the location you want page-level actions to appear (typically
 * the right edge of the main tab bar). Registers itself via a ref
 * callback; consumers see the host through context the moment React
 * commits.
 */
export function PageActionsHost({ className }: { className?: string }) {
  const ctx = useContext(PageActionsContext)
  if (!ctx)
    throw new Error('PageActionsHost must be rendered inside PageActionsProvider')
  return <div ref={ctx.setHost} className={className} />
}

/**
 * Portals its children into the registered host. Use one per page.
 * Returns null until the host commits — React's context update from
 * the host's ref callback triggers a consumer re-render at that
 * point, no manual force-render needed.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const ctx = useContext(PageActionsContext)
  if (!ctx?.host)
    return null
  return createPortal(children, ctx.host)
}
