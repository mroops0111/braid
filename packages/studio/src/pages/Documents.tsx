import type { GeneratedView, Locale, NodeId, ViewFormDescriptor, ViewFormId, ViewKind } from '@braidhq/schema'
import { isViewSubject, localize } from '@braidhq/schema'
import { useQueryClient } from '@tanstack/react-query'
import { FileText, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderBlock } from '@/components/blocks/renderBlock'
import { EmptyState } from '@/components/EmptyState'
import { ListRow } from '@/components/ListRow'
import { SurfaceBand } from '@/components/SurfaceBand'
import { SurfaceLayout } from '@/components/SurfaceLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { EvidenceDetailContext, WorkspaceScopeContext } from '@/lib/blocks/WorkspaceScopeContext'
import { useLocale } from '@/lib/i18n'
import { queryKeys, useModelSnapshot, useOntology, useView, useViewKinds, useViews } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useRun } from '@/lib/useRun'
import { type DocumentGroup, documentsFrom, formOf, formsOf, matchesQuery, shelvesOf } from '@/lib/views'
import { WriteDocumentDialog } from './documents/WriteDocumentDialog'

export function DocumentsPage({ workspaceId, onSelectNode }: {
  workspaceId: string
  onSelectNode: (nodeId: NodeId) => void
}) {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const queryClient = useQueryClient()
  const views = useViews(workspaceId)
  const kinds = useViewKinds()
  const snapshot = useModelSnapshot(workspaceId)
  const ontology = useOntology(workspaceId)

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [writing, setWriting] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const run = useRun(workspaceId, runId)

  const groups = useMemo(() => documentsFrom(views.data?.items ?? []), [views.data])
  const nameById = useMemo(
    () => new Map((snapshot.data?.nodes ?? []).map(node => [node.id as string, node.name])),
    [snapshot.data],
  )

  // A document is only on disk once the run that wrote it has finished,
  // so the list is asked again then rather than on every event.
  useEffect(() => {
    if (runId === null || run?.phase === 'streaming')
      return
    setRunId(null)
    void queryClient.invalidateQueries({ queryKey: queryKeys.views(workspaceId) })
    if (openPath !== null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.view(workspaceId, openPath) })
  }, [run?.phase, runId, workspaceId, openPath, queryClient])

  const open = groups.flatMap(group => group.views).find(view => view.path === openPath)
  const openForm = open === undefined ? undefined : formOf(kinds.data?.items ?? [], open)

  // What any registered kind will take as a subject,
  // which is what decides whether this workspace can hold a document.
  const writable = useMemo(
    () => (kinds.data?.items ?? []).some(kind =>
      (ontology.data?.nodeTypes ?? []).some(type =>
        isViewSubject(kind.subjects, type)
        && (snapshot.data?.nodes ?? []).some(node => node.type === type.id))),
    [kinds.data, ontology.data, snapshot.data],
  )

  // Shelved by what kind of thing each document is about,
  // which the ontology already says,
  // so nobody files anything by hand to stop this being one long column.
  const shelves = useMemo(() => {
    const nodeById = new Map((snapshot.data?.nodes ?? []).map(node => [node.id as string, node]))
    const labelByType = new Map(
      (ontology.data?.nodeTypes ?? []).map(type => [type.id as string, localize(type.label, locale)]),
    )
    const kindOf = (subject: string) => {
      const type = nodeById.get(subject)?.type
      return type === undefined ? undefined : { id: type as string, label: labelByType.get(type) ?? type }
    }
    const shown = groups.filter(group =>
      matchesQuery(group, nameById.get(group.subject) ?? group.subject, query))
    return shelvesOf(shown, kindOf)
  }, [groups, query, nameById, snapshot.data, ontology.data, locale])

  async function write(kind: ViewKind, form: ViewFormId, subject: NodeId, asked: Record<string, string>): Promise<void> {
    const started = await api.generateView(workspaceId, { kind, form, subject, asked })
    runStore.loadRun(workspaceId, started.runId, `${kind}:${form}`)
    setRunId(started.runId)
    setOpenPath(null)
    setWriting(false)
  }

  const busy = runId !== null

  // Three situations read as one blank column,
  // and each has a different next move.
  // Build the graph, write the first document, or widen what was typed.
  const empty = !writable
    ? { title: t('documents.noSubjects.title'), description: t('documents.noSubjects.description') }
    : groups.length === 0
      ? { title: t('documents.empty.title'), description: t('documents.empty.description') }
      : { title: t('documents.noMatches.title'), description: t('documents.noMatches.description') }

  return (
    <div className="flex h-full flex-col">
      <SurfaceLayout
        list={(
          <>
            <SurfaceBand
              trailing={(
                <Button
                  variant="ghost"
                  size="xs"
                  className="[&_svg]:size-3"
                  disabled={busy || !writable}
                  onClick={() => setWriting(true)}
                >
                  <Plus />
                  {busy ? t('documents.writing') : t('documents.write')}
                </Button>
              )}
            >
              <Input
                value={query}
                placeholder={t('documents.filterPlaceholder')}
                className="h-7 w-40 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                onChange={event => setQuery(event.target.value)}
              />
            </SurfaceBand>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {shelves.map(shelf => (
                <section key={shelf.typeId}>
                  {shelves.length > 1 && (
                    <h3 className="sticky top-0 z-10 bg-background/95 px-4 py-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
                      {shelf.label}
                    </h3>
                  )}
                  <ul>
                    {shelf.groups.map(group => (
                      <DocumentRow
                        key={`${group.kind}/${group.subject}`}
                        group={group}
                        name={nameById.get(group.subject) ?? group.subject}
                        forms={formsOf(kinds.data?.items ?? [], group.kind)}
                        openPath={openPath}
                        onOpen={setOpenPath}
                        locale={locale}
                        staleLabel={t('documents.stale')}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            {shelves.length === 0 && (
              <div className="flex-1">
                <EmptyState icon={FileText} title={empty.title} description={empty.description} />
              </div>
            )}
          </>
        )}
      >
        {open === undefined
          ? (
              <EmptyState
                icon={FileText}
                title={t('documents.noSelection.title')}
                description={t('documents.noSelection.description')}
              />
            )
          : (
              <DocumentReader
                workspaceId={workspaceId}
                view={open}
                form={openForm}
                title={nameById.get(open.subject) ?? open.subject}
                locale={locale}
                busy={busy}
                onSelectNode={onSelectNode}
                onRegenerate={() => write(open.kind, open.form, open.subject, {})}
              />
            )}
      </SurfaceLayout>

      {writing && (
        <WriteDocumentDialog
          kinds={kinds.data?.items ?? []}
          nodes={snapshot.data?.nodes ?? []}
          nodeTypes={ontology.data?.nodeTypes ?? []}
          onClose={() => setWriting(false)}
          onWrite={write}
        />
      )}
    </div>
  )
}

function DocumentRow({ group, name, forms, openPath, onOpen, locale, staleLabel }: {
  group: DocumentGroup
  name: string
  forms: readonly ViewFormDescriptor[]
  openPath: string | null
  onOpen: (path: string) => void
  locale: Locale
  staleLabel: string
}) {
  const active = group.views.some(view => view.path === openPath)
  const [first] = group.views
  if (first === undefined)
    return null

  return (
    <ListRow active={active} onClick={() => onOpen((group.views.find(v => v.path === openPath) ?? first).path)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-foreground">{name}</span>
          {group.stale && (
            <Badge variant="outline" className="shrink-0 border-amber-500/30 bg-amber-500/5 text-2xs text-amber-600 dark:text-amber-400">
              {staleLabel}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {group.views.map(view => (
            <button
              key={view.path}
              type="button"
              className={
                view.path === openPath
                  ? 'rounded-sm bg-primary/20 px-1.5 py-0.5 text-2xs text-foreground'
                  : 'rounded-sm px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground'
              }
              onClick={(event) => {
                event.stopPropagation()
                onOpen(view.path)
              }}
            >
              {labelOf(forms, view, locale)}
            </button>
          ))}
        </div>
      </div>
    </ListRow>
  )
}

function DocumentReader({ workspaceId, view, form, title, locale, busy, onSelectNode, onRegenerate }: {
  workspaceId: string
  view: GeneratedView
  form: ViewFormDescriptor | undefined
  title: string
  locale: Locale
  busy: boolean
  onSelectNode: (nodeId: NodeId) => void
  onRegenerate: () => void
}) {
  const { t } = useTranslation()
  const blocks = useView(workspaceId, view.path).data?.blocks

  return (
    <>
      <SurfaceBand
        title={form === undefined ? view.form : localize(form.label, locale)}
        trailing={(
          <Button size="xs" variant="ghost" className="[&_svg]:size-3" disabled={busy} onClick={onRegenerate}>
            <RefreshCw />
            {busy ? t('documents.writing') : t('documents.regenerate')}
          </Button>
        )}
      />
      {view.stale && (
        // The tone every warning strip in the app already wears,
        // rather than a louder one of its own.
        // Being out of date is worth saying once, not worth shouting.
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 text-xs">
          <TriangleAlert className="size-3 text-amber-600 dark:text-amber-400" />
          <span className="font-medium text-foreground">{t('documents.stale')}</span>
          <span className="text-muted-foreground">{t('documents.staleNotice')}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
        {/* The same scope a run's blocks are drawn in, so a block naming
            node ids resolves them against this workspace's graph rather
            than reporting that it holds none of them. */}
        <WorkspaceScopeContext value={workspaceId}>
          <EvidenceDetailContext value="full">
            <div className="flex flex-col gap-4">
              <header className="border-b border-border pb-4">
                <h1 className="text-base font-medium text-foreground">{title}</h1>
                <button
                  type="button"
                  className="mt-1 font-mono text-2xs text-muted-foreground hover:text-foreground"
                  onClick={() => onSelectNode(view.subject)}
                >
                  {view.subject}
                </button>
              </header>
              {/* Nothing while it is still being fetched. A line saying so
                  would flash and leave, which reads as a fault rather than
                  as the wait it is. */}
              {(blocks ?? []).map(entry => (
                <div key={entry.id}>{renderBlock(entry.block)}</div>
              ))}
            </div>
          </EvidenceDetailContext>
        </WorkspaceScopeContext>
      </div>
    </>
  )
}

function labelOf(
  forms: readonly ViewFormDescriptor[],
  view: GeneratedView,
  locale: Locale,
): string {
  const form = forms.find(one => one.id === view.form)
  return form === undefined ? view.form : localize(form.label, locale)
}
