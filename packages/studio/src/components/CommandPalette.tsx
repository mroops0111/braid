import type { SkillManifest, Workspace } from '@braidhq/schema'
import { Boxes, GitCommit, HelpCircle, Home, Inbox, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
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
}

export type Surface = 'actions' | 'clarify' | 'history' | 'proposals'

interface SurfaceItem {
  id: Surface | null
  label: string
  Icon: typeof Sparkles
  shortcut: string
}

function chordToSurface(key: string): Surface | null | undefined {
  switch (key) {
    case '0': return null
    case '1': return 'actions'
    case '2': return 'clarify'
    case '3': return 'proposals'
    case '4': return 'history'
    default: return undefined
  }
}

const SURFACE_ITEMS: SurfaceItem[] = [
  { id: null, label: 'Graph (home)', Icon: Home, shortcut: '⌘0' },
  { id: 'actions', label: 'Actions', Icon: Sparkles, shortcut: '⌘1' },
  { id: 'clarify', label: 'Clarify', Icon: HelpCircle, shortcut: '⌘2' },
  { id: 'proposals', label: 'Proposals', Icon: Inbox, shortcut: '⌘3' },
  { id: 'history', label: 'History', Icon: GitCommit, shortcut: '⌘4' },
]

export function CommandPalette({
  workspaces,
  activeWorkspaceId,
  activeSurface,
  onSelectWorkspace,
  onSelectSurface,
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

  // Numeric chords switch surfaces from anywhere. ⌘0 returns to the
  // graph home; ⌘1/2/3 jump straight to a secondary surface. Only
  // claims the chord when a workspace is active so the palette /
  // browser defaults stay available on the welcome screen.
  useEffect(() => {
    if (!activeWorkspaceId)
      return
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey))
        return
      const next = chordToSurface(event.key)
      if (next === undefined)
        return
      event.preventDefault()
      onSelectSurface(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeWorkspaceId, onSelectSurface])

  const skills = skillData?.items ?? []

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
              disabled={!activeWorkspaceId || activeSurface === id}
            >
              <Icon />
              <span>{label}</span>
              <CommandShortcut>{shortcut}</CommandShortcut>
            </CommandItem>
          ))}
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
