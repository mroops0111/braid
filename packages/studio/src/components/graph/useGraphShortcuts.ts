import type { ReactFlowInstance } from '@xyflow/react'
import { useEffect } from 'react'

/**
 * Keyboard shortcuts scoped to the graph canvas. Cmd+F focuses the
 * navigator search input; Cmd+0 fits the canvas to viewport. The
 * effect's mount/unmount window ensures other tabs' chords aren't
 * affected when the canvas isn't mounted.
 */
export function useGraphShortcuts(reactFlow: ReactFlowInstance): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey))
        return
      if (event.key === 'f') {
        const input = document.querySelector<HTMLInputElement>('input[placeholder="Search nodes…"]')
        if (input) {
          event.preventDefault()
          input.focus()
          input.select()
        }
      }
      else if (event.key === '0') {
        event.preventDefault()
        reactFlow.fitView({ duration: 250 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reactFlow])
}
