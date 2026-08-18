import type { ReferenceKind } from '@braidhq/schema'
import type { KeyboardEvent } from 'react'
import type { ReferenceCandidate } from '@/lib/references/ReferenceResolver'
import { X } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { MENU_CANDIDATE_LIMIT, readMenuKey, stepIndex, toMenuKeyPress } from '@/lib/references/menuNavigation'
import { useReferenceRegistry } from '@/lib/references/ReferenceRegistryContext'
import { menuFieldAria, ReferenceMenu } from './ReferenceMenu'
import { ReferenceTag } from './ReferenceTag'

interface ReferencePickerProps {
  id: string
  kind: ReferenceKind
  /** Empty string means nothing picked yet. */
  value: string
  onChange: (id: string) => void
  placeholder?: string
  disabled?: boolean
}

/**
 * Search-and-pick control for a field that stores one id.
 * Replaces free-typing an id, so a typo can no longer reach the server.
 */
export function ReferencePicker({ id, kind, value, onChange, placeholder, disabled }: ReferencePickerProps) {
  const { t } = useTranslation()
  const registry = useReferenceRegistry()
  const menuId = useId()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  if (value) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <ReferenceTag reference={{ kind, id: value }} />
        <button
          type="button"
          onClick={() => onChange('')}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
          {t('references.picker.clearButton')}
        </button>
      </div>
    )
  }

  const candidates = focused && registry ? registry.search(query, { kind, limit: MENU_CANDIDATE_LIMIT }) : []

  function pick(candidate: ReferenceCandidate): void {
    onChange(candidate.reference.id)
    setQuery('')
    setFocused(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const outcome = readMenuKey(toMenuKeyPress(event))
    if (outcome === 'dismiss') {
      setFocused(false)
      return
    }
    if (outcome === null || candidates.length === 0)
      return
    if (outcome === 'move-next' || outcome === 'move-previous') {
      event.preventDefault()
      setActiveIndex(current => stepIndex(current, candidates.length, outcome === 'move-next' ? 1 : -1))
      return
    }
    const candidate = candidates[activeIndex]
    if (!candidate)
      return
    event.preventDefault()
    pick(candidate)
  }

  return (
    <div className="relative">
      <Input
        id={id}
        {...menuFieldAria(menuId, focused, activeIndex, candidates.length)}
        value={query}
        disabled={disabled}
        placeholder={placeholder ?? t('references.picker.searchPlaceholder')}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
      />
      {focused && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1">
          <ReferenceMenu
            id={menuId}
            candidates={candidates}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onPick={pick}
            emptyDescription={t('references.picker.emptyDescription')}
          />
        </div>
      )}
    </div>
  )
}
