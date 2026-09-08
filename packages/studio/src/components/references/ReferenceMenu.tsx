import type { ReferenceCandidate } from '@/lib/references/ReferenceResolver'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { hiddenMatchCount, MENU_PREFERRED_HEIGHT_PX } from '@/lib/references/menuNavigation'
import { cn } from '@/lib/utils'

interface ReferenceMenuProps {
  id: string
  candidates: readonly ReferenceCandidate[]
  /**
   * Every match, not just the listed ones.
   * A menu that stops at twenty says so rather than reading as twenty.
   */
  total?: number
  activeIndex: number
  onHover: (index: number) => void
  onPick: (candidate: ReferenceCandidate) => void
  emptyDescription: string
  className?: string
  /** What the caller worked out the menu may take where it put it. */
  maxHeightPx?: number
}

export function optionId(menuId: string, index: number): string {
  return `${menuId}-option-${index}`
}

/**
 * Combobox wiring for the field that drives a menu.
 * Shared so the textarea and the input announce themselves identically,
 * and so a fix to the pattern lands in one place.
 */
export function menuFieldAria(menuId: string, open: boolean, activeIndex: number, candidateCount: number) {
  return {
    'role': 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    'aria-activedescendant': open && candidateCount > 0 ? optionId(menuId, activeIndex) : undefined,
  } as const
}

/**
 * Candidate list for the mention menu and the picker.
 * Hand-rolled rather than built on cmdk, because focus has to stay,
 * in the textarea while the arrow keys drive this list.
 */
export function ReferenceMenu({
  id,
  candidates,
  total,
  activeIndex,
  onHover,
  onPick,
  emptyDescription,
  className,
  maxHeightPx,
}: ReferenceMenuProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLUListElement>(null)

  // The arrows drive this list from the field, which holds the focus,
  // so the browser never scrolls the active row into view on its own.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (candidates.length === 0) {
    return (
      <div className={cn('rounded-md border border-border bg-popover p-3 text-xs text-muted-foreground shadow-md', className)}>
        {emptyDescription}
      </div>
    )
  }
  const hidden = hiddenMatchCount(candidates.length, total)
  return (
    <div className={cn('rounded-md border border-border bg-popover shadow-md', className)}>
      <ul
        id={id}
        ref={listRef}
        role="listbox"
        style={{ maxHeight: maxHeightPx ?? MENU_PREFERRED_HEIGHT_PX }}
        className="overflow-y-auto p-1 scrollbar-thin"
      >
        {candidates.map((candidate, index) => (
          <li
            key={`${candidate.reference.kind}:${candidate.reference.id}`}
            id={optionId(id, index)}
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => onHover(index)}
            // The caret must stay put, so the press cannot move focus.
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(candidate)
            }}
            className={cn(
              'flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1.5 text-xs',
              index === activeIndex ? 'bg-accent text-accent-foreground' : 'text-foreground',
            )}
          >
            {/* The id is the identity a reader is picking, so the title yields space first. */}
            <span className="shrink-0 font-mono text-2xs text-primary/90">{candidate.reference.id}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{candidate.title}</span>
            {candidate.badge && (
              <span className="ml-auto shrink-0 text-2xs uppercase tracking-wider text-muted-foreground/70">
                {candidate.badge}
              </span>
            )}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="border-t border-border px-2 py-1 text-2xs text-muted-foreground">
          {t('references.menuMore', { count: hidden })}
        </p>
      )}
    </div>
  )
}
