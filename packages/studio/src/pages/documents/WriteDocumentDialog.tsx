import type { GraphNode, NodeId, NodeTypeDescriptor, ViewFormDescriptor, ViewFormId, ViewKind, ViewKindDescriptor, ViewSubjects } from '@braidhq/schema'
import { isViewSubject, localize } from '@braidhq/schema'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** A form and the kind it belongs to, since a reader picks one of all of them. */
interface Offered {
  readonly kind: ViewKind
  readonly subjects: ViewSubjects
  readonly form: ViewFormDescriptor
}

/**
 * The form comes first because its kind decides what may be written about.
 * Asking for a subject first would offer nodes the chosen form refuses,
 * which is a list that lies.
 */
export function WriteDocumentDialog({ kinds, nodes, nodeTypes, onClose, onWrite }: {
  kinds: readonly ViewKindDescriptor[]
  nodes: readonly GraphNode[]
  nodeTypes: readonly NodeTypeDescriptor[]
  onClose: () => void
  onWrite: (kind: ViewKind, form: ViewFormId, subject: NodeId, asked: Record<string, string>) => Promise<void>
}) {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const offered = useMemo<readonly Offered[]>(
    () => kinds.flatMap(kind => kind.forms.map(form => ({ kind: kind.kind, subjects: kind.subjects, form }))),
    [kinds],
  )

  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState<NodeId | null>(null)
  const [picked, setPicked] = useState<Offered | undefined>(offered[0])
  const [asked, setAsked] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const matches = useMemo(() => {
    if (picked === undefined)
      return []
    const takeable = subjectsFor(picked.subjects, nodes, nodeTypes)
    const needle = query.trim().toLowerCase()
    const found = needle === ''
      ? takeable
      : takeable.filter(node =>
          node.name.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle))
    return found.slice(0, 50)
  }, [picked, nodes, nodeTypes, query])

  async function submit(): Promise<void> {
    if (subject === null || picked === undefined || submitting)
      return
    setSubmitting(true)
    try {
      await onWrite(picked.kind, picked.form.id, subject, asked)
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('documents.dialog.title')}</DialogTitle>
          <DialogDescription>{t('documents.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h4 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('documents.dialog.formLabel')}
            </h4>
            <div className="flex flex-col gap-1">
              {offered.map(one => (
                <button
                  key={`${one.kind}/${one.form.id}`}
                  type="button"
                  className={cn(
                    'flex flex-col gap-0.5 rounded-md border border-border px-3 py-2 text-left transition-colors duration-150 hover:bg-accent',
                    picked?.form.id === one.form.id && picked.kind === one.kind && 'border-primary/50 bg-accent',
                  )}
                  onClick={() => {
                    setPicked(one)
                    setAsked({})
                    // A subject the previous form took,
                    // may be one this one will not, so the pick starts again,
                    // rather than looking settled and being refused later.
                    setSubject(null)
                  }}
                >
                  <span className="text-xs text-foreground">{localize(one.form.label, locale)}</span>
                  <span className="text-2xs text-muted-foreground">{localize(one.form.purpose, locale)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('documents.dialog.subjectLabel')}
            </h4>
            <Input
              value={query}
              placeholder={t('documents.dialog.subjectPlaceholder')}
              onChange={event => setQuery(event.target.value)}
            />
            <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
              {matches.map(node => (
                <li key={node.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-accent',
                      subject === node.id && 'bg-accent',
                    )}
                    onClick={() => setSubject(node.id)}
                  >
                    <span className="truncate text-xs text-foreground">{node.name}</span>
                    <span className="truncate font-mono text-2xs text-muted-foreground">{node.id}</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="px-3 py-2 text-2xs text-muted-foreground">
                  {t('documents.dialog.noSubjects')}
                </li>
              )}
            </ul>
          </section>

          {picked?.form.asks.map(ask => (
            <section key={ask.id} className="flex flex-col gap-2">
              <h4 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {localize(ask.label, locale)}
              </h4>
              <div className="flex flex-col gap-1">
                {ask.choices.map((choice) => {
                  const chosen = (asked[ask.id] ?? ask.fallback) === choice.id
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      className={cn(
                        'flex flex-col gap-0.5 rounded-md border border-border px-3 py-2 text-left transition-colors duration-150 hover:bg-accent',
                        chosen && 'border-primary/50 bg-accent',
                      )}
                      onClick={() => setAsked(held => ({ ...held, [ask.id]: choice.id }))}
                    >
                      <span className="text-xs text-foreground">{localize(choice.label, locale)}</span>
                      <span className="text-2xs text-muted-foreground">{localize(choice.why, locale)}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('documents.dialog.cancel')}
          </Button>
          <Button size="sm" disabled={subject === null || picked === undefined || submitting} onClick={submit}>
            {t('documents.dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The nodes a kind will take as a subject, in the order the graph holds them. */
function subjectsFor(
  subjects: ViewSubjects,
  nodes: readonly GraphNode[],
  nodeTypes: readonly NodeTypeDescriptor[],
): readonly GraphNode[] {
  const takeable = new Set(
    nodeTypes.filter(type => isViewSubject(subjects, type)).map(type => type.id as string),
  )
  return nodes.filter(node => takeable.has(node.type))
}
