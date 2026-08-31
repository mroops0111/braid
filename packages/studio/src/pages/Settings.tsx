import { Settings as SettingsIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListRow } from '@/components/ListRow'
import { UserPicker } from '@/components/UserPicker'
import { isDesktop } from '@/lib/platform'
import { useWorkspacePolicy } from '@/policy'
import { AboutTab } from './settings/AboutTab'
import { AppearanceTab } from './settings/AppearanceTab'
import { ServersTab } from './settings/ServersTab'
import { UsersTab } from './settings/UsersTab'

type SettingsTab = 'servers' | 'users' | 'appearance' | 'about'

// i18next types the key, so the map is written out rather than derived.
const TAB_LABEL_KEYS = {
  servers: 'admin.navigation.servers',
  users: 'admin.navigation.users',
  appearance: 'admin.navigation.appearance',
  about: 'admin.navigation.about',
} as const

/**
 * The tabs a given viewer may open, in nav order.
 *
 * Rendering the nav and the panel from one list keeps them from drifting,
 * so a tab can never appear without the panel behind it.
 */
function visibleTabs(viewer: { canManageServers: boolean, isAdmin: boolean }): readonly SettingsTab[] {
  return [
    ...(viewer.canManageServers ? ['servers' as const] : []),
    ...(viewer.isAdmin ? ['users' as const] : []),
    'appearance' as const,
    'about' as const,
  ]
}

export function SettingsPage() {
  const { t } = useTranslation()
  // A page served by a server speaks only to that server,
  // so the server list is a desktop affordance.
  // In a browser the same need is met by a new tab.
  const canManageServers = isDesktop()
  const { isServerAdmin: isAdmin, loading: policyLoading } = useWorkspacePolicy(null)
  const [chosen, setChosen] = useState<SettingsTab | null>(null)
  const tabs = visibleTabs({ canManageServers, isAdmin })
  // Landing on the first tab keeps the default aligned with the nav,
  // rather than pinning one that a given viewer may not even see.
  // A choice that outlives the viewer's access falls back the same way.
  const tab = chosen !== null && tabs.includes(chosen) ? chosen : tabs[0]!
  // The admin tabs hang on `/users/me`,
  // so rendering before it lands would widen the nav under the pointer.
  if (policyLoading)
    return <div className="flex h-full flex-col" />
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
          {tabs.map(value => (
            <SettingsNavRow
              key={value}
              label={t(TAB_LABEL_KEYS[value])}
              value={value}
              active={tab === value}
              onClick={setChosen}
            />
          ))}
        </ul>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-2xl px-6 py-6">
            {tab === 'servers' && <ServersTab />}
            {tab === 'users' && <UsersTab />}
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
