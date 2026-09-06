import type { BlockRef } from '@braidhq/schema'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, FileText, ShieldQuestion } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useWorkspaceScope } from '@/lib/blocks/WorkspaceScopeContext'
import { cn } from '@/lib/utils'

function formatLocation(ref: BlockRef): string {
  const { uri, startLine, endLine, anchor } = ref.reference.location
  if (anchor)
    return `${uri}#${anchor}`
  if (startLine === undefined)
    return uri
  return endLine !== undefined && endLine !== startLine
    ? `${uri}:${startLine}-${endLine}`
    : `${uri}:${startLine}`
}

/**
 * A link to the canonical copy, when the source's loader can address one.
 *
 * The inline text is the local mirror we already have. This is the PRD in the
 * browser and the code in the hosted repository, which is where a reader acts
 * on evidence rather than just reads it. Hosted targets forbid framing, and
 * the reader's own session lives in their browser, so it opens in a new tab.
 */
function CanonicalLink({ reference }: { reference: BlockRef['reference'] }) {
  const { t } = useTranslation()
  const workspaceId = useWorkspaceScope()
  // Resolved when the reader points at it, never on render. One answer carries
  // dozens of references, and resolving every one on mount saturates the
  // browser's per-host connection pool, which stalls every later request.
  const [wanted, setWanted] = useState(false)
  const { data } = useQuery({
    queryKey: ['source-ref-url', workspaceId, reference.sourceId, reference.location],
    queryFn: () => api.resolveSourceRefUrl(workspaceId!, reference.sourceId, reference.location),
    enabled: wanted && workspaceId !== null,
    staleTime: 5 * 60 * 1000,
  })

  // Resolved to nothing means this source has no host, so there is no link.
  if (wanted && data !== undefined && data.url === null)
    return null

  const shared = 'ml-1 inline-flex text-muted-foreground/60 transition-colors duration-150 hover:text-primary'
  const want = (): void => setWanted(true)

  return data?.url
    ? (
        <a href={data.url} target="_blank" rel="noreferrer" title={t('blocks.evidence.openCanonical')} className={shared}>
          <ExternalLink className="size-2.5" />
        </a>
      )
    : (
        <span onMouseEnter={want} onFocus={want} title={t('blocks.evidence.openCanonical')} className={shared}>
          <ExternalLink className="size-2.5" />
        </span>
      )
}

/**
 * The cited lines from the local mirror, read in place.
 *
 * The canonical link leaves for the host, which is right when acting on
 * evidence and wrong when merely reading it. This is the copy already on
 * disk, and it is the only view a source with no host can offer at all.
 */
/**
 * Whether the mirror still says what was cited.
 *
 * A reference records where something was found at extraction time, so the
 * lines it names can hold something else by the time anyone reads the answer.
 * Comparing the stored snippet against the lines now there catches exactly
 * that, and it is the difference between evidence and a stale pointer.
 */
function snippetHasDrifted(snippet: string, lines: readonly string[], from: number, to: number): boolean {
  const cited = lines.slice(from, to + 1).join('\n')
  const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim()
  const expected = normalise(snippet)
  if (expected.length === 0)
    return false
  return !normalise(cited).includes(expected)
}

function InlineExcerpt({ reference }: { reference: BlockRef['reference'] }) {
  const { t } = useTranslation()
  const workspaceId = useWorkspaceScope()
  const { data, isError } = useQuery({
    queryKey: ['source-excerpt', workspaceId, reference.sourceId, reference.location],
    queryFn: () => api.readSourceExcerpt(workspaceId!, reference.sourceId, reference.location),
    enabled: workspaceId !== null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  if (isError)
    return <p className="mt-1 text-2xs text-muted-foreground/70">{t('blocks.evidence.excerptMissing')}</p>
  if (!data)
    return null

  const drifted = reference.snippet !== undefined
    && snippetHasDrifted(reference.snippet, data.lines, data.highlightFrom, data.highlightTo)

  return (
    <>
      {drifted && (
        <p className="mt-1 flex items-start gap-1 text-2xs text-amber-400">
          <AlertTriangle className="mt-0.5 size-2.5 shrink-0" />
          {t('blocks.evidence.snippetDrifted')}
        </p>
      )}
      <pre className="mt-1 overflow-x-auto rounded-sm border border-border bg-muted/30 py-1.5 font-mono text-2xs leading-relaxed">
        {data.lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              'flex gap-2 px-2',
              index >= data.highlightFrom && index <= data.highlightTo && 'bg-amber-500/10',
            )}
          >
            <span className="shrink-0 select-none text-right text-muted-foreground/40 tabular-nums" style={{ minWidth: '2.5em' }}>
              {data.firstLine + index}
            </span>
            <span className="whitespace-pre text-muted-foreground">{line || ' '}</span>
          </div>
        ))}
      </pre>
    </>
  )
}

/**
 * A reference the run opened itself reads as unverified,
 * because nothing in the graph vouches for it yet.
 */
function EvidenceRow({ ref: entry }: { ref: BlockRef }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const unverified = entry.provenance === 'agent-read'
  const readable = entry.reference.location.startLine !== undefined

  return (
    <li className="flex items-start gap-1.5">
      {unverified
        ? <ShieldQuestion className="mt-0.5 size-2.5 shrink-0 text-amber-400" />
        : <FileText className="mt-0.5 size-2.5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1">
          {readable
            ? (
                <button
                  type="button"
                  onClick={() => setOpen(value => !value)}
                  className="inline-flex items-center gap-0.5 font-mono text-2xs break-all text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  {open ? <ChevronDown className="size-2.5 shrink-0" /> : <ChevronRight className="size-2.5 shrink-0" />}
                  {formatLocation(entry)}
                </button>
              )
            : <span className="font-mono text-2xs break-all text-muted-foreground">{formatLocation(entry)}</span>}
          <CanonicalLink reference={entry.reference} />
          {unverified && <span className="text-2xs text-amber-400">{t('blocks.evidence.unverified')}</span>}
        </span>
        {!open && entry.reference.snippet && (
          <p className="mt-0.5 border-l-2 border-border pl-2 font-mono text-2xs text-muted-foreground/80">
            {entry.reference.snippet}
          </p>
        )}
        {open && <InlineExcerpt reference={entry.reference} />}
      </div>
    </li>
  )
}

export function EvidenceRefs({ refs, className }: { refs: readonly BlockRef[], className?: string }) {
  if (refs.length === 0)
    return null
  return (
    <ul className={cn('space-y-1', className)}>
      {refs.map((entry, index) => (
        <EvidenceRow key={`${entry.reference.sourceId}-${index}`} ref={entry} />
      ))}
    </ul>
  )
}
