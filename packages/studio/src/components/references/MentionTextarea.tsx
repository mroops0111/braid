import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import type { ActiveMention } from '@/lib/references/mentionQuery'
import type { ReferenceCandidate } from '@/lib/references/ReferenceResolver'
import { splitReferences } from '@braidhq/schema'
import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { applyMention, findActiveMention, sameMention } from '@/lib/references/mentionQuery'
import { MENU_CANDIDATE_LIMIT, readMenuKey, stepIndex, toMenuKeyPress } from '@/lib/references/menuNavigation'
import { useReferenceRegistry } from '@/lib/references/ReferenceRegistryContext'
import { cn } from '@/lib/utils'
import { menuFieldAria, ReferenceMenu } from './ReferenceMenu'

interface MentionTextareaProps {
  id: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  rows?: number
  maxLength?: number
  disabled?: boolean
  autoFocus?: boolean
  /** Denser padding and type for inline slots such as an answer note. */
  compact?: boolean
  /** Mono type, for prompt boxes where the caller writes machine-facing text. */
  mono?: boolean
  /** Layout only, applied to the wrapper. Typography belongs to the props above. */
  className?: string
  /** Runs for keys the mention menu did not consume, e.g. Enter to submit. */
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

/**
 * Textarea whose `@kind:id` tokens are highlighted and whose `@` opens a picker.
 *
 * The highlight is a second box behind the textarea that paints only the token
 * backgrounds, its own text stays transparent so the textarea keeps rendering
 * the glyphs. Both boxes therefore need identical metrics, which is why the
 * shared class below is the single source for font, padding, and wrapping.
 * The same box also carries the anchor the menu positions against.
 *
 * Manual resize is off. A drag would change the textarea's height without
 * moving the overlay, and the two boxes would drift apart. For the same reason
 * typography is a prop rather than a caller className, a font applied to one
 * box only would misalign every highlight.
 */
const BOX_CLASS = 'w-full rounded-md border py-1.5 leading-relaxed whitespace-pre-wrap break-words'
const DENSITY_CLASS = { default: 'px-3 text-sm', compact: 'px-2 text-xs' } as const

const MENU_WIDTH_REM = 26
// Matches the menu's own max height, see ReferenceMenu.
const MENU_MAX_HEIGHT_PX = 256

interface MenuPosition {
  left: number
  /** Exactly one of these is set, which decides the growth direction. */
  top?: number
  bottom?: number
}

export function MentionTextarea({
  id,
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength,
  disabled,
  autoFocus,
  compact,
  mono,
  className,
  onKeyDown,
}: MentionTextareaProps) {
  const { t } = useTranslation()
  // Shared by both boxes, so the highlight always sits under the same glyphs.
  const boxClass = cn(BOX_CLASS, compact ? DENSITY_CLASS.compact : DENSITY_CLASS.default, mono && 'font-mono')
  const registry = useReferenceRegistry()
  const menuId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [mention, setMention] = useState<ActiveMention | null>(null)
  const [dismissedStart, setDismissedStart] = useState<number | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)

  const open = mention !== null && mention.start !== dismissedStart
  const candidates = open && registry
    ? registry.search(mention.query, { limit: MENU_CANDIDATE_LIMIT })
    : []

  useLayoutEffect(() => {
    syncScroll(overlayRef, textareaRef)
  }, [value])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const container = containerRef.current
    if (!open || !anchor || !container) {
      setMenuPosition(null)
      return
    }
    const anchorBox = anchor.getBoundingClientRect()
    const containerBox = container.getBoundingClientRect()
    // Prompt boxes sit at the bottom of a page, so a menu below the caret would
    // fall off screen. Anchoring the menu's bottom edge lets it grow upward
    // without having to know its height first.
    const flipUp = window.innerHeight - anchorBox.bottom < MENU_MAX_HEIGHT_PX
    setMenuPosition({
      left: anchorBox.left - containerBox.left,
      ...(flipUp
        ? { bottom: containerBox.bottom - anchorBox.top }
        : { top: anchorBox.bottom - containerBox.top }),
    })
  }, [open, mention?.start, value])

  function refreshMention(nextValue: string, caret: number | null): void {
    const found = caret === null ? null : findActiveMention(nextValue, caret)
    // Every caret event calls this, including the key-up after an arrow key.
    // Resetting the highlight unconditionally would undo the arrow before the
    // reader sees it move, so an unchanged mention is left alone.
    if (sameMention(mention, found))
      return
    setMention(found)
    setActiveIndex(0)
    if (found === null)
      setDismissedStart(null)
  }

  function pick(candidate: ReferenceCandidate): void {
    const textarea = textareaRef.current
    if (!mention || !textarea)
      return
    const inserted = applyMention(value, mention, textarea.selectionStart, candidate.reference)
    onChange(inserted.value)
    setMention(null)
    setDismissedStart(null)
    // The value lands on the next render, so move the caret after it.
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(inserted.caret, inserted.caret)
    })
  }

  // True when the menu claimed the key, which keeps a host binding such as
  // Enter-to-submit from firing while the reader is choosing a node.
  function menuHandledKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    const outcome = readMenuKey(toMenuKeyPress(event))
    if (outcome === null)
      return false
    // Escape still dismisses an open mention whose query matched nothing,
    // otherwise the anchor would keep reopening the empty menu.
    if (outcome === 'dismiss') {
      if (!mention)
        return false
      event.preventDefault()
      setDismissedStart(mention.start)
      return true
    }
    if (!open || candidates.length === 0)
      return false
    if (outcome === 'move-next' || outcome === 'move-previous') {
      event.preventDefault()
      setActiveIndex(current => stepIndex(current, candidates.length, outcome === 'move-next' ? 1 : -1))
      return true
    }
    const candidate = candidates[activeIndex]
    if (!candidate)
      return false
    event.preventDefault()
    pick(candidate)
    return true
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!menuHandledKey(event))
      onKeyDown?.(event)
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div
        ref={overlayRef}
        aria-hidden
        className={cn(boxClass, 'pointer-events-none absolute inset-0 overflow-hidden border-transparent text-transparent')}
      >
        {renderOverlay(value, open ? mention.start : null, anchorRef)}
      </div>
      <textarea
        id={id}
        ref={textareaRef}
        {...menuFieldAria(menuId, open, activeIndex, candidates.length)}
        value={value}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value)
          refreshMention(event.target.value, event.target.selectionStart)
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={event => refreshMention(event.currentTarget.value, event.currentTarget.selectionStart)}
        onClick={event => refreshMention(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setMention(null)}
        onScroll={() => syncScroll(overlayRef, textareaRef)}
        className={cn(
          boxClass,
          'relative block resize-none border-input bg-transparent shadow-xs outline-none dark:bg-input/30',
          'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      {open && menuPosition && (
        <div
          className="absolute z-50"
          style={{ ...menuPosition, width: `${MENU_WIDTH_REM}rem`, maxWidth: '100%' }}
        >
          <ReferenceMenu
            id={menuId}
            candidates={candidates}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onPick={pick}
            emptyDescription={t('references.mention.emptyDescription')}
          />
        </div>
      )}
    </div>
  )
}

function syncScroll(overlay: RefObject<HTMLDivElement | null>, textarea: RefObject<HTMLTextAreaElement | null>): void {
  if (!overlay.current || !textarea.current)
    return
  overlay.current.scrollTop = textarea.current.scrollTop
  overlay.current.scrollLeft = textarea.current.scrollLeft
}

/**
 * Paints token backgrounds and drops the menu anchor at the live `@`.
 * The anchor always lands inside a text run, since a caret inside a finished
 * token is not treated as a mention.
 */
function renderOverlay(value: string, anchorAt: number | null, anchorRef: RefObject<HTMLSpanElement | null>): ReactNode[] {
  const nodes: ReactNode[] = []
  let offset = 0
  for (const [index, segment] of splitReferences(value).entries()) {
    if (segment.type === 'reference') {
      nodes.push(<mark key={index} className="rounded-sm bg-primary/20 text-transparent">{segment.text}</mark>)
    }
    else if (anchorAt !== null && anchorAt >= offset && anchorAt <= offset + segment.text.length) {
      const cut = anchorAt - offset
      nodes.push(<Fragment key={`${index}-before`}>{segment.text.slice(0, cut)}</Fragment>)
      nodes.push(<span key={`${index}-anchor`} ref={anchorRef} className="inline-block w-0" />)
      nodes.push(<Fragment key={`${index}-after`}>{segment.text.slice(cut)}</Fragment>)
    }
    else {
      nodes.push(<Fragment key={index}>{segment.text}</Fragment>)
    }
    offset += segment.text.length
  }
  // A trailing newline collapses in the overlay but not in the textarea.
  nodes.push(<Fragment key="tail">{'\n'}</Fragment>)
  return nodes
}
