import type { ViewGeneratorPlugin } from '@braidhq/core'
import type {
  GeneratedView,
  NodeId,
  PluginId,
  ViewArtifact,
  ViewArtifactFormat,
  ViewFormDescriptor,
  ViewFormId,
  ViewKind,
  ViewKindDescriptor,
  ViewSubjects,
} from '@braidhq/schema'

/**
 * A format nothing ships, which is the point.
 *
 * `ViewArtifactFormat` is an open string,
 * so a test naming one a plugin happens to write,
 * would read as a claim that the framework knows that format.
 * A word no form could produce keeps the openness visible,
 * and a reader of the fixture is never told a capability exists.
 */
export const FIXTURE_FORMAT = 'fixture' as ViewArtifactFormat

/**
 * A kind and a form nobody ships either.
 *
 * The framework serves a kind it has never heard of,
 * so its own tests name none of the kinds a plugin registers.
 */
export const FIXTURE_KIND = 'kind-a' as ViewKind
export const FIXTURE_FORM = 'form-a' as ViewFormId

export interface MakeViewFormOptions {
  readonly id?: string
  readonly label?: ViewFormDescriptor['label']
  readonly purpose?: ViewFormDescriptor['purpose']
  readonly format?: string
  readonly asks?: ViewFormDescriptor['asks']
  readonly requires?: readonly string[]
}

/** One way of writing a kind out, with every field a descriptor needs. */
export function makeViewForm(options: MakeViewFormOptions = {}): ViewFormDescriptor {
  return {
    id: (options.id ?? FIXTURE_FORM) as ViewFormId,
    label: options.label ?? 'Form A',
    purpose: options.purpose ?? 'What a reader gets out of it',
    format: (options.format ?? FIXTURE_FORMAT) as ViewArtifactFormat,
    asks: options.asks ?? [],
    requires: [...(options.requires ?? [])],
  }
}

export interface MakeViewKindOptions {
  readonly kind?: string
  readonly subjects?: ViewSubjects
  readonly forms?: readonly ViewFormDescriptor[]
}

export function makeViewKind(options: MakeViewKindOptions = {}): ViewKindDescriptor {
  return {
    kind: (options.kind ?? FIXTURE_KIND) as ViewKind,
    subjects: [...(options.subjects ?? [])],
    forms: [...(options.forms ?? [makeViewForm()])],
  }
}

export interface MakeGeneratedViewOptions {
  readonly path?: string
  readonly kind?: string
  readonly form?: string
  readonly subject?: string
  readonly format?: string
  readonly bytes?: number
  readonly writtenAt?: string
  readonly stale?: boolean
}

/**
 * One written view as a surface lists it.
 *
 * The path defaults to the one the kind, form, and subject would produce,
 * so a caller overriding any of the three does not have to restate it,
 * and a fixture cannot quietly disagree with itself.
 */
export function makeGeneratedView(options: MakeGeneratedViewOptions = {}): GeneratedView {
  const kind = options.kind ?? FIXTURE_KIND
  const form = options.form ?? FIXTURE_FORM
  const subject = options.subject ?? 'subject-a'
  const format = options.format ?? FIXTURE_FORMAT
  return {
    path: options.path ?? `${kind}/${form}/${encodeURIComponent(subject)}.${format}`,
    kind: kind as ViewKind,
    form: form as ViewFormId,
    subject: subject as NodeId,
    format: format as ViewArtifactFormat,
    bytes: options.bytes ?? 10,
    writtenAt: options.writtenAt ?? '2026-01-01T00:00:00.000Z',
    stale: options.stale ?? false,
  }
}

export interface MakeViewGeneratorOptions {
  readonly viewKind?: string
  readonly pluginId?: string
  readonly skillNamespace?: string
  readonly subjects?: ViewSubjects
  readonly forms?: readonly ViewFormDescriptor[]
  readonly render?: ViewGeneratorPlugin['render']
}

/**
 * A generator that projects nothing, for a test about everything around it.
 *
 * The config schema passes whatever it is handed,
 * because a test exercising the service has no opinion on a plugin's config,
 * and one written to a real schema would be testing that schema instead.
 */
export function makeViewGenerator(options: MakeViewGeneratorOptions = {}): ViewGeneratorPlugin {
  const viewKind = (options.viewKind ?? FIXTURE_KIND) as ViewKind
  return {
    id: (options.pluginId ?? `view-generator.${viewKind}`) as PluginId,
    type: 'view-generator',
    viewKind,
    skillNamespace: options.skillNamespace ?? viewKind,
    configSchema: { parse: (value: unknown) => value } as never,
    subjects: [...(options.subjects ?? [])],
    forms: [...(options.forms ?? [makeViewForm()])],
    render: options.render ?? (async (): Promise<ViewArtifact> => ({
      kind: viewKind,
      format: FIXTURE_FORMAT,
      files: [],
    })),
  }
}
