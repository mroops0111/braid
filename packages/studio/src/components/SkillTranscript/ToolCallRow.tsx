import type { PairedCall } from './groupTranscript'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatArgsPreview } from './formatArgsPreview'

interface ToolCallRowProps {
  paired: PairedCall
}

export function ToolCallRow({ paired }: ToolCallRowProps) {
  const { call, result } = paired
  const isError = result?.isError === true
  const compact = formatArgsPreview(call.args)
  const argsJson = call.args === null ? '' : JSON.stringify(call.args, null, 2)
  return (
    <details
      className={cn(
        'group/row my-0.5 rounded border bg-background/50 open:bg-background/80',
        isError ? 'border-red-500/40' : 'border-border/40',
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 marker:hidden hover:bg-accent/40">
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-open/row:rotate-90" />
        <span className={cn('font-medium', isError ? 'text-red-400' : 'text-amber-400')}>{call.tool}</span>
        {compact && <span className="truncate text-muted-foreground/80">{compact}</span>}
        {isError && (
          <span className="ml-auto rounded bg-red-500/15 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider text-red-400">
            error
          </span>
        )}
      </summary>
      <div className="border-t border-border/40 px-2 py-1.5">
        {argsJson && (
          <>
            <SectionLabel>Args</SectionLabel>
            <pre className="overflow-x-auto text-2xs leading-relaxed text-muted-foreground">{argsJson}</pre>
          </>
        )}
        {result && (
          <>
            <SectionLabel className="mt-2">{isError ? 'Error output' : 'Result'}</SectionLabel>
            <pre
              className={cn(
                'overflow-x-auto whitespace-pre-wrap text-2xs leading-relaxed',
                isError ? 'text-red-300' : 'text-muted-foreground',
              )}
            >
              {result.output || '(empty)'}
            </pre>
          </>
        )}
      </div>
    </details>
  )
}

function SectionLabel({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={cn('text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70', className)}>
      {children}
    </div>
  )
}
