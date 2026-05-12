import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium font-mono',
  {
    variants: {
      variant: {
        default: 'bg-zinc-800 text-zinc-300',
        pending: 'bg-amber-950 text-amber-300 border border-amber-900',
        applied: 'bg-emerald-950 text-emerald-300 border border-emerald-900',
        rejected: 'bg-zinc-800 text-zinc-500',
        draft: 'bg-zinc-800 text-zinc-400',
        unclear: 'bg-yellow-900/60 text-yellow-300',
        completed: 'bg-emerald-900/40 text-emerald-300',
        deprecated: 'bg-zinc-900 text-zinc-600 line-through',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
  VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
