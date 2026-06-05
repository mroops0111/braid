import { Globe, Info, Settings as SettingsIcon } from 'lucide-react'
import { useState } from 'react'
import { ListRow } from '@/components/ListRow'
import { cn } from '@/lib/utils'
import { AboutTab } from './settings/AboutTab'
import { ServersTab } from './settings/ServersTab'

type SettingsTab = 'servers' | 'about'

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('servers')
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-4 text-sm">
        <SettingsIcon className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-foreground">Settings</span>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-60 shrink-0 flex-col gap-px border-r border-border bg-card/40 p-2">
          <SettingsNavRow icon={Globe} label="Servers" value="servers" active={tab === 'servers'} onClick={setTab} />
          <SettingsNavRow icon={Info} label="About" value="about" active={tab === 'about'} onClick={setTab} />
        </nav>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-2xl px-6 py-6">
            {tab === 'servers' && <ServersTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsNavRow({ icon: Icon, label, value, active, onClick }: {
  icon: typeof Globe
  label: string
  value: SettingsTab
  active: boolean
  onClick: (next: SettingsTab) => void
}) {
  return (
    <ListRow variant="sidebar" active={active} onClick={() => onClick(value)}>
      <Icon className={cn('size-3.5 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} />
      <span className="text-sm">{label}</span>
    </ListRow>
  )
}
