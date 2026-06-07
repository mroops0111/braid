import type { SkillManifest, Workspace } from '@braidhq/schema'
import { Boxes, ClipboardCheck, GitGraph, HelpCircle, Network, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { useSkills } from '@/lib/queries'
import { WorkspaceSwatch } from './WorkspaceSwatch'

interface CommandPaletteProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeSurface: Surface | null
  onSelectWorkspace: (id: string) => void
  onSelectSurface: (surface: Surface | null) => void
  onOpenWorkspaceDetails: () => void
}

export type Surface = 'actions' | 'batch' | 'clarify' | 'history' | 'proposals' | 'settings'

interface SurfaceItem {
  id: Surface | null
  label: string
  Icon: typeof Sparkles
  shortcut: string
}

type ChordTarget = { kind: 'surface', surface: Surface | null } | { kind: 'workspace-details' }

function chordSecondKey(key: string): ChordTarget | undefined {
  switch (key) {
    case 'g': return { kind: 'surface', surface: null }
    case 'a': return { kind: 'surface', surface: 'actions' }
    case 'c': return { kind: 'surface', surface: 'clarify' }
    case 'p': return { kind: 'surface', surface: 'proposals' }
    case 'h': return { kind: 'surface', surface: 'history' }
    case 's': return { kind: 'surface', surface: 'settings' }
    case 'w': return { kind: 'workspace-details' }
    default: return undefined
  }
}

const SURFACE_ITEMS: SurfaceItem[] = [
  { id: null, label: 'Graph (home)', Icon: Network, shortcut: 'G G' },
  { id: 'actions', label: 'Actions', Icon: Sparkles, shortcut: 'G A' },
  { id: 'clarify', label: 'Clarify', Icon: HelpCircle, shortcut: 'G C' },
  { id: 'proposals', label: 'Proposals', Icon: ClipboardCheck, shortcut: 'G P' },
  { id: 'history', label: 'History', Icon: GitGraph, shortcut: 'G H' },
  { id: 'settings', label: 'Settings', Icon: SlidersHorizontal, shortcut: 'G S' },
]

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
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const { data: skillData } = useSkills(activeWorkspaceId ?? undefined)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setOpen(current => !current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Linear / Gmail / GitHub-style `g`-chord navigation. Press `g`, then
  // within 1s press the second key (e.g. `g s` for Settings). Ignored
  // while typing into a form so it doesn't hijack normal text input.
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

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Go To">
          {SURFACE_ITEMS.map(({ id, label, Icon, shortcut }) => (
            <CommandItem
              key={id ?? 'home'}
              onSelect={() => {
                onSelectSurface(id)
                setOpen(false)
              }}
              disabled={(id !== 'settings' && !activeWorkspaceId) || activeSurface === id}
            >
              <Icon />
              <span>{label}</span>
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
              <span>Workspace Settings</span>
              <CommandShortcut>G W</CommandShortcut>
            </CommandItem>
          )}
        </CommandGroup>

        {workspaces.length > 0 && (
          <CommandGroup heading="Workspaces">
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
          <CommandGroup heading="Actions">
            {skills.map((skill: SkillManifest) => (
              <CommandItem
                key={skill.id}
                onSelect={() => {
                  onSelectSurface('actions')
                  setOpen(false)
                }}
              >
                <Boxes />
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
