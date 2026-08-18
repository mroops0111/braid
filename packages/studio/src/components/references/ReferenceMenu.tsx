import type { ReferenceCandidate } from '@/lib/references/ReferenceResolver'
import { cn } from '@/lib/utils'

interface ReferenceMenuProps {
  id: string
  candidates: readonly ReferenceCandidate[]
  activeIndex: number
  onHover: (index: number) => void
  onPick: (candidate: ReferenceCandidate) => void
  emptyDescription: string
  className?: string
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
  activeIndex,
  onHover,
  onPick,
  emptyDescription,
  className,
}: ReferenceMenuProps) {
  if (candidates.length === 0) {
    return (
      <div className={cn('rounded-md border border-border bg-popover p-3 text-xs text-muted-foreground shadow-md', className)}>
        {emptyDescription}
      </div>
    )
  }
  return (
    <ul
      id={id}
      role="listbox"
      className={cn('max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md scrollbar-thin', className)}
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
  )
}
