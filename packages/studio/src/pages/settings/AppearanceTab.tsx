import type { LucideIcon } from 'lucide-react'
import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isLocale, SUPPORTED_LOCALES, useLocale } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

export function AppearanceTab() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { locale, setLocale } = useLocale()
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('settings.appearance.themeTitle')}
        </h2>
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
          <Segment icon={Sun} label={t('settings.appearance.themeLight')} active={theme === 'light'} onClick={() => setTheme('light')} />
          <Segment icon={Moon} label={t('settings.appearance.themeDark')} active={theme === 'dark'} onClick={() => setTheme('dark')} />
        </div>
        <p className="text-2xs text-muted-foreground">{t('settings.appearance.deviceHint')}</p>
      </div>

      <div className="space-y-3">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('settings.appearance.languageTitle')}
        </h2>
        <Select value={locale} onValueChange={value => isLocale(value) && setLocale(value)}>
          <SelectTrigger size="sm" className="w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LOCALES.map(option => (
              <SelectItem key={option.code} value={option.code}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-2xs text-muted-foreground">{t('settings.appearance.deviceHint')}</p>
      </div>
    </div>
  )
}

function Segment({ icon: Icon, label, active, onClick }: {
  icon?: LucideIcon
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
      {Icon && <Icon className="size-3.5" />}
      {label}
    </button>
  )
}
