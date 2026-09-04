import type { McpEndpointStatus } from '@/lib/api'
import { Check, Copy, Plug } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useMcpEndpoint } from '@/lib/queries'

// Three tones rather than five, since a reader acts on serving, broken, or
// absent. Why it is absent is the hint's job, not the badge's.
const TONE = {
  ready: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  unreachable: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  off: 'bg-muted text-muted-foreground border-border',
} as const

const HINT_KEYS = {
  ready: 'admin.mcp.readyHint',
  unreachable: 'admin.mcp.unreachableHint',
  turnedOff: 'admin.mcp.turnedOffHint',
  noAuthorizationServer: 'admin.mcp.noAuthorizationServerHint',
  incomplete: 'admin.mcp.incompleteHint',
} as const

function badgeFor(state: McpEndpointStatus['state']) {
  if (state === 'ready')
    return { tone: TONE.ready, labelKey: 'admin.mcp.stateReady' } as const
  if (state === 'unreachable')
    return { tone: TONE.unreachable, labelKey: 'admin.mcp.stateUnreachable' } as const
  return { tone: TONE.off, labelKey: 'admin.mcp.stateOff' } as const
}

export function McpEndpointCard() {
  const { t } = useTranslation()
  const { data: status } = useMcpEndpoint()
  // A server that reports nothing predates the endpoint, so say nothing
  // rather than claiming it is off.
  if (!status)
    return null
  const badge = badgeFor(status.state)
  return (
    <section className="space-y-3 rounded-md border border-border bg-card/40 p-4">
      <div className="flex items-center gap-2">
        <Plug className="size-3.5 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">{t('admin.mcp.title')}</h2>
        <span className={`rounded-sm border px-1.5 py-0.5 text-2xs ${badge.tone}`}>
          {t(badge.labelKey)}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('admin.mcp.description')}</p>
      {status.endpointUrl && <EndpointRow url={status.endpointUrl} />}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(HINT_KEYS[status.state])}
        {status.missing.length > 0 && (
          <span className="font-mono text-2xs text-foreground/80">
            {' '}
            {status.missing.join(', ')}
          </span>
        )}
      </p>
    </section>
  )
}

function EndpointRow({ url }: { url: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs uppercase tracking-wider text-muted-foreground">
        {t('admin.mcp.endpointLabel')}
      </span>
      <code className="flex-1 truncate rounded-sm bg-muted/50 px-2 py-1 font-mono text-2xs text-foreground">
        {url}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="[&_svg]:size-3"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? t('admin.mcp.copied') : t('admin.mcp.copy')}
      </Button>
    </div>
  )
}
