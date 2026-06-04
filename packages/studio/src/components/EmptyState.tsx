import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted/40">
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <div className="max-w-md">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground [text-wrap:pretty]">{description}</p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
