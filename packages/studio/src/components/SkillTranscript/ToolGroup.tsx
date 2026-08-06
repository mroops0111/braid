import type { PairedCall } from './groupTranscript'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ToolCallRow } from './ToolCallRow'

interface ToolGroupProps {
  calls: PairedCall[]
}

export function ToolGroup({ calls }: ToolGroupProps) {
  const { t } = useTranslation()
  if (calls.length === 1)
    return <ToolCallRow paired={calls[0]!} />

  const failed = calls.filter(c => c.result?.isError).length
  return (
    <details className="group my-1 rounded border border-border/40 bg-muted/20 open:bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 marker:hidden hover:bg-accent/40">
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90" />
        <span className="text-amber-400">
          {t('transcript.toolGroup.toolCallCount', { count: calls.length })}
        </span>
        {failed > 0 && (
          <span className="text-red-400">
            ·
            {' '}
            {t('transcript.toolGroup.failedCount', { count: failed })}
          </span>
        )}
      </summary>
      <div className="space-y-0.5 border-t border-border/40 px-2 py-1.5">
        {calls.map((paired, idx) => (
          <ToolCallRow key={paired.call.toolCallId ?? idx} paired={paired} />
        ))}
      </div>
    </details>
  )
}
