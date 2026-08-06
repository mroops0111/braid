import type { LucideIcon } from 'lucide-react'
import { Bug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GithubIcon } from '@/components/icons/GithubIcon'

const REPOSITORY_URL = 'https://github.com/mroops0111/braid'

export function AboutTab() {
  const { t } = useTranslation()
  const version = import.meta.env.VITE_BRAID_VERSION ?? 'dev'
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.about.title')}</h2>
        <p className="mt-2 text-sm font-medium text-foreground">Braid</p>
        <p className="font-mono text-2xs text-muted-foreground">{version}</p>
      </div>
      <div className="max-w-2xl space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p>{t('admin.about.tagline')}</p>
        <p>{t('admin.about.description')}</p>
      </div>
      <div className="flex flex-col gap-1">
        <AboutLink href={REPOSITORY_URL} icon={GithubIcon} label={t('admin.about.githubRepository')} />
        <AboutLink href={`${REPOSITORY_URL}/issues`} icon={Bug} label={t('admin.about.reportAnIssue')} />
      </div>
      <p className="text-2xs text-muted-foreground">{t('admin.about.license')}</p>
    </div>
  )
}

function AboutLink({ href, icon: Icon, label }: { href: string, icon: LucideIcon, label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex w-fit items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="size-3.5 text-muted-foreground" />
      {label}
    </a>
  )
}
