import { z } from 'zod'
import { EmittedBlock } from './block.js'
import { NodeId, Timestamp } from './common.js'
import { localizedText } from './locale.js'
import { type NodeTypeDescriptor, NodeTypeId } from './ontology.js'

export const ViewKind = z.string().min(1).brand<'ViewKind'>()
export type ViewKind = z.infer<typeof ViewKind>

export const ViewArtifactFormat = z.string().min(1).brand<'ViewArtifactFormat'>()
export type ViewArtifactFormat = z.infer<typeof ViewArtifactFormat>

/** v1 ships text-only artifacts. Binary support (PDF / image) lands in v2, via a separate contentBase64 field. */
export const ViewArtifactFile = z.object({
  path: z.string().min(1),
  text: z.string(),
})
export type ViewArtifactFile = z.infer<typeof ViewArtifactFile>

export const ViewArtifact = z.object({
  kind: ViewKind,
  format: ViewArtifactFormat,
  files: z.array(ViewArtifactFile),
})
export type ViewArtifact = z.infer<typeof ViewArtifact>

/**
 * A way of writing one projection out, which a plugin ships a skill for.
 *
 * Open by design, the way a view kind is.
 * A plugin adds a form and the framework serves it without learning its name.
 */
export const ViewFormId = z.string().min(1).brand<'ViewFormId'>()
export type ViewFormId = z.infer<typeof ViewFormId>

/** One answer a reader may give to what a form asks. */
export const ViewFormChoice = z.object({
  id: z.string().min(1),
  label: localizedText(z.string().min(1)),
  /** What picking this gets them, said in the terms they would ask for it in. */
  why: localizedText(z.string().min(1)),
}).openapi('ViewFormChoice')
export type ViewFormChoice = z.infer<typeof ViewFormChoice>

/**
 * One thing a form asks before it is written.
 *
 * A view is not obliged to be a fixed thing.
 * What a reader wants from a document while learning a subject,
 * and what they want once they are looking one fact up,
 * are different documents out of the same material.
 */
export const ViewFormAsk = z.object({
  id: z.string().min(1),
  label: localizedText(z.string().min(1)),
  choices: z.array(ViewFormChoice).min(2),
  /** What is written when a reader says nothing, which is the common case. */
  fallback: z.string().min(1),
}).openapi('ViewFormAsk')
export type ViewFormAsk = z.infer<typeof ViewFormAsk>

/**
 * A form, and what it asks before writing.
 *
 * Declared once by the plugin that ships its skill,
 * because three places read the same list.
 * A route refuses an unknown form before a run starts,
 * a surface offers the forms and their options,
 * and the plugin ships one skill per form.
 * Three copies drift the moment a fourth form is added.
 */
export const ViewFormDescriptor = z.object({
  id: ViewFormId,
  label: localizedText(z.string().min(1).max(40)),
  /** What a reader gets, said in the terms they would ask for it in. */
  purpose: localizedText(z.string().min(1)),
  /**
   * What this form writes, declared rather than read off a file name.
   *
   * `blocks` is the one the framework holds and draws.
   * The field is open so a form producing something else can say so,
   * and a surface can then offer it rather than guess from a file name.
   * Nothing reads a second format yet,
   * so a form declaring one is stored and not drawn.
   */
  format: ViewArtifactFormat,
  asks: z.array(ViewFormAsk).default([]),
  /**
   * Environment this form cannot be written without, named where it is needed.
   * A route refuses before starting a run rather than after,
   * because a run that fails on a missing setting reaches a reader,
   * as a failure rather than as the sentence telling them what to set.
   */
  requires: z.array(z.string().min(1)).default([]),
}).openapi('ViewFormDescriptor')
export type ViewFormDescriptor = z.infer<typeof ViewFormDescriptor>

/**
 * One way a node type qualifies as something a kind can be written about.
 *
 * `container` is said in the hints an ontology declares,
 * so a kind shipped apart from any one ontology still narrows the list,
 * without naming a vocabulary it could not know.
 * `type` names one outright,
 * which is honest for a kind shipped alongside the ontology it reads.
 */
export const ViewSubjectRule = z.discriminatedUnion('by', [
  z.object({ by: z.literal('container') }),
  z.object({ by: z.literal('type'), type: NodeTypeId }),
]).openapi('ViewSubjectRule')
export type ViewSubjectRule = z.infer<typeof ViewSubjectRule>

/**
 * Which nodes a kind can be written about, as the ways a type may qualify.
 *
 * A list rather than a set of flags, so one rule reads as one reason,
 * and a third kind of reason is an entry rather than another field.
 * An empty list takes every node,
 * which is the honest answer for a kind with no opinion.
 */
export const ViewSubjects = z.array(ViewSubjectRule).default([])
export type ViewSubjects = z.infer<typeof ViewSubjects>

/** Whether a kind can be written about nodes of this type. */
export function isViewSubject(subjects: ViewSubjects, type: NodeTypeDescriptor): boolean {
  if (subjects.length === 0)
    return true
  return subjects.some(rule => rule.by === 'container'
    ? type.renderHint?.container === true
    : rule.type === type.id)
}

/** A view kind this deployment can write, and the forms it writes it in. */
export const ViewKindDescriptor = z.object({
  kind: ViewKind,
  subjects: ViewSubjects,
  forms: z.array(ViewFormDescriptor),
}).openapi('ViewKindDescriptor')
export type ViewKindDescriptor = z.infer<typeof ViewKindDescriptor>

export const ListViewKindsResponse = z.object({
  items: z.array(ViewKindDescriptor),
}).openapi('ListViewKindsResponse')
export type ListViewKindsResponse = z.infer<typeof ListViewKindsResponse>

/**
 * One written view, as a surface lists it.
 *
 * The subject is the node it was written out of rather than the filename,
 * because a node id may carry the separator a filename uses,
 * which makes the mapping one-way and a regenerate a guess.
 */
export const GeneratedView = z.object({
  /** Path under the views directory, which is also how one is asked for. */
  path: z.string().min(1),
  kind: ViewKind,
  form: ViewFormId,
  subject: NodeId,
  format: ViewArtifactFormat,
  bytes: z.number().int().nonnegative(),
  writtenAt: Timestamp,
  /**
   * Whether the graph has moved on since this was written.
   * A view is derived, so it goes out of date when its subject does,
   * and nothing about the file itself says so.
   */
  stale: z.boolean(),
}).openapi('GeneratedView')
export type GeneratedView = z.infer<typeof GeneratedView>

export const ListViewsResponse = z.object({
  items: z.array(GeneratedView),
}).openapi('ListViewsResponse')
export type ListViewsResponse = z.infer<typeof ListViewsResponse>

/**
 * One written view, as the blocks a run rendered it out of.
 *
 * Blocks rather than a rendered page,
 * so the deterministic half never passes through the model's output.
 * A block names node ids,
 * and the surface reads their names and status straight from the graph,
 * which is both cheaper to produce and correct after a rename.
 */
export const ViewContent = z.object({
  path: z.string().min(1),
  format: ViewArtifactFormat,
  blocks: z.array(EmittedBlock),
}).openapi('ViewContent')
export type ViewContent = z.infer<typeof ViewContent>

/**
 * What a reader asked for, which is a form and whatever that form asks.
 *
 * The answers are read loosely here and settled against the form afterwards,
 * because which options exist depends on which form was named,
 * and a schema cannot know that until it has one.
 */
export const GenerateViewRequest = z.object({
  kind: ViewKind,
  form: ViewFormId,
  subject: NodeId,
  asked: z.record(z.string(), z.string()).optional(),
}).openapi('GenerateViewRequest')
export type GenerateViewRequest = z.infer<typeof GenerateViewRequest>

export const GenerateViewResponse = z.object({
  runId: z.string().min(1),
  form: ViewFormId,
  /** What the reader was taken to have asked, with anything unsaid filled in. */
  asked: z.record(z.string(), z.string()),
  /** Where the material this run writes from was projected to. */
  material: z.string().min(1),
}).openapi('GenerateViewResponse')
export type GenerateViewResponse = z.infer<typeof GenerateViewResponse>
