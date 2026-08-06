import { Settings as SettingsIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListRow } from '@/components/ListRow'
import { UserPicker } from '@/components/UserPicker'
import { useWorkspacePolicy } from '@/policy'
import { AboutTab } from './settings/AboutTab'
import { AppearanceTab } from './settings/AppearanceTab'
import { ServersTab } from './settings/ServersTab'
import { UsersTab } from './settings/UsersTab'

type SettingsTab = 'servers' | 'users' | 'appearance' | 'about'

export function SettingsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>('servers')
  const { isServerAdmin: isAdmin } = useWorkspacePolicy(null)
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4 text-sm">
        <div className="flex items-center gap-1.5">
          <SettingsIcon className="size-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground">{t('admin.title')}</span>
        </div>
        <UserPicker />
      </header>
      <div className="flex flex-1 overflow-hidden">
        <ul className="flex w-60 shrink-0 flex-col border-r border-border">
          <SettingsNavRow label={t('admin.navigation.servers')} value="servers" active={tab === 'servers'} onClick={setTab} />
          {isAdmin && (
            <SettingsNavRow label={t('admin.navigation.users')} value="users" active={tab === 'users'} onClick={setTab} />
          )}
          <SettingsNavRow label={t('admin.navigation.appearance')} value="appearance" active={tab === 'appearance'} onClick={setTab} />
          <SettingsNavRow label={t('admin.navigation.about')} value="about" active={tab === 'about'} onClick={setTab} />
        </ul>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-2xl px-6 py-6">
            {tab === 'servers' && <ServersTab />}
            {tab === 'users' && isAdmin && <UsersTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsNavRow({ label, value, active, onClick }: {
  label: string
  value: SettingsTab
  active: boolean
  onClick: (next: SettingsTab) => void
}) {
  return (
    <ListRow active={active} onClick={() => onClick(value)}>
      <span className="text-sm">{label}</span>
    </ListRow>
  )
}
