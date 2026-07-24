import type { LucideIcon } from 'lucide-react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

export function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="space-y-3">
      <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Theme</h2>
      <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
        <ThemeOption icon={Sun} label="Light" active={theme === 'light'} onClick={() => setTheme('light')} />
        <ThemeOption icon={Moon} label="Dark" active={theme === 'dark'} onClick={() => setTheme('dark')} />
      </div>
      <p className="text-2xs text-muted-foreground">Applies immediately and is remembered on this device.</p>
    </div>
  )
}

function ThemeOption({ icon: Icon, label, active, onClick }: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}
