import type { SkillManifest, Workspace } from '@telos/schema'
import { Boxes, FolderGit2, GitBranch, History, Inbox, Sparkles } from 'lucide-react'
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

interface CommandPaletteProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeTab: TabKey
  onSelectWorkspace: (id: string) => void
  onSelectTab: (tab: TabKey) => void
}

export type TabKey = 'skills' | 'graph' | 'proposals' | 'runs'

const TAB_ITEMS: { id: TabKey, label: string, Icon: typeof Sparkles }[] = [
  { id: 'skills', label: 'Skills', Icon: Sparkles },
  { id: 'graph', label: 'Graph', Icon: GitBranch },
  { id: 'proposals', label: 'Proposals', Icon: Inbox },
  { id: 'runs', label: 'Runs', Icon: History },
]

export function CommandPalette({
  workspaces,
  activeWorkspaceId,
  activeTab,
  onSelectWorkspace,
  onSelectTab,
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

  const skills = skillData?.items ?? []

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Go To">
          {TAB_ITEMS.map(({ id, label, Icon }) => (
            <CommandItem
              key={id}
              onSelect={() => {
                onSelectTab(id)
                setOpen(false)
              }}
              disabled={!activeWorkspaceId || activeTab === id}
            >
              <Icon />
              <span>{label}</span>
              <CommandShortcut>{shortcutFor(id)}</CommandShortcut>
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
                <FolderGit2 />
                <span className="font-mono">{ws.id}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {skills.length > 0 && (
          <CommandGroup heading="Skills">
            {skills.map((skill: SkillManifest) => (
              <CommandItem
                key={skill.id}
                onSelect={() => {
                  onSelectTab('skills')
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

function shortcutFor(tab: TabKey): string {
  switch (tab) {
    case 'skills': return 'g s'
    case 'graph': return 'g g'
    case 'proposals': return 'g p'
    case 'runs': return 'g r'
  }
}
