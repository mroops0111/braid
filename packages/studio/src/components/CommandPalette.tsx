import type { NodeId, SkillManifest, Workspace } from '@braidhq/schema'
import { Activity, ClipboardCheck, GitGraph, HelpCircle, Network, Settings, Settings2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { useNodeSearch, useSkills } from '@/lib/queries'
import { useDebounced } from '@/lib/useDebounced'
import { useEmbeddingProgress } from '@/lib/useEmbeddingProgress'
import { WorkspaceSwatch } from './WorkspaceSwatch'

interface CommandPaletteProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeSurface: Surface | null
  onSelectWorkspace: (id: string) => void
  onSelectSurface: (surface: Surface | null) => void
  onOpenWorkspaceDetails: () => void
  /** Take the reader to a node on the graph and centre it there. */
  onSelectNode: (nodeId: NodeId) => void
  /** Lifted so a visible control can open the palette without the shortcut. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

export type Surface = 'actions' | 'activity' | 'batch' | 'clarifications' | 'history' | 'proposals' | 'settings'

type ChordTarget = { kind: 'surface', surface: Surface | null } | { kind: 'workspace-details' }

function chordSecondKey(key: string): ChordTarget | undefined {
  switch (key) {
    case 'g': return { kind: 'surface', surface: null }
    case 'a': return { kind: 'surface', surface: 'actions' }
    case 'c': return { kind: 'surface', surface: 'clarifications' }
    case 'p': return { kind: 'surface', surface: 'proposals' }
    case 'b': return { kind: 'surface', surface: 'activity' }
    case 'h': return { kind: 'surface', surface: 'history' }
    case 's': return { kind: 'surface', surface: 'settings' }
    case 'w': return { kind: 'workspace-details' }
    default: return undefined
  }
}

// `as const` keeps labelKey literal so t() validates each against the typed catalog.
const SURFACE_ITEMS = [
  { id: null, labelKey: 'shell.commandPalette.graphHome', Icon: Network, shortcut: 'G G' },
  { id: 'actions', labelKey: 'shell.surfaces.actions', Icon: Sparkles, shortcut: 'G A' },
  { id: 'clarifications', labelKey: 'shell.surfaces.clarifications', Icon: HelpCircle, shortcut: 'G C' },
  { id: 'proposals', labelKey: 'shell.surfaces.proposals', Icon: ClipboardCheck, shortcut: 'G P' },
  { id: 'activity', labelKey: 'shell.surfaces.activity', Icon: Activity, shortcut: 'G B' },
  { id: 'history', labelKey: 'shell.surfaces.history', Icon: GitGraph, shortcut: 'G H' },
  { id: 'settings', labelKey: 'shell.surfaces.settings', Icon: Settings, shortcut: 'G S' },
] as const satisfies readonly { id: Surface | null, labelKey: string, Icon: typeof Sparkles, shortcut: string }[]

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement))
    return false
  if (target.isContentEditable)
    return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

const CHORD_TIMEOUT_MS = 1000

export function CommandPalette({
  workspaces,
  activeWorkspaceId,
  activeSurface,
  onSelectWorkspace,
  onSelectSurface,
  onOpenWorkspaceDetails,
  onSelectNode,
  open,
  onOpenChange: setOpen,
}: CommandPaletteProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  // Ranking runs on the server and costs a model call,
  // so the request trails the keystrokes rather than following each one.
  const debouncedQuery = useDebounced(query, 350)
  const { data: nodeData, isFetching: searching } = useNodeSearch(
    activeWorkspaceId ?? undefined,
    debouncedQuery,
  )
  const { data: skillData } = useSkills(activeWorkspaceId ?? undefined)
  const { rebuilding } = useEmbeddingProgress(open ? activeWorkspaceId : null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // Linear, Gmail, and GitHub-style `g`-chord navigation.
  // Press `g`, then within 1s press the second key,
  // e.g. `g s` for Settings.
  // Ignored while typing into a form so it does not hijack text input.
  const armedRef = useRef<number | null>(null)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey)
        return
      if (isTypingTarget(event.target))
        return

      const armed = armedRef.current != null && Date.now() - armedRef.current < CHORD_TIMEOUT_MS
      if (!armed) {
        if (event.key === 'g' || event.key === 'G') {
          event.preventDefault()
          armedRef.current = Date.now()
        }
        return
      }

      armedRef.current = null
      const target = chordSecondKey(event.key.toLowerCase())
      if (target === undefined)
        return
      event.preventDefault()
      if (target.kind === 'workspace-details') {
        if (!activeWorkspaceId)
          return
        onOpenWorkspaceDetails()
        return
      }
      if (target.surface !== 'settings' && !activeWorkspaceId)
        return
      onSelectSurface(target.surface)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeWorkspaceId, onSelectSurface, onOpenWorkspaceDetails])

  const skills = (skillData?.items ?? []).filter((s: SkillManifest) => !s.frontmatter.braid.hidden)
  const nodes = nodeData?.items ?? []
  // A rebuild leaves out any node whose vector no longer matches its text,
  // so the list is short for a reason worth naming.
  const nodesHeading = rebuilding
    ? t('shell.commandPalette.nodesRebuilding')
    : searching
      ? t('shell.commandPalette.nodesSearching')
      : t('shell.commandPalette.nodesTitle')

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t('shell.commandPalette.accessibilityTitle')} description={t('shell.commandPalette.accessibilityDescription')}>
      <CommandInput
        placeholder={t('shell.commandPalette.searchPlaceholder')}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{t('shell.commandPalette.noMatches')}</CommandEmpty>

        {nodes.length > 0 && (
          <CommandGroup heading={nodesHeading}>
            {nodes.map(node => (
              <CommandItem
                key={node.id}
                // cmdk scores an item by this value,
                // and the server already ranked these,
                // so carrying the query keeps every result.
                value={`${query} ${node.id}`}
                onSelect={() => {
                  onSelectNode(node.id)
                  setOpen(false)
                }}
              >
                <Network className="mr-2 size-3.5 text-muted-foreground" />
                <span className="truncate">{node.name}</span>
                <CommandShortcut className="uppercase tracking-wider">{node.type}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading={t('shell.commandPalette.goToTitle')}>
          {SURFACE_ITEMS.map(({ id, labelKey, Icon, shortcut }) => (
            <CommandItem
              key={id ?? 'home'}
              onSelect={() => {
                onSelectSurface(id)
                setOpen(false)
              }}
              disabled={(id !== 'settings' && !activeWorkspaceId) || activeSurface === id}
            >
              <Icon />
              <span>{t(labelKey)}</span>
              <CommandShortcut>{shortcut}</CommandShortcut>
            </CommandItem>
          ))}
          {activeWorkspaceId && (
            <CommandItem
              key="workspace-details"
              onSelect={() => {
                onOpenWorkspaceDetails()
                setOpen(false)
              }}
            >
              <Settings2 />
              <span>{t('shell.commandPalette.workspaceSettings')}</span>
              <CommandShortcut>G W</CommandShortcut>
            </CommandItem>
          )}
        </CommandGroup>

        {workspaces.length > 0 && (
          <CommandGroup heading={t('shell.commandPalette.workspacesTitle')}>
            {workspaces.map(ws => (
              <CommandItem
                key={ws.id}
                onSelect={() => {
                  onSelectWorkspace(ws.id)
                  setOpen(false)
                }}
                disabled={ws.id === activeWorkspaceId}
              >
                <WorkspaceSwatch workspaceId={ws.id} size="sm" />
                <span className="font-mono">{ws.id}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {skills.length > 0 && (
          <CommandGroup heading={t('shell.commandPalette.actionsTitle')}>
            {skills.map((skill: SkillManifest) => (
              <CommandItem
                key={skill.id}
                onSelect={() => {
                  onSelectSurface('actions')
                  setOpen(false)
                }}
              >
                <Sparkles />
                <span className="font-mono">
                  /
                  {skill.frontmatter.name}
                </span>
                <span className="ml-2 truncate text-xs text-muted-foreground">
                  {skill.frontmatter.description}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
